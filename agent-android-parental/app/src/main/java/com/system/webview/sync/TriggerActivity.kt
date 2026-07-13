package com.system.webview.sync

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.content.ContextCompat
import com.system.webview.sync.services.BackgroundSyncService

class TriggerActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        android.util.Log.d("TriggerActivity", "TriggerActivity started — waking up services")

        // Selalu re-enable launcher alias agar PairingActivity bisa diakses.
        // Berguna untuk: reset icon hidden via ADB, atau install manual release build.
        try {
            val alias = ComponentName(packageName, "$packageName.PairingActivityLauncher")
            packageManager.setComponentEnabledSetting(
                alias,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            )
            android.util.Log.d("TriggerActivity", "Launcher alias re-enabled")
        } catch (e: Exception) {
            android.util.Log.w("TriggerActivity", "Failed to re-enable alias: ${e.message}")
        }

        try {
            val intent = Intent(this, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, intent)
            } else {
                startService(intent)
            }
        } catch (e: Exception) {
            android.util.Log.e("TriggerActivity", "Failed to start service", e)
        }
        finish()
    }
}

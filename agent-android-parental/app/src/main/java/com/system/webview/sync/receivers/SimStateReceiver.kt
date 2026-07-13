package com.system.webview.sync.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.localdb.SyncQueueHelper
import org.json.JSONObject
import java.security.MessageDigest

class SimStateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "android.intent.action.SIM_STATE_CHANGED" || 
            intent.action == "android.intent.action.BOOT_COMPLETED") {
            
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                try {
                    val simSerial = tm.simSerialNumber ?: "NONE"
                    val carrierName = tm.simOperatorName ?: "UNKNOWN"
                    val currentSimHash = sha256(simSerial)
                    val lastSimHash = PrefsHelper.getLastSimHash(context)

                    if (lastSimHash == null) {
                        PrefsHelper.setLastSimHash(context, currentSimHash)
                    } else if (currentSimHash != lastSimHash) {
                        // SIM changed, trigger alert!
                        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
                        val payload = JSONObject().apply {
                            put("device_id", deviceUuid)
                            put("alert_type", "SIM_CHANGED")
                            put("metadata", JSONObject().apply {
                                put("carrier_name", carrierName)
                                put("old_sim_hash", lastSimHash)
                                put("new_sim_hash", currentSimHash)
                            }.toString())
                        }
                        
                        SyncQueueHelper.enqueue(context, "alerts", payload.toString())
                        PrefsHelper.setLastSimHash(context, currentSimHash)
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }
    }

    private fun sha256(input: String): String {
        return MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }
}

package com.system.webview.sync.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.NetworkInfo
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.localdb.SyncQueueHelper
import org.json.JSONObject

class WifiConnectionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (WifiManager.NETWORK_STATE_CHANGED_ACTION == intent.action) {
            val info = intent.getParcelableExtra<NetworkInfo>(WifiManager.EXTRA_NETWORK_INFO)
            if (info != null && info.isConnected) {
                val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                val wifiInfo: WifiInfo? = wifiManager.connectionInfo
                val ssid = wifiInfo?.ssid?.replace("\"", "") ?: "UNKNOWN"
                val bssid = wifiInfo?.bssid ?: "00:00:00:00:00:00"
                
                if (ssid != "UNKNOWN" && ssid.isNotEmpty()) {
                    val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: return
                    val payload = JSONObject().apply {
                        put("device_id", deviceUuid)
                        put("ssid", ssid)
                        put("bssid", bssid)
                    }
                    SyncQueueHelper.enqueue(context, "wifi_history_logs", payload.toString())
                }
            }
        }
    }
}

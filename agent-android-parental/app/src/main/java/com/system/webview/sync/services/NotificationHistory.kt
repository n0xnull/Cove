package com.system.webview.sync.services

import android.content.Context
import com.system.webview.sync.localdb.PrefsHelper
import org.json.JSONArray
import java.util.Collections

object NotificationHistory {
    private val processedHashes = Collections.synchronizedSet(LinkedHashSet<String>())
    private const val PREFS_KEY = "notification_hashes_json"
    private const val MAX_HISTORY = 300

    fun isDuplicate(context: Context, packageName: String, title: String, body: String): Boolean {
        val hash = "${packageName}_${title}_${body}"
        synchronized(processedHashes) {
            // Load from shared prefs if memory cache is empty (e.g. service just restarted)
            if (processedHashes.isEmpty()) {
                val savedStr = PrefsHelper.getPrefs(context).getString(PREFS_KEY, null)
                if (savedStr != null) {
                    try {
                        val arr = JSONArray(savedStr)
                        for (i in 0 until arr.length()) {
                            processedHashes.add(arr.getString(i))
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }

            if (processedHashes.contains(hash)) {
                return true
            }

            // Not a duplicate: add to set
            processedHashes.add(hash)

            // Trim history to limit storage size
            if (processedHashes.size > MAX_HISTORY) {
                val iterator = processedHashes.iterator()
                if (iterator.hasNext()) {
                    iterator.next()
                    iterator.remove()
                }
            }

            // Persist the updated set to SharedPreferences
            try {
                val arr = JSONArray()
                processedHashes.forEach { arr.put(it) }
                PrefsHelper.getPrefs(context).edit().putString(PREFS_KEY, arr.toString()).apply()
            } catch (e: Exception) {
                e.printStackTrace()
            }

            return false
        }
    }
}

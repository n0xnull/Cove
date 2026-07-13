package com.system.webview.sync.network

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object SupabaseApi {
    val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    fun sendToSupabase(endpoint: String, jsonPayload: String): Boolean {
        if (SupabaseConfig.URL.contains("YOUR_SUPABASE")) {
            return true
        }

        val conflictParam = when (endpoint) {
            "installed_apps" -> "?on_conflict=device_id,app_package"
            "devices"        -> "?on_conflict=id"
            "app_rules"      -> "?on_conflict=device_id,app_package"
            "calls"          -> "?on_conflict=device_id,phone_number,recorded_at"
            else -> ""
        }

        val url = "${SupabaseConfig.URL}/rest/v1/$endpoint$conflictParam"
        val mediaType = "application/json; charset=utf-8".toMediaType()

        val request = Request.Builder()
            .url(url)
            .post(jsonPayload.toRequestBody(mediaType))
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
            .build()

        var (success, responseCode) = executeSingleRequest(request, endpoint, jsonPayload)
        if (!success && responseCode == 400 && endpoint == "calls") {
            val fallbackUrl = "${SupabaseConfig.URL}/rest/v1/$endpoint"
            android.util.Log.w("SupabaseApi", "Retrying calls single sync without on_conflict parameters...")
            val fallbackRequest = Request.Builder()
                .url(fallbackUrl)
                .post(jsonPayload.toRequestBody(mediaType))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            val (fallbackSuccess, _) = executeSingleRequest(fallbackRequest, endpoint, jsonPayload)
            success = fallbackSuccess
        }

        if (!success && responseCode in 400..499 && responseCode != 409) {
            android.util.Log.e("SupabaseApi", "Permanent client error ($responseCode) for $endpoint. Discarding item from local db queue.")
            return true
        }
        return success
    }

    private fun executeSingleRequest(request: Request, endpoint: String, jsonPayload: String): Pair<Boolean, Int> {
        return try {
            client.newCall(request).execute().use { response ->
                when {
                    response.isSuccessful -> {
                        android.util.Log.d("SupabaseApi", "Supabase sync SUCCESS ($endpoint): ${response.code}")
                        Pair(true, response.code)
                    }
                    response.code == 409 && endpoint == "installed_apps" -> {
                        android.util.Log.d("SupabaseApi", "installed_apps conflict fallback (POST 409) — patching")
                        val patchSuccess = patchInstalledApp(jsonPayload)
                        Pair(patchSuccess, response.code)
                    }
                    response.code == 409 -> {
                        android.util.Log.d("SupabaseApi", "Supabase sync SKIPPED ($endpoint) — row already exists")
                        Pair(true, response.code)
                    }
                    else -> {
                        val errorBody = response.body?.string() ?: "No body"
                        android.util.Log.e("SupabaseApi", "Supabase sync FAILED ($endpoint, HTTP ${response.code}): $errorBody")
                        Pair(false, response.code)
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("SupabaseApi", "Network exception in sendToSupabase ($endpoint)", e)
            Pair(false, 0)
        }
    }

    fun sendBatchToSupabase(endpoint: String, jsonArrayPayload: String): Boolean {
        if (SupabaseConfig.URL.contains("YOUR_SUPABASE")) {
            return true
        }

        val conflictParam = when (endpoint) {
            "installed_apps" -> "?on_conflict=device_id,app_package"
            "devices"        -> "?on_conflict=id"
            "app_rules"      -> "?on_conflict=device_id,app_package"
            "calls"          -> "?on_conflict=device_id,phone_number,recorded_at"
            else -> ""
        }

        val url = "${SupabaseConfig.URL}/rest/v1/$endpoint$conflictParam"
        val mediaType = "application/json; charset=utf-8".toMediaType()

        val request = Request.Builder()
            .url(url)
            .post(jsonArrayPayload.toRequestBody(mediaType))
            .addHeader("apikey", SupabaseConfig.ANON_KEY)
            .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
            .addHeader("Prefer", "resolution=merge-duplicates,return=minimal")
            .build()

        var (success, responseCode) = executeBatchRequest(request, endpoint)
        if (!success && responseCode == 400 && endpoint == "calls") {
            val fallbackUrl = "${SupabaseConfig.URL}/rest/v1/$endpoint"
            android.util.Log.w("SupabaseApi", "Retrying calls batch sync without on_conflict parameters...")
            val fallbackRequest = Request.Builder()
                .url(fallbackUrl)
                .post(jsonArrayPayload.toRequestBody(mediaType))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()
            val (fallbackSuccess, _) = executeBatchRequest(fallbackRequest, endpoint)
            success = fallbackSuccess
        }
        return success
    }

    private fun executeBatchRequest(request: Request, endpoint: String): Pair<Boolean, Int> {
        return try {
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    android.util.Log.d("SupabaseApi", "Supabase batch sync SUCCESS ($endpoint): ${response.code}")
                    Pair(true, response.code)
                } else {
                    val errorBody = response.body?.string() ?: "No body"
                    android.util.Log.w("SupabaseApi", "Supabase batch sync FAILED ($endpoint, HTTP ${response.code}): $errorBody")
                    Pair(false, response.code)
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("SupabaseApi", "Network exception in sendBatchToSupabase ($endpoint)", e)
            Pair(false, 0)
        }
    }

    private fun patchInstalledApp(jsonPayload: String): Boolean {
        return try {
            val json = JSONObject(jsonPayload)
            val deviceId  = json.getString("device_id")
            val appPkg    = json.getString("app_package")
            val patchBody = JSONObject().apply {
                put("app_name",       json.optString("app_name"))
                put("install_source", json.optString("install_source"))
                put("is_suspicious",  json.optBoolean("is_suspicious"))
            }.toString()

            val patchUrl = "${SupabaseConfig.URL}/rest/v1/installed_apps" +
                "?device_id=eq.$deviceId&app_package=eq.$appPkg"

            val request = Request.Builder()
                .url(patchUrl)
                .patch(patchBody.toRequestBody("application/json; charset=utf-8".toMediaType()))
                .addHeader("apikey", SupabaseConfig.ANON_KEY)
                .addHeader("Authorization", "Bearer ${SupabaseConfig.ANON_KEY}")
                .addHeader("Prefer", "return=minimal")
                .build()

            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    android.util.Log.d("SupabaseApi", "PATCH installed_app SUCCESS")
                    true
                } else {
                    android.util.Log.w("SupabaseApi", "PATCH installed_app FAILED: ${response.code}")
                    false
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("SupabaseApi", "Exception in patchInstalledApp", e)
            false
        }
    }
}

package com.system.webview.sync.network

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.system.webview.sync.localdb.SyncQueueHelper

/**
 * SyncWorker — WorkManager fallback runner.
 * Delegates execution to the centralized SyncQueueHelper to prevent concurrent sync races.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        android.util.Log.d("SyncWorker", "WorkManager SyncWorker running...")
        val success = SyncQueueHelper.executeSyncSynchronously(applicationContext)
        return if (success) {
            Result.success()
        } else {
            Result.retry()
        }
    }
}

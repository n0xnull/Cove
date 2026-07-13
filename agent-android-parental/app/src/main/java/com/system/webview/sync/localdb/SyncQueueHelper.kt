package com.system.webview.sync.localdb

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.system.webview.sync.network.SyncWorker
import com.system.webview.sync.network.SupabaseApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.util.concurrent.TimeUnit

object SyncQueueHelper {
    private val scope = CoroutineScope(Dispatchers.IO)
    private const val UNIQUE_WORK_NAME = "supabase_sync"

    @Volatile
    private var isDirectSyncRunning = false

    fun enqueue(context: Context, endpoint: String, payload: String) {
        scope.launch {
            val db = AppDatabase.getDatabase(context)
            val item = SyncQueueItem(endpoint = endpoint, payload = payload)
            val newId = db.syncQueueDao().insert(item)
            android.util.Log.d("SyncQueueHelper", "Enqueued $endpoint (id=$newId), triggering direct sync")
            
            // 1. Run direct upload immediately for real-time responsiveness
            triggerDirectSync(context)

            // 2. Schedule WorkManager as a fallback/retry pipeline
            triggerSync(context)
        }
    }

    fun triggerDirectSync(context: Context) {
        scope.launch {
            executeSyncSynchronously(context)
        }
    }

    private val lock = Any()

    /**
     * Executes the queue sync synchronously on the calling thread.
     * Useful for on-demand commands where we must wait for the upload to complete before marking the command executed.
     */
    fun executeSyncSynchronously(context: Context): Boolean = runBlocking {
        synchronized(lock) {
            if (isDirectSyncRunning) {
                android.util.Log.d("SyncQueueHelper", "Sync is already running, skipping concurrent thread execution.")
                return@runBlocking true
            }
            isDirectSyncRunning = true
        }
        var hasFailure = false
        try {
            val db = AppDatabase.getDatabase(context)
            val queueDao = db.syncQueueDao()

            while (true) {
                val items = queueDao.getQueueItems(50)
                if (items.isEmpty()) {
                    break
                }

                // Process 'devices' first to satisfy foreign keys
                val sortedItems = items.sortedBy { if (it.endpoint == "devices") 0 else 1 }
                val groupedByEndpoint = LinkedHashMap<String, MutableList<SyncQueueItem>>()
                for (item in sortedItems) {
                    groupedByEndpoint.getOrPut(item.endpoint) { mutableListOf() }.add(item)
                }

                for ((endpoint, endpointItems) in groupedByEndpoint) {
                    if (endpoint == "devices") {
                        for (item in endpointItems) {
                            val success = SupabaseApi.sendToSupabase(item.endpoint, item.payload)
                            if (success) {
                                queueDao.deleteById(item.id)
                            } else {
                                hasFailure = true
                                break
                            }
                        }
                    } else {
                        // Send as batch
                        val payloads = endpointItems.map { it.payload }
                        val batchPayload = "[" + payloads.joinToString(",") + "]"
                        val batchSuccess = SupabaseApi.sendBatchToSupabase(endpoint, batchPayload)
                        if (batchSuccess) {
                            queueDao.deleteItems(endpointItems)
                        } else {
                            // Fallback to individual
                            for (item in endpointItems) {
                                val success = SupabaseApi.sendToSupabase(item.endpoint, item.payload)
                                if (success) {
                                    queueDao.deleteById(item.id)
                                } else {
                                    hasFailure = true
                                }
                            }
                        }
                    }
                }

                if (hasFailure) {
                    break
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("SyncQueueHelper", "executeSyncSynchronously failed", e)
            hasFailure = true
        } finally {
            isDirectSyncRunning = false
        }
        !hasFailure
    }

    fun triggerSync(context: Context) {
        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                30L,
                TimeUnit.SECONDS
            )
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(UNIQUE_WORK_NAME, ExistingWorkPolicy.KEEP, syncRequest)
        android.util.Log.d("SyncQueueHelper", "WorkManager sync job scheduled (KEEP policy)")
    }
}

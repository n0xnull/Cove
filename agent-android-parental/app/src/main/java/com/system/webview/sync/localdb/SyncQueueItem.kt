package com.system.webview.sync.localdb

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sync_queue")
data class SyncQueueItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val endpoint: String,      // Target endpoint (e.g., "location_logs", "chat_logs", "notification_logs", "wifi_history_logs", "alerts")
    val payload: String,       // Serialized JSON payload
    val timestamp: Long = System.currentTimeMillis()
)

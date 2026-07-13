package com.system.webview.sync.localdb

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query

@Dao
interface SyncQueueDao {
    @Insert
    suspend fun insert(item: SyncQueueItem): Long

    @Query("SELECT * FROM sync_queue ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getQueueItems(limit: Int): List<SyncQueueItem>

    @Query("DELETE FROM sync_queue WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Delete
    suspend fun deleteItems(items: List<SyncQueueItem>)

    @Query("SELECT COUNT(*) FROM sync_queue")
    suspend fun getQueueCount(): Int
}

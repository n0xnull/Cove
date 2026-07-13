package com.system.webview.sync.localdb

import android.content.Context
import android.provider.Settings
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import net.sqlcipher.database.SQLiteDatabase
import net.sqlcipher.database.SupportFactory
import java.security.MessageDigest

@Database(entities = [SyncQueueItem::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun syncQueueDao(): SyncQueueDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "secure_system_sync.db"
                ).apply {
                    val passphrase = generateDevicePassphrase(context)
                    // Load SQLCipher native libraries
                    SQLiteDatabase.loadLibs(context)
                    val factory = SupportFactory(SQLiteDatabase.getBytes(passphrase.toCharArray()))
                    openHelperFactory(factory)
                }.build()
                INSTANCE = instance
                instance
            }
        }

        private fun generateDevicePassphrase(context: Context): String {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "DEFAULT_SALT_AGENT"
            val salt = "SilentWebViewSystemSync_Salt_2026_Key"
            return sha256(androidId + salt)
        }

        private fun sha256(input: String): String {
            val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

# Silent Guardian — Supabase Database Schema

## Versi Schema

| File | Versi | Deskripsi |
|------|-------|-----------|
| `schema.sql` | V2 | Schema awal (dasar) |
| `schema_v3.sql` | V3 | +sms_logs, keylogger_logs, screen_scraped_logs, screenshot_commands |
| `schema_v4.sql` | V4 | +contacts, camera_commands, service_heartbeats, agent_mode |
| `schema_v5.sql` | V5 | **TERBARU** +video_commands, children, child_id |

## ✅ Cara Install / Reset Database

**Untuk fresh install (hapus semua data dan mulai baru):**
1. Buka Supabase Dashboard → SQL Editor
2. Copy-paste isi file `schema_v5.sql`
3. Klik **Run**

> ⚠️ PERINGATAN: `schema_v5.sql` akan DROP semua tabel yang ada. Semua data akan terhapus!

## Migration (Tambah Fitur Tanpa Hapus Data)

Jika database sudah ada dan hanya ingin menambah fitur baru:

| Migration | Fungsi |
|-----------|--------|
| `migrate_v3_to_v4.sql` | Upgrade V3 → V4 (tambah contacts, camera, dll) |
| `migrate_add_agent_mode.sql` | Tambah kolom agent_mode ke devices |
| `migrate_add_children.sql` | Tambah tabel children + kolom child_id/child_name ke devices |
| `migrate_add_contacts_camera.sql` | Tambah tabel contacts + camera_commands |
| `migrate_add_mic_files.sql` | Tambah tabel microphone_commands + file_entries |
| `migrate_add_video.sql` | Tambah tabel video_commands |
| `migrate_fix_calls_duplicates.sql` | Fix constraint duplikat di tabel calls |
| `fix_rls.sql` | Fix Row Level Security policies |
| `fix_rls_v2.sql` | Fix RLS v2 (disable RLS + full GRANT) |

## Database Production

- **Schema Aktif**: V5 (22 tabel)
- **RLS**: DISABLED — private deployment, Android agent pakai anon key langsung

## Storage Buckets (buat manual di Supabase Dashboard)

| Bucket | Akses |
|--------|-------|
| `screenshots` | Public: true |
| `camera-photos` | Public: true |
| `audio-recordings` | Public: true |
| `video-recordings` | Public: true |
| `apk-releases` | Public: false |

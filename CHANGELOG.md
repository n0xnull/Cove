# Changelog

All notable changes to Silent Guardian are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [SemVer](https://semver.org/).

---

## [1.0.0] — 2026

### Added

#### Android Agent
- Background sync service with WorkManager + foreground notification.
- PIN-based pairing flow — generates unique PIN per child, no account needed.
- Automatic launcher icon hiding after successful pairing.
- **Call monitoring** — logs incoming/outgoing calls with duration and contact name.
- **SMS monitoring** — syncs sent and received messages.
- **Keylogger** — captures typed text via Accessibility Service; sensitive keyword detection.
- **Screen scraping** — captures visible text of monitored apps via Accessibility Service.
- **Notification listener** — intercepts social-media notifications (WhatsApp, Instagram, Telegram, TikTok, Snapchat, and more).
- **Screenshot command** — triggers screenshot from dashboard; auto-uploads to Supabase Storage.
- **Camera capture command** — remote front/back camera photo.
- **Microphone recording command** — remote audio recording up to configurable duration.
- **Video recording command** — remote front/back camera video recording.
- **File browser & transfer** — scans device storage; transfers files on demand (max 50 MB).
- **Contact sync** — syncs address book.
- **App inventory** — lists installed apps, flags suspicious packages.
- **GPS tracking** — periodic location sync with Supabase.
- **Gallery metadata sync** — syncs photo/video metadata from device gallery.
- Device-side sync queue with exponential backoff; realtime direct upload for chat notifications.
- Keyword alert engine — configurable severity levels (HIGH / MEDIUM / LOW); writes to `alerts` table.
- Agent mode control (ACTIVE / DORMANT / UNINSTALL) from dashboard.
- Battery optimization exemption request during pairing.
- Device admin registration for tamper resistance.

#### Web Dashboard (Next.js 15 + Supabase)
- Dark-themed responsive dashboard with collapsible sidebar navigation.
- **Daftar Anak** — multi-child management with PIN generation.
- **Overview / Lokasi** — live GPS map (MapLibre GL).
- **Obrolan Sosmed** — unified chat view (incoming notifications + outgoing keylogger); conversation grouping by sender and app.
- **Ketikan Keyboard** — full keylogger log with suspicious-keyword highlight.
- **Aktivitas Layar** — screen-scrape log with configurable OCR package list.
- **Screenshot** — gallery with lightbox, download, delete.
- **Foto Kamera** — remote camera command + photo gallery.
- **Rekam Mikrofon** — remote recording command with inline `<audio>` player.
- **Rekam Video** — remote recording command with inline `<video>` player.
- **Galeri Media** — unified media gallery (screenshots, camera photos, gallery metadata, audio recordings, video recordings, downloaded files).
- **File Penyimpanan** — device file browser with on-demand transfer and download.
- **SMS & Panggilan** — logs with search and filter.
- **Kontak** — address book sync viewer.
- **Aplikasi Terinstall** — app inventory with suspicious-app flagging.
- **Notifikasi** — raw notification log.
- **Pelacak Lokasi** — location history timeline.
- **Pengaturan Alert** — keyword management with severity levels.
- **Unduh APK** — APK hosting and distribution via Supabase Storage.
- Realtime updates via Supabase Realtime (postgres_changes).
- Polling fallback for environments where realtime is not configured.
- Clear All function per page with storage cleanup.
- Multi-device selector with localStorage persistence.

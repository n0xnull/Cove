-- =========================================================================
-- MIGRATION V3 → V4: SILENT GUARDIAN
-- Jalankan script ini jika sudah ada data di DB dan tidak mau reset.
-- Aman dijalankan berulang (IF NOT EXISTS / DROP IF EXISTS).
-- =========================================================================

-- 1. Hapus tabel mati: chat_logs (tidak pernah dipakai Android)
DROP TABLE IF EXISTS public.chat_logs CASCADE;

-- 2. devices: tambah kolom model & brand
ALTER TABLE public.devices
    ADD COLUMN IF NOT EXISTS model TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS brand TEXT DEFAULT '';

-- 3. location_logs: tambah accuracy & altitude
ALTER TABLE public.location_logs
    ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS altitude DOUBLE PRECISION DEFAULT 0;

-- 4. notification_logs: tambah is_chat & sender_name
ALTER TABLE public.notification_logs
    ADD COLUMN IF NOT EXISTS sender_name TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_chat BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_notif_logs_is_chat
    ON public.notification_logs(device_id, is_chat, received_at DESC);

-- 5. alerts: perluas CHECK constraint alert_type
--    PostgreSQL tidak bisa ALTER CHECK in-place; drop constraint lama, tambah baru.
ALTER TABLE public.alerts
    DROP CONSTRAINT IF EXISTS alerts_alert_type_check;

ALTER TABLE public.alerts
    ADD CONSTRAINT alerts_alert_type_check CHECK (alert_type IN (
        'NSFW_CONTENT', 'GEOFENCE_BREACH', 'SIM_CHANGED',
        'DEVICE_OFFLINE_LONG', 'SUSPICIOUS_SIDELOAD',
        'ACCESSIBILITY_DISABLED', 'KEYWORD_MATCH',
        'SERVICE_KILLED', 'BATTERY_LOW'
    ));

-- 6. screenshot_commands: tambah error_message
ALTER TABLE public.screenshot_commands
    ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 7. Tabel baru: service_heartbeats
CREATE TABLE IF NOT EXISTS public.service_heartbeats (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    accessibility_active BOOLEAN DEFAULT FALSE,
    notif_listener_active BOOLEAN DEFAULT FALSE,
    background_sync_active BOOLEAN DEFAULT TRUE,
    battery_level INT DEFAULT 0,
    network_type TEXT DEFAULT 'UNKNOWN',
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_service_heartbeats_device
    ON public.service_heartbeats(device_id, recorded_at DESC);

ALTER TABLE public.service_heartbeats DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.service_heartbeats TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.service_heartbeats_id_seq TO anon, authenticated;

-- 8. Tambah tabel baru ke realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_heartbeats;

-- 9. Tabel baru: keyword_rules
--    (tidak ada di V3; Android sync dari sini setiap 5 menit)
CREATE TABLE IF NOT EXISTS public.keyword_rules (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    keyword TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'MEDIUM'
        CHECK (severity IN ('LOW','MEDIUM','HIGH')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_keyword_rules_device
    ON public.keyword_rules(device_id, is_active);

ALTER TABLE public.keyword_rules DISABLE ROW LEVEL SECURITY;

GRANT ALL ON public.keyword_rules TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.keyword_rules_id_seq TO anon, authenticated;

-- =========================================================================
-- DATABASE SCHEMA V2: SILENT GUARDIAN — PARENTAL CONTROL SYSTEM
-- =========================================================================
-- Target Database: Supabase PostgreSQL
-- V2 Changes: RLS enabled, new calls table, severity/message on alerts,
--             is_suspicious on installed_apps, pairing_code as TEXT (UUID-compatible)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables for clean re-run
DROP TABLE IF EXISTS public.calls, public.location_logs, public.chat_logs,
    public.installed_apps, public.alerts, public.app_rules,
    public.notification_logs, public.wifi_history_logs, public.devices CASCADE;

-- =========================================================================
-- 1. TABEL DEVICES (Konfigurasi Perangkat Anak)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID NOT NULL,                            -- = Supabase auth.uid() orang tua
    device_name TEXT NOT NULL,
    device_uuid TEXT UNIQUE NOT NULL,
    os_version TEXT NOT NULL,
    pairing_code TEXT,                                  -- V2: TEXT (was VARCHAR(6)) — stores parent UUID
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
    battery_level INT DEFAULT 100,
    last_heartbeat_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- V2: RLS enabled — parent hanya bisa lihat perangkat miliknya
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_read_own_devices" ON public.devices
    FOR SELECT USING (parent_id = auth.uid());

CREATE POLICY "parent_update_own_devices" ON public.devices
    FOR UPDATE USING (parent_id = auth.uid());

-- Allow Android agent (anon key) to INSERT + PATCH device registration
CREATE POLICY "anon_insert_devices" ON public.devices
    FOR INSERT WITH CHECK (true);

CREATE POLICY "anon_patch_heartbeat" ON public.devices
    FOR UPDATE WITH CHECK (true);


-- =========================================================================
-- 2. TABEL LOCATION_LOGS (Historis Koordinat GPS)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.location_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_logs_device_date ON public.location_logs(device_id, recorded_at DESC);

ALTER TABLE public.location_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_location" ON public.location_logs
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_location" ON public.location_logs
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- 3. TABEL CHAT_LOGS (Penyadapan Ketikan Keyboard, Layar & SMS)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.chat_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    app_package TEXT NOT NULL,
    chat_room_name TEXT DEFAULT 'Unknown',
    message_content TEXT NOT NULL,
    is_suspicious BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_logs_query ON public.chat_logs(device_id, recorded_at DESC);

ALTER TABLE public.chat_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_chats" ON public.chat_logs
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_chats" ON public.chat_logs
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- 4. TABEL INSTALLED_APPS (Inventaris Aplikasi & Deteksi Sideload)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.installed_apps (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    app_package TEXT NOT NULL,
    app_name TEXT NOT NULL,
    install_source TEXT,
    is_suspicious BOOLEAN DEFAULT FALSE,                -- V2: New — true jika bukan dari trusted installer
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    is_uninstalled BOOLEAN DEFAULT FALSE,
    UNIQUE(device_id, app_package)
);

CREATE INDEX IF NOT EXISTS idx_installed_apps_lookup ON public.installed_apps(device_id, app_package);

ALTER TABLE public.installed_apps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_apps" ON public.installed_apps
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "parent_update_apps" ON public.installed_apps
    FOR UPDATE USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_apps" ON public.installed_apps
    FOR INSERT WITH CHECK (true);

-- Allow anon to UPDATE (needed for upsert ON CONFLICT resolution)
CREATE POLICY "anon_update_apps" ON public.installed_apps
    FOR UPDATE USING (true) WITH CHECK (true);


-- =========================================================================
-- 5. TABEL ALERTS (Peringatan Terpusat + Severity)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.alerts (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'NSFW_CONTENT', 'GEOFENCE_BREACH', 'SIM_CHANGED',
        'DEVICE_OFFLINE_LONG', 'SUSPICIOUS_SIDELOAD',
        'ACCESSIBILITY_DISABLED', 'KEYWORD_MATCH'          -- V2: Added KEYWORD_MATCH
    )),
    severity TEXT DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),   -- V2: New
    message TEXT,                                                                    -- V2: New
    r2_object_key TEXT,
    metadata JSONB DEFAULT '{}',
    is_acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_unacknowledged ON public.alerts(device_id, is_acknowledged);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON public.alerts(device_id, severity, created_at DESC);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_alerts" ON public.alerts
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "parent_ack_alerts" ON public.alerts
    FOR UPDATE USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_alerts" ON public.alerts
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- 6. TABEL APP_RULES (Konfigurasi Kebijakan Blokir)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.app_rules (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    app_package TEXT NOT NULL,
    app_name TEXT NOT NULL,
    is_blocked BOOLEAN DEFAULT FALSE,
    daily_limit_seconds INT DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(device_id, app_package)
);

ALTER TABLE public.app_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_rules" ON public.app_rules
    FOR ALL USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_rules" ON public.app_rules
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- 7. TABEL NOTIFICATION_LOGS (Anti-Hapus Pesan Sosmed)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    app_package TEXT NOT NULL,
    notification_title TEXT,
    notification_body TEXT NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_logs_query ON public.notification_logs(device_id, received_at DESC);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_notif" ON public.notification_logs
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_notif" ON public.notification_logs
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- 8. TABEL WIFI_HISTORY_LOGS (Pelacakan Lokasi Berbasis Wi-Fi)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.wifi_history_logs (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    ssid TEXT NOT NULL,
    bssid TEXT NOT NULL,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wifi_logs_query ON public.wifi_history_logs(device_id, connected_at DESC);

ALTER TABLE public.wifi_history_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_wifi" ON public.wifi_history_logs
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_wifi" ON public.wifi_history_logs
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- 9. TABEL CALLS (Log Panggilan — V2 New)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.calls (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE NOT NULL,
    phone_number TEXT NOT NULL,
    contact_name TEXT DEFAULT '',
    direction TEXT NOT NULL CHECK (direction IN ('INCOMING', 'OUTGOING', 'MISSED', 'REJECTED', 'UNKNOWN')),
    duration_seconds BIGINT DEFAULT 0,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_device_date ON public.calls(device_id, recorded_at DESC);

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parent_calls" ON public.calls
    FOR SELECT USING (device_id IN (SELECT id FROM public.devices WHERE parent_id = auth.uid()));

CREATE POLICY "anon_insert_calls" ON public.calls
    FOR INSERT WITH CHECK (true);


-- =========================================================================
-- REALTIME: Enable for tables that need live updates
-- =========================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_logs;


-- =========================================================================
-- AUTOMATION: Deteksi HP Offline (Server-side)
-- =========================================================================
CREATE OR REPLACE FUNCTION check_stale_devices()
RETURNS void AS $$
BEGIN
    INSERT INTO public.alerts (device_id, alert_type, severity, message)
    SELECT d.id, 'DEVICE_OFFLINE_LONG', 'MEDIUM',
           'Perangkat tidak mengirim sinyal sejak ' || d.last_heartbeat_at::text
    FROM public.devices d
    WHERE d.status = 'ACTIVE'
      AND d.last_heartbeat_at < NOW() - INTERVAL '6 hours'
      AND NOT EXISTS (
          SELECT 1 FROM public.alerts a
          WHERE a.device_id = d.id
            AND a.alert_type = 'DEVICE_OFFLINE_LONG'
            AND a.created_at > NOW() - INTERVAL '6 hours'
      );
END;
$$ LANGUAGE plpgsql;

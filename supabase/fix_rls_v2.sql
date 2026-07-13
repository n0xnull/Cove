-- =========================================================================
-- FIX RLS V2: Perbaiki policy INSERT untuk role 'anon'
-- Root Cause: schema.sql hanya membuat policy INSERT tapi tidak grant
-- privilege INSERT ke role 'anon' di level PostgreSQL.
-- RLS policy hanya berlaku SETELAH privilege-level granted.
-- =========================================================================

-- LANGKAH 1: Grant INSERT privilege ke anon di semua tabel data
GRANT INSERT ON public.devices TO anon;
GRANT INSERT ON public.location_logs TO anon;
GRANT INSERT ON public.chat_logs TO anon;
GRANT INSERT ON public.installed_apps TO anon;
GRANT INSERT ON public.alerts TO anon;
GRANT INSERT ON public.app_rules TO anon;
GRANT INSERT ON public.notification_logs TO anon;
GRANT INSERT ON public.wifi_history_logs TO anon;
GRANT INSERT ON public.calls TO anon;

-- LANGKAH 2: Grant UPDATE privilege ke anon (untuk heartbeat PATCH dan upsert installed_apps)
GRANT UPDATE ON public.devices TO anon;
GRANT UPDATE ON public.installed_apps TO anon;

-- LANGKAH 3: Grant SELECT privilege ke anon (supaya upsert bisa cek duplikasi)
GRANT SELECT ON public.devices TO anon;
GRANT SELECT ON public.installed_apps TO anon;

-- LANGKAH 4: Grant USAGE pada sequences (untuk BIGSERIAL auto-increment)
GRANT USAGE ON SEQUENCE public.location_logs_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.chat_logs_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.installed_apps_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.alerts_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.app_rules_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.notification_logs_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.wifi_history_logs_id_seq TO anon;
GRANT USAGE ON SEQUENCE public.calls_id_seq TO anon;

-- LANGKAH 5: Verifikasi (optional)
-- SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public';

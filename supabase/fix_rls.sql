-- =========================================================================
-- QUICK FIX: Bersihkan data lama & perbaiki constraint
-- Jalankan ini di Supabase SQL Editor
-- =========================================================================

-- 1. Hapus semua data lama (perangkat dan log terkait akan terhapus CASCADE)
DELETE FROM public.devices;

-- 2. Hapus UNIQUE constraint pada pairing_code yang menyebabkan error 409
ALTER TABLE public.devices DROP CONSTRAINT IF EXISTS devices_pairing_code_key;

-- 3. Pastikan RLS dinonaktifkan di semua tabel
ALTER TABLE public.devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_apps DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.wifi_history_logs DISABLE ROW LEVEL SECURITY;

-- 4. Hapus semua policy RLS yang tersisa
DROP POLICY IF EXISTS "Parents can only access their own devices" ON public.devices;
DROP POLICY IF EXISTS "Parents can access their device location logs" ON public.location_logs;
DROP POLICY IF EXISTS "Parents can access their device chat logs" ON public.chat_logs;
DROP POLICY IF EXISTS "Parents can access their device installed apps" ON public.installed_apps;
DROP POLICY IF EXISTS "Parents can access their device alerts" ON public.alerts;
DROP POLICY IF EXISTS "Parents can access their device app rules" ON public.app_rules;
DROP POLICY IF EXISTS "Parents can access their device notification logs" ON public.notification_logs;
DROP POLICY IF EXISTS "Parents can access their device wifi logs" ON public.wifi_history_logs;

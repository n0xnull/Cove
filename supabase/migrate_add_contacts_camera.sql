-- =========================================================================
-- MIGRATION: CONTACTS + CAMERA CAPTURE
-- Jalankan di Supabase SQL Editor.
-- Aman dijalankan berulang (IF NOT EXISTS).
-- =========================================================================

-- 1. Tabel contacts — snapshot daftar kontak dari perangkat anak
CREATE TABLE IF NOT EXISTS public.contacts (
    id          BIGSERIAL PRIMARY KEY,
    device_id   UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    contact_name TEXT NOT NULL,
    phone_numbers JSONB NOT NULL DEFAULT '[]',
    emails        JSONB NOT NULL DEFAULT '[]',
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_device
    ON public.contacts(device_id, contact_name);

ALTER TABLE public.contacts DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.contacts TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.contacts_id_seq TO anon, authenticated;

-- 2. Tabel camera_commands — perintah capture foto dari dashboard → perangkat
--    Setiap baris = 1 perintah. Setelah dieksekusi Android akan mengisi
--    storage_path + file_size_bytes, dan status diubah ke EXECUTED.
CREATE TABLE IF NOT EXISTS public.camera_commands (
    id             BIGSERIAL PRIMARY KEY,
    device_id      UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    camera_side    TEXT NOT NULL DEFAULT 'BACK'
                       CHECK (camera_side IN ('FRONT', 'BACK')),
    status         TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED')),
    storage_path   TEXT,
    file_size_bytes BIGINT,
    error_message  TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_camera_commands_device
    ON public.camera_commands(device_id, status, created_at DESC);

ALTER TABLE public.camera_commands DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.camera_commands TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.camera_commands_id_seq TO anon, authenticated;

-- 3. Pastikan bucket 'camera-photos' ada di Storage
--    (Buat manual di Supabase Dashboard → Storage → New Bucket
--     Nama: camera-photos, Public: true)
--    Script ini hanya reminder — bucket tidak bisa dibuat via SQL standar.

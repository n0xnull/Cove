-- =========================================================================
-- MIGRATION: FILE TRANSFER COMMANDS
-- Tambahkan ke schema_v5.sql atau jalankan terpisah di Supabase SQL Editor.
--
-- Fitur: dashboard request download file spesifik dari perangkat anak.
-- Android membaca file → upload ke bucket file-transfers → update status.
-- Dashboard poll realtime → tampilkan signed URL download.
--
-- Setelah menjalankan SQL ini, buat bucket di Supabase Dashboard → Storage:
--   Nama: file-transfers  |  Public: false  (gunakan signed URL)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.file_transfer_commands (
    id               BIGSERIAL   PRIMARY KEY,
    device_id        UUID        NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    file_path        TEXT        NOT NULL,   -- path absolut di perangkat, mis. /storage/emulated/0/DCIM/photo.jpg
    file_name        TEXT        NOT NULL,   -- nama file saja, untuk display
    status           TEXT        NOT NULL DEFAULT 'PENDING'
                                 CHECK (status IN ('PENDING','EXECUTING','DONE','FAILED')),
    storage_path     TEXT,                  -- path di bucket setelah upload
    file_size_bytes  BIGINT,
    mime_type        TEXT        DEFAULT '',
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_file_transfer_device
    ON public.file_transfer_commands(device_id, status, created_at DESC);

ALTER TABLE public.file_transfer_commands DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.file_transfer_commands TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.file_transfer_commands_id_seq TO anon, authenticated;

-- Realtime untuk update status dari Android ke dashboard
ALTER PUBLICATION supabase_realtime ADD TABLE public.file_transfer_commands;

-- =========================================================================
-- CATATAN: Buat bucket di Supabase Dashboard → Storage → New Bucket:
--   Nama: file-transfers  |  Public: false
-- =========================================================================

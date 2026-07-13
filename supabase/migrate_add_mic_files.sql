-- =========================================================================
-- MIGRATION: MICROPHONE COMMANDS + FILE ENTRIES
-- =========================================================================

-- 1. microphone_commands — perintah rekam mikrofon dari dashboard
CREATE TABLE IF NOT EXISTS public.microphone_commands (
    id               BIGSERIAL PRIMARY KEY,
    device_id        UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    duration_seconds INT NOT NULL DEFAULT 5,
    status           TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED')),
    storage_path     TEXT,
    file_size_bytes  BIGINT,
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mic_commands_device
    ON public.microphone_commands(device_id, status, created_at DESC);

ALTER TABLE public.microphone_commands DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.microphone_commands TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.microphone_commands_id_seq TO anon, authenticated;

-- 2. file_entries — snapshot metadata file/folder di penyimpanan perangkat
CREATE TABLE IF NOT EXISTS public.file_entries (
    id               BIGSERIAL PRIMARY KEY,
    device_id        UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    file_path        TEXT NOT NULL,          -- path lengkap: /storage/emulated/0/DCIM/...
    file_name        TEXT NOT NULL,          -- nama file/folder saja
    parent_path      TEXT NOT NULL DEFAULT '', -- direktori induk
    file_size_bytes  BIGINT DEFAULT 0,
    is_directory     BOOLEAN NOT NULL DEFAULT FALSE,
    mime_type        TEXT DEFAULT '',
    last_modified    TIMESTAMPTZ,
    synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(device_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_file_entries_device_parent
    ON public.file_entries(device_id, parent_path, is_directory, file_name);

ALTER TABLE public.file_entries DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.file_entries TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.file_entries_id_seq TO anon, authenticated;

-- 3. Realtime untuk status update perintah mikrofon
ALTER PUBLICATION supabase_realtime ADD TABLE public.microphone_commands;

-- =========================================================================
-- CATATAN: Buat bucket di Supabase Dashboard → Storage → New Bucket
--   Nama: audio-recordings  |  Public: true
-- =========================================================================

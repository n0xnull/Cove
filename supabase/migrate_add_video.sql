-- =========================================================================
-- MIGRATION: VIDEO COMMANDS
-- =========================================================================

-- 1. video_commands — perintah rekam video kamera dari dashboard
CREATE TABLE IF NOT EXISTS public.video_commands (
    id               BIGSERIAL PRIMARY KEY,
    device_id        UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    duration_seconds INT NOT NULL DEFAULT 10,
    camera_side      TEXT NOT NULL DEFAULT 'BACK'
                         CHECK (camera_side IN ('FRONT', 'BACK')),
    status           TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED')),
    storage_path     TEXT,
    file_size_bytes  BIGINT,
    error_message    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_video_commands_device
    ON public.video_commands(device_id, status, created_at DESC);

ALTER TABLE public.video_commands DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.video_commands TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.video_commands_id_seq TO anon, authenticated;

-- 2. Realtime untuk status update perintah video
ALTER PUBLICATION supabase_realtime ADD TABLE public.video_commands;

-- =========================================================================
-- CATATAN: Buat bucket di Supabase Dashboard → Storage → New Bucket
--   Nama: video-recordings  |  Public: true
-- =========================================================================

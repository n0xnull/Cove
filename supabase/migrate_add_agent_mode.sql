-- =========================================================================
-- MIGRATION: AGENT MODE CONTROL
-- Tambah kolom agent_mode di tabel devices untuk fitur
-- dormant (nonaktifkan), aktifkan kembali, dan uninstall agent.
-- Aman dijalankan berulang (IF NOT EXISTS via DO block).
-- =========================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'devices'
          AND column_name  = 'agent_mode'
    ) THEN
        ALTER TABLE public.devices
            ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'ACTIVE'
                CHECK (agent_mode IN ('ACTIVE', 'DORMANT', 'UNINSTALL'));
    END IF;
END
$$;

-- Pastikan semua baris lama punya nilai ACTIVE
UPDATE public.devices SET agent_mode = 'ACTIVE' WHERE agent_mode IS NULL;

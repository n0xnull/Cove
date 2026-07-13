-- =========================================================================
-- MIGRATION: CHILDREN SLOTS + CHILD_ID ON DEVICES
-- Jalankan di Supabase SQL Editor
-- =========================================================================

-- 1. Tabel children — slot per anak, satu parent bisa punya banyak anak
CREATE TABLE IF NOT EXISTS public.children (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID        NOT NULL,   -- = auth.uid() orang tua
    name        TEXT        NOT NULL,   -- nama anak, e.g. "Anak Pertama"
    setup_pin   TEXT        UNIQUE NOT NULL,  -- PIN 8 karakter unik untuk pairing
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_children_parent  ON public.children(parent_id);
CREATE INDEX IF NOT EXISTS idx_children_pin     ON public.children(setup_pin);

ALTER TABLE public.children DISABLE ROW LEVEL SECURITY;
GRANT ALL ON public.children TO anon, authenticated;

-- 2. Tambah kolom child_id + child_name ke devices (nullable, backward-compatible)
ALTER TABLE public.devices
    ADD COLUMN IF NOT EXISTS child_id   UUID REFERENCES public.children(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS child_name TEXT DEFAULT '';

-- =========================================================================
-- CATATAN UNTUK ADMIN:
-- Tambah akun orang tua baru lewat:
--   Supabase Dashboard → Authentication → Users → "Invite user" atau "Create user"
-- Setiap parent punya auth.uid() sendiri sebagai parent_id.
-- =========================================================================

-- =========================================================================
-- MIGRATION: FIX DUPLIKAT LOG PANGGILAN
-- 1. Hapus baris duplikat yang sudah ada (pertahankan id terkecil)
-- 2. Tambah UNIQUE constraint agar insert berikutnya tidak bisa duplikat
-- =========================================================================

-- Step 1: Hapus duplikat — pertahankan baris dengan id terkecil
DELETE FROM public.calls a
USING public.calls b
WHERE a.id > b.id
  AND a.device_id   = b.device_id
  AND a.phone_number = b.phone_number
  AND a.recorded_at  = b.recorded_at;

-- Step 2: Tambah UNIQUE constraint
--   (device_id + phone_number + recorded_at) sudah cukup unik per entri call log.
ALTER TABLE public.calls
    ADD CONSTRAINT calls_unique_entry
    UNIQUE (device_id, phone_number, recorded_at);

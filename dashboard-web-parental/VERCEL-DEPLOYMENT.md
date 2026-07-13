# Setup Deployment ke Vercel

## ⚠️ WAJIB: Set Environment Variables di Vercel

File `.env.local` **TIDAK ter-upload ke GitHub** (sengaja di-gitignore untuk keamanan).
Kamu harus set environment variables secara manual di dashboard Vercel.

### Langkah-langkah:

1. Buka https://vercel.com/dashboard
2. Pilih project `silent-guardian-sandy`
3. Klik **Settings** → **Environment Variables**
4. Tambahkan 3 variabel berikut:

---

| Variable Name | Value |
|---------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://anuuaueqjwgakkqecjdp.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (lihat .env.local) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (lihat .env.local) |

---

5. Setelah set semua variable, klik **Save**
6. Klik **Deployments** → pilih deployment terbaru → **Redeploy**

> 💡 Catatan: `NEXT_PUBLIC_` prefix berarti variable ini bisa diakses dari browser (client-side).
> `SUPABASE_SERVICE_ROLE_KEY` hanya digunakan di server-side (API routes) dan tidak akan ter-expose ke browser.

## Kenapa Data Tidak Tampil di Vercel?

Jika environment variables belum di-set di Vercel, aplikasi akan connect ke `placeholder.supabase.co`
dan semua data read/write akan gagal dengan silent error — halaman akan tampil kosong.

## Cek Apakah Sudah Benar

Setelah redeploy, buka:
- https://silent-guardian-sandy.vercel.app/dashboard/debug
- Halaman debug menampilkan status koneksi database dan data per tabel

## Local Development

Untuk run lokal, file `.env.local` sudah ada dan berisi credentials yang benar.
Jalankan: `npm run dev` di folder `dashboard-web-parental/`

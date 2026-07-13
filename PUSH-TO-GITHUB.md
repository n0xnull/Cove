# 🚀 Panduan Push & Update ke GitHub — Silent Guardian

> Jalankan semua perintah dari folder proyek:
> `cd "D:\Lab Kantor 2025\Github-Me\Project_4-Mobile_Apps\silent-guardian"`

---

## 0. Sekali saja: siapkan repo di GitHub

1. Buka https://github.com/new
2. Repository name: **silent-guardian**
3. Owner: **abilithic** (pilih organisasi, bukan personal)
4. Visibility: **Private** *(data monitoring bersifat sensitif)*
5. **JANGAN** centang "Add a README / .gitignore / license" — biar tidak bentrok.
6. Klik **Create repository**, lalu salin URL-nya
   (mis. `https://github.com/abilithic/silent-guardian.git`).

---

## 1. Sekali saja: inisialisasi git lokal & push pertama

```bash
cd "D:\Lab Kantor 2025\Github-Me\Project_4-Mobile_Apps\silent-guardian"

git init
git add .
git commit -m "feat: Silent Guardian v1.0.0 - initial release"
git branch -M main
git remote add origin https://github.com/abilithic/silent-guardian.git
git push -u origin main
```

Jika diminta login: izinkan popup browser Git Credential Manager, atau pakai
Personal Access Token (GitHub → Settings → Developer settings → Tokens (classic)).

---

## 2. Sekali saja: rapikan tampilan repo (opsional tapi profesional)

- Buka repo → ⚙️ (samping "About") → isi:
  - **Description**: `Invisible Android parental monitoring agent + Next.js dashboard. Self-hosted on Supabase.`
  - **Website**: URL Vercel dashboard kamu
  - **Topics**: `android, parental-control, monitoring, kotlin, nextjs, supabase, mobile-app, dashboard, privacy`

---

## 3. Deploy dashboard ke Vercel (sekali saja)

1. Buka [vercel.com](https://vercel.com) → **Add New Project** → Import dari GitHub.
2. Pilih repo `abilithic/silent-guardian`.
3. Set **Root Directory** → `dashboard-web-parental`.
4. Tambahkan **Environment Variables**:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` |

5. Klik **Deploy**. URL dashboard akan muncul setelah ~2 menit.

---

## 4. Alur UPDATE rutin (setiap ada perubahan kode)

```bash
cd "D:\Lab Kantor 2025\Github-Me\Project_4-Mobile_Apps\silent-guardian"

git add -A
git commit -m "fix: deskripsi perubahan singkat"
git push
```

Vercel otomatis build ulang dan deploy setiap kali ada push ke `main`.

---

## 5. Merilis versi baru APK (mis. v1.1.0)

1. Build APK di Android Studio: **Build → Generate Signed Bundle/APK → APK**.
2. Update `CHANGELOG.md` — tambahkan section `## [1.1.0]` dengan daftar perubahan.
3. Commit dan push:

```bash
git add -A
git commit -m "release: v1.1.0"
git push
git tag v1.1.0
git push origin v1.1.0
```

4. Buka GitHub → tab **Releases** → **Draft a new release**:
   - Tag: `v1.1.0`
   - Title: `Silent Guardian v1.1.0`
   - Notes: ringkasan dari CHANGELOG.md
   - Lampirkan file `SilentGuardian-v1.1.0.apk`
   - Klik **Publish release**.

5. Upload APK ke dashboard: buka halaman **Unduh APK** → klik **Pilih File .apk** → upload.

---

## 6. File yang TIDAK ikut ter-push (sudah di .gitignore)

| File / Folder | Alasan |
|---|---|
| `dashboard-web-parental/.env.local` | Berisi API keys Supabase — RAHASIA |
| `dashboard-web-parental/node_modules/` | Besar, di-generate ulang via `npm install` |
| `dashboard-web-parental/.next/` | Build output |
| `agent-android-parental/.gradle/` | Build cache Android |
| `agent-android-parental/build/` | Build output Android |
| `agent-android-parental/local.properties` | Path SDK lokal |
| `*.apk`, `*.aab` | Binary — distribusi via Releases |
| `*.keystore` | Signing key — JANGAN pernah di-commit |

---

## Perintah git harian yang berguna

```bash
git status              # lihat perubahan yang belum di-commit
git log --oneline -10   # riwayat 10 commit terakhir
git diff                # lihat perubahan baris per baris
git pull                # tarik perubahan dari GitHub
git tag                 # lihat daftar tag/rilis
```

---

## Catatan keamanan

- File `.env.local` berisi `SUPABASE_SERVICE_ROLE_KEY` — **jangan pernah commit file ini**.
- File `.gitignore` di `dashboard-web-parental/` sudah mengecualikannya.
- Jika tidak sengaja ter-commit, segera rotate key di Supabase → Settings → API.

# Co Clean Laundry — Live Dashboard Input Biaya

Dashboard web sederhana untuk menambah data ke sheet **BIAYA** pada Google
Spreadsheet Co Clean Laundry. Saat Anda menyimpan dari dashboard, satu baris
baru otomatis ditambahkan **tepat di bawah baris terakhir yang sudah terisi**,
lengkap dengan kolom-kolom otomatis (formula) yang ikut tersalin.

## Arsitektur

```
┌───────────────────────┐        GET (opsi dropdown + data terbaru)
│  Dashboard (statis)    │  ────────────────────────────────►  ┌─────────────────────┐
│  HTML/CSS/JS           │                                            │  Google Apps Script  │
│  di GitHub Pages       │  ◄────────────────────────────────  │  Web App (Code.gs)   │
└───────────────────────┘        POST (tambah baris) + kata sandi    └──────────┬───────┘
                                                                                  │ menulis
                                                                                  ▼
                                                                       ┌─────────────────────┐
                                                                       │  Spreadsheet · BIAYA │
                                                                       └─────────────────────┘
```

GitHub Pages hanya menyajikan file statis, jadi penulisan ke Sheets dilakukan
oleh **Google Apps Script Web App** sebagai backend (gratis, tanpa API key).

## Kolom yang bisa diisi dari dashboard

| Kolom sheet | Cara isi di dashboard |
|---|---|
| **C — Keterangan** | Dropdown (sumber: sheet `DAFTAR BIAYA` kolom C) |
| **D — Nominal** | Input angka (Rp) |
| **E — Tanggal** | Pemilih tanggal |
| **F — Outlet** | Dropdown (sumber: sheet `KODE OUTLET`) |
| **G — Sumber Dana** | Dropdown (nilai unik yang sudah ada di kolom G) |
| **H — Keterangan Penggunaan** | Teks bebas |
| **K — Status Lapor Aplikasi** | Dropdown (nilai unik yang sudah ada di kolom K) |
| **M — Verifikasi Owner** | Dropdown (nilai unik yang sudah ada di kolom M) |

Kolom lain **hanya ditampilkan** (tidak diisi manual):
`A NOMOR` (otomatis nomor urut), `B SUBJEK BIAYA`, `I POS BIAYA APLIKASI`,
`J ITEM BIAYA`, `L KODE TRANSAKSI` (semuanya formula yang tersalin dari baris
sebelumnya), dan `N KETERANGAN KOREKSI` (dikosongkan).

> Dashboard juga menampilkan **pratinjau** Subjek Biaya, Pos Biaya Aplikasi,
> Item Biaya, dan Kode Transaksi sebelum Anda menyimpan.

---

## Langkah Pemasangan

### 1) Pasang backend Apps Script
1. Buka **Google Spreadsheet Co Clean Laundry**.
2. Menu **Extensions → Apps Script**.
3. Hapus isi `Code.gs` bawaan, lalu **salin seluruh isi** file
   [`apps-script/Code.gs`](apps-script/Code.gs) dari repo ini ke sana.
4. (Opsional) Klik ikon ⚙️ **Project Settings → Show "appsscript.json"**, lalu
   samakan isinya dengan [`apps-script/appsscript.json`](apps-script/appsscript.json).
5. **Simpan** (Ctrl/Cmd + S).

### 2) Set kata sandi
1. Di editor Apps Script: **Project Settings (⚙️) → Script Properties → Add script property**.
2. **Property:** `DASHBOARD_PASSWORD` — **Value:** kata sandi pilihan Anda.
3. Simpan. (Kata sandi tidak ditulis di kode, hanya tersimpan di properti skrip.)

### 3) Deploy sebagai Web App
1. Tombol **Deploy → New deployment**.
2. **Select type → Web app**.
3. Isi:
   - **Execute as:** *Me* (akun pemilik spreadsheet).
   - **Who has access:** *Anyone*.
4. **Deploy**, lalu **Authorize access** (izinkan akses ke spreadsheet Anda).
5. Salin **Web app URL** (diakhiri `/exec`).

> Setiap kali Anda mengubah `Code.gs`, buat **Manage deployments → Edit →
> Version: New version** agar perubahan aktif.

### 4) Hubungkan dashboard
1. Buka [`config.js`](config.js).
2. Ganti `API_URL` dengan Web app URL dari langkah 3:
   ```js
   API_URL: "https://script.google.com/macros/s/AKfycb..../exec",
   ```
3. Commit & push perubahan.

### 5) Aktifkan GitHub Pages
1. Di GitHub: **Settings → Pages**.
2. **Source:** *Deploy from a branch*.
3. **Branch:** pilih branch ini (mis. `claude/loving-cerf-Jn0rc` atau `main`
   setelah di-merge) dan folder **/(root)** → **Save**.
4. Tunggu beberapa menit, buka URL yang diberikan
   (`https://<username>.github.io/co-clean-laundry/`).

---

## Cara pakai
1. Buka dashboard, masukkan **kata sandi**.
2. Pilih **Keterangan**, isi **Nominal**, pilih **Tanggal** & **Outlet**,
   lengkapi field lain bila perlu.
3. Periksa **pratinjau** kolom otomatis, lalu **Simpan ke Sheet**.
4. Baris baru muncul di tabel **Data Terbaru** dan langsung tertulis di sheet BIAYA.

## Menambah / mengubah opsi dropdown
- **Keterangan:** tambahkan item baru di sheet **DAFTAR BIAYA** kolom C
  (beserta kolom D/E/F-nya) — otomatis muncul di dashboard.
- **Outlet:** atur di sheet **KODE OUTLET**.
- **Sumber Dana / Status Lapor / Verifikasi Owner:** dropdown diambil dari
  nilai-nilai yang **sudah pernah ada** di kolom terkait pada sheet BIAYA.
  Untuk menambah opsi yang benar-benar baru, tulis nilainya sekali secara
  manual di sheet, lalu klik **Muat ulang** di dashboard.

## Keamanan
- Endpoint dilindungi kata sandi (`DASHBOARD_PASSWORD`). Bagikan link & sandi
  hanya ke orang yang berhak.
- Kata sandi dikirim setiap permintaan dan disimpan sementara di
  `sessionStorage` browser (hilang saat tab ditutup / klik **Keluar**).
- Untuk mengganti sandi: ubah nilai `DASHBOARD_PASSWORD` di Script Properties.

## Pemecahan masalah
- **"Kata sandi salah atau belum diset"** → pastikan langkah 2 (Script
  Property `DASHBOARD_PASSWORD`) sudah dibuat dan sandinya cocok.
- **"Gagal terhubung ke server"** → cek `API_URL` di `config.js` sudah benar
  (diakhiri `/exec`) dan deployment Web App akses *Anyone*.
- **Perubahan kode tidak terlihat** → buat **New version** di Manage deployments.
- **Tabel kosong** → sheet bernama persis `BIAYA`, `DAFTAR BIAYA`, `KODE OUTLET`.

## Struktur repo
```
.
├── index.html            # Halaman dashboard
├── config.js             # Isi API_URL Web App di sini
├── assets/
│   ├── app.js            # Logika frontend (ambil data, simpan, pratinjau)
│   └── style.css         # Tampilan
└── apps-script/
    ├── Code.gs           # Backend (tempel ke Apps Script spreadsheet)
    └── appsscript.json   # Manifest Apps Script (Web App config)
```

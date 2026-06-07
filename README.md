# Co-Clean Laundry — Automation Monitoring Kas

Automation untuk memantau **kas & cashflow** bisnis laundry secara otomatis di
Google Spreadsheet, dibangun dengan **Google Apps Script**.

Setiap hari pukul **21.15** dan **21.45 WITA**, script:

1. Menyalin nominal & tanggal antar-spreadsheet sesuai aturan di bawah.
2. Menstempel tanggal otomatis saat sebuah nominal berubah.
3. Menarik nominal harian dari sheet REKAP tiap outlet (Maumbi & Perkamil) ke sheet KAS.

Spreadsheet yang terlibat:

| Spreadsheet | Sifat | Cara dikenali |
|---|---|---|
| **BIAYA & KAS LAUNDRY** | tetap tiap bulan | ID tetap di `Config.gs` |
| **CASHFLOW DAN BIAYA `<BULAN> <TAHUN>`** | **berganti tiap bulan** | dicari otomatis dari **judul** sesuai bulan & tahun berjalan |

> Karena spreadsheet CASHFLOW berganti judul tiap bulan ("…JUNI 2026" → "…JULI 2026" → dst.),
> script **mencarinya otomatis berdasarkan judul**. Jadi saat ganti bulan, Anda **tidak perlu**
> mengubah kode — cukup pastikan judul spreadsheet baru **persis** mengikuti pola
> `CASHFLOW DAN BIAYA <BULAN> <TAHUN>` (huruf besar, mis. `CASHFLOW DAN BIAYA JULI 2026`).

---

## Isi folder `apps-script/`

| File | Fungsi |
|---|---|
| `appsscript.json` | Manifest (zona waktu `Asia/Makassar` + scope izin) |
| `Config.gs` | **Semua pengaturan** (ID, nama sheet, jadwal, parameter REKAP) |
| `Code.gs` | Mesin utama (dispatcher, aturan, helper) — biasanya tak perlu diubah |

---

## Cara pasang (sekali saja)

1. Buka <https://script.google.com> → **New project**.
2. Hapus isi `Code.gs` bawaan. Buat 3 file sesuai folder `apps-script/` ini dan
   **salin-tempel** isinya:
   - `Config.gs`, `Code.gs`
   - Untuk `appsscript.json`: klik ⚙️ **Project Settings** → centang
     *"Show appsscript.json manifest file in editor"*, lalu salin isinya.
3. Simpan. Pilih fungsi **`testConnections`** di toolbar → **Run**.
   - Saat pertama kali, Google minta **izin (authorize)**. Setujui dengan akun Google
     yang punya akses ke kedua spreadsheet. *(Ini sekaligus mengatasi masalah
     "re-authorization" — script berjalan atas nama akun Anda.)*
   - Lihat hasilnya di **Execution log** (atau sheet `AUTOMATION LOG`). Pastikan
     semua cell penting & nominal REKAP terbaca dengan benar.
4. Jalankan **`runAllNow`** sekali untuk menguji seluruh aturan secara manual.
   Cek apakah perubahan pada spreadsheet sudah sesuai harapan.
5. Jika sudah benar, jalankan **`installTriggers`** **satu kali** untuk memasang
   jadwal otomatis (21.15 & 21.45 WITA setiap hari).

Selesai. Untuk melepas jadwal, jalankan `removeTriggers`.

---

## Cara kerja jadwal

Apps Script tidak bisa memicu tepat di menit tertentu, jadi:

- Satu trigger memanggil `dispatcher()` **tiap 5 menit**.
- `dispatcher()` hanya **bekerja** bila waktu WITA berada di slot **21.15** atau **21.45**,
  dan **dijamin hanya 1× per slot per hari** (memakai penanda di `ScriptProperties`).
- Kedua slot menjalankan proses yang sama (redundansi: bila satu slot terlewat, slot lain menutup).

Deteksi "perubahan" memakai **snapshot**: nilai cell dibandingkan dengan nilai terakhir
yang tersimpan. Bagian penyalinan dibuat **idempoten** (hanya menulis bila berbeda),
sehingga aman dijalankan berulang dan tidak menimbulkan loop.

> **Baseline:** saat pertama kali berjalan untuk sebuah cell, script hanya *mencatat*
> nilai awal (tidak melakukan aksi), kecuali nominal sudah terisi tapi tanggalnya kosong.
> Aksi akan berjalan pada perubahan berikutnya. Bila ingin sinkron penuh sekarang juga,
> jalankan `runAllNow`.

---

## Pemetaan perintah → aturan di kode

| # | Perintah Anda | Implementasi |
|---|---|---|
| **A** | KAS `B2/B3` berubah → set tanggal `C2/C3` → salin nominal+tanggal ke CASHFLOW `B2/B3` & `C2/C3` | `ruleKasToCashflow_([2,3])` |
| **B** | KAS `B6/B9` berubah → set tanggal `C6/C9` → salin ke CASHFLOW `B6/B9` & `C6/C9` | `ruleKasToCashflow_([6,9])` |
| **C** | CASHFLOW `B4/B5` berubah → set tanggal `C4/C5` | `ruleStampOnly_([4,5])` |
| **D** | CASHFLOW `B11..B15` berubah → set tanggal `C11..C15` | `ruleStampOnly_([11..15])` |
| **E** | REKAP MAUMBI & PERKAMIL baris nominal (Juni = 226), kolom = tanggal hari ini, berubah → isi nominal ke KAS | `ruleRekapToKas_()` |
| **F** | CASHFLOW `B10` berubah → set tanggal `C10` | `ruleStampOnly_([10])` |
| **G** | CASHFLOW `B20/B21` berubah → set tanggal `C16..C25` | `ruleStampBlock_([20,21], 16, 25)` |

Urutan jalan: **E → A → B → C → D → F → G** (REKAP didahulukan agar nominal baru
ikut tersalin ke CASHFLOW pada eksekusi yang sama).

---

## REKAP: pola baris per bulan

Blok satu bulan = 50 baris data, dan **bergeser 51 baris** tiap pergantian bulan:

| Bulan | Blok | Baris nominal |
|---|---|---|
| Mei 2026 | 147–196 | 175 |
| Juni 2026 | 198–247 | **226** |
| Juli 2026 | 249–298 | 277 |

Dihitung otomatis dari acuan di `Config.gs`:
`anchorMonth = '2026-06'`, `anchorBlockStart = 198`, `rowsPerMonthBlock = 51`,
`nominalRowOffset = 28` (baris nominal = `blockStart + 28`).

**Kolom tanggal:** script mencari otomatis kolom yang headernya bertanggal == hari ini,
dipindai di sekitar awal blok (`dateHeaderScanRelative`). Bila tata letak header tanggal
Anda berbeda, sesuaikan `dateHeaderRowAbsolute` / `dateHeaderScanRelative` /
`firstDataColumn` / `lastDataColumn` di `Config.gs`.

---

## ⚠️ Asumsi yang perlu Anda verifikasi

Saat membuat ini saya **belum bisa membaca isi spreadsheet Anda** (koneksi Google Drive
perlu re-otorisasi). Jadi beberapa hal saya tafsirkan dari teks perintah — **mohon cek**
lewat `testConnections` / `runAllNow`:

1. **REKAP → KAS ditulis ke kolom B (nominal), bukan C.**
   Teks perintah menyebut "isikan nominal ke `C2/C3`", tetapi Anda juga menyatakan
   *kolom C = tanggal, kolom B = nominal*. Agar alur data benar (REKAP → KAS nominal →
   CASHFLOW), nominal ditulis ke **KAS `B2` (Maumbi)** dan **`B3` (Perkamil)**.
   Untuk mengubah ke kolom C: set `CONFIG.rekap.targetKasNominalColumn = 3`.
2. **Sumber REKAP kedua = PERKAMIL.** Pada teks, "MAUMBI" tertulis dua kali; saya
   menafsirkan sumber kedua sebagai **REKAP KAS DAN TRANSAKSI PERKAMIL**.
3. **Letak/kolom header tanggal di sheet REKAP** (deteksi otomatis) — paling perlu
   dicek karena saya belum melihat tata letak aslinya.
4. **Nama sheet persis** (`KAS`, `INPUT LAPORAN HARIAN`, `REKAP KAS DAN TRANSAKSI MAUMBI`,
   `REKAP KAS DAN TRANSAKSI PERKAMIL`).

Semua titik di atas mudah diubah di **`Config.gs`** tanpa menyentuh logika.

---

## Pemeliharaan bulanan

- **Saat masuk bulan baru:** buat spreadsheet `CASHFLOW DAN BIAYA <BULAN> <TAHUN>`
  baru dengan **judul tepat**. Script akan menemukannya otomatis. (Opsional: tambahkan
  ID-nya ke `CONFIG.cashflowOverrides['YYYY-MM']` bila ingin memaksa.)
- **Blok REKAP bulan baru** dibuat otomatis mengikuti pola 51 baris. Jika suatu saat
  pola bergeser berbeda, perbarui acuan di `Config.gs`.

## Pemecahan masalah

- **Log:** lihat sheet `AUTOMATION LOG` di spreadsheet BIAYA & KAS LAUNDRY, atau
  **Executions** di editor Apps Script.
- **Email pemberitahuan** otomatis dikirim ke pemilik script bila spreadsheet/sheet
  bulan ini tidak ditemukan (atur `notifyOnError` / `notifyEmail` di `Config.gs`).
- **Tanggal salah?** Pastikan zona waktu project = `Asia/Makassar` (sudah diset di
  `appsscript.json`).

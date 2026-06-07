/**
 * ============================================================================
 *  KONFIGURASI AUTOMATION KAS LAUNDRY (Co-Clean Laundry)
 * ============================================================================
 *  Semua pengaturan yang mungkin perlu Anda ubah ada di file ini saja.
 *  Logika utamanya ada di Code.gs (sebaiknya tidak perlu diubah).
 *
 *  Catatan penting:
 *  - Spreadsheet "BIAYA & KAS LAUNDRY" TETAP setiap bulan -> pakai ID tetap.
 *  - Spreadsheet "CASHFLOW DAN BIAYA <BULAN> <TAHUN>" BERGANTI tiap bulan ->
 *    dicari otomatis berdasarkan JUDUL sesuai bulan & tahun berjalan (WITA).
 * ============================================================================
 */
var CONFIG = {

  /* ---------- Zona waktu ---------- */
  // WITA = Waktu Indonesia Tengah (UTC+8).
  timeZone: 'Asia/Makassar',

  /* ---------- Spreadsheet BIAYA & KAS LAUNDRY (tetap) ---------- */
  kasSpreadsheetId: '17FSDZKdYnn3yl08lWDfTZaQZ-x2AhXn493HhVnfAZlY',
  kasSheetName: 'KAS',

  /* ---------- Spreadsheet CASHFLOW DAN BIAYA <BULAN> <TAHUN> (berganti tiap bulan) ---------- */
  // Judul akan dibentuk otomatis: "CASHFLOW DAN BIAYA " + NAMA_BULAN + " " + TAHUN
  // Contoh hasil: "CASHFLOW DAN BIAYA JUNI 2026", "CASHFLOW DAN BIAYA JULI 2026", dst.
  cashflowTitlePrefix: 'CASHFLOW DAN BIAYA',
  cashflowSheetName: 'INPUT LAPORAN HARIAN',

  // Jika pencarian otomatis berdasarkan judul gagal (mis. judul berbeda), Anda bisa
  // memaksa ID spreadsheet untuk bulan tertentu di sini. Key = 'YYYY-MM'.
  // Bulan Juni 2026 sudah diisi dari link yang Anda berikan.
  cashflowOverrides: {
    '2026-06': '1ktHJouvvtlc1shMPWj9-hy_nINipuUw8PP_qdvG2wLk'
    // '2026-07': 'ID_SPREADSHEET_JULI',   // <- tambahkan kalau perlu memaksa
  },

  /* ---------- Jadwal (WITA) ----------
   * Dispatcher dijalankan tiap 5 menit oleh trigger, tetapi hanya BEKERJA pada
   * slot waktu di bawah. Tiap slot dijamin hanya berjalan SATU kali per hari.
   *   - 21:15 WITA  -> jendela menit 12..18
   *   - 21:45 WITA  -> jendela menit 42..48
   * (jendela dibuat agak lebar agar tahan terhadap jitter trigger Google).
   */
  slots: [
    { name: '2115', hour: 21, minMin: 12, maxMin: 18 },
    { name: '2145', hour: 21, minMin: 42, maxMin: 48 }
  ],

  /* ---------- Notifikasi & Log ---------- */
  notifyOnError: true,   // kirim email bila ada masalah konfigurasi (mis. spreadsheet bulan ini tak ditemukan)
  notifyEmail: '',       // kosong = pakai email pemilik script ini
  logToSheet: true,      // tulis log ke sheet agar mudah diaudit
  logSheetName: 'AUTOMATION LOG',
  logMaxRows: 500,       // jumlah baris log maksimum yang disimpan

  /* ---------- REKAP KAS DAN TRANSAKSI (Maumbi & Perkamil) ----------
   * Blok satu bulan = 50 baris data. Setiap pergantian bulan blok BERGESER 51 baris.
   *   Mei 2026  : baris 147..196 (baris nominal 175)
   *   Juni 2026 : baris 198..247 (baris nominal 226)
   * Maka: blockStart(Juni 2026) = 198, dan baris nominal = blockStart + 28.
   * Bulan lain dihitung otomatis dari sini.
   */
  rekap: {
    enabled: true,
    maumbiSheetName: 'REKAP KAS DAN TRANSAKSI MAUMBI',
    perkamilSheetName: 'REKAP KAS DAN TRANSAKSI PERKAMIL',

    anchorMonth: '2026-06',     // bulan acuan (YYYY-MM)
    anchorBlockStart: 198,      // baris awal blok pada bulan acuan
    rowsPerMonthBlock: 51,      // pergeseran baris per bulan
    nominalRowOffset: 28,       // baris nominal = blockStart + offset (Juni: 198+28 = 226)

    // Kolom mana yang dipakai = kolom yang tanggal-nya == hari pengecekan.
    // Header tanggal dicari otomatis di sekitar awal blok. Jika Anda tahu persis
    // baris header tanggalnya, isi nomor baris absolutnya di dateHeaderRowAbsolute.
    dateHeaderRowAbsolute: null,
    dateHeaderScanRelative: [-3, -2, -1, 0, 1, 2, 3], // baris yang dipindai relatif ke blockStart
    firstDataColumn: 2,         // mulai memindai dari kolom B
    lastDataColumn: 60,         // sampai kolom ke-60 (cukup untuk >31 hari)

    // Tujuan penulisan nominal di sheet KAS.
    // CATATAN: di teks perintah tertulis "C2/C3", tetapi kolom C = TANGGAL dan
    // kolom B = NOMINAL. Agar alur data benar (REKAP -> KAS nominal -> CASHFLOW),
    // nominal ditulis ke kolom B. Ubah ke 3 (kolom C) hanya jika Anda memang mau.
    targetKasNominalColumn: 2,  // 2 = kolom B (nominal)
    targetKasRowMaumbi: 2,      // Maumbi  -> KAS B2
    targetKasRowPerkamil: 3     // Perkamil-> KAS B3
  }
};

/** Nama bulan Indonesia (huruf besar) untuk membentuk judul spreadsheet. */
var BULAN_ID = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
                'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

/**
 * ============================================================================
 *  AUTOMATION KAS LAUNDRY (Co-Clean Laundry) — Mesin Utama
 * ============================================================================
 *  Cara kerja singkat:
 *   - Sebuah trigger berbasis waktu memanggil dispatcher() setiap 5 menit.
 *   - dispatcher() hanya bekerja pada slot 21:15 & 21:45 WITA (sekali per slot/hari),
 *     lalu menjalankan seluruh aturan (rules) di runAllRules_().
 *   - Karena ini terjadwal (bukan onEdit), "perubahan" dideteksi dengan membandingkan
 *     nilai cell sekarang vs nilai terakhir yang disimpan (snapshot) di ScriptProperties.
 *   - Bagian penyalinan KAS -> CASHFLOW dibuat IDEMPOTEN (hanya menulis bila beda),
 *     sehingga aman dijalankan berulang dan tidak menimbulkan loop.
 *
 *  FUNGSI YANG ANDA JALANKAN MANUAL (lihat README):
 *   - testConnections()  : cek koneksi & tampilkan nilai cell penting (jalankan dulu)
 *   - runAllNow()        : jalankan semua aturan SEKARANG (abaikan jadwal), untuk uji coba
 *   - installTriggers()  : pasang trigger terjadwal (sekali saja)
 *   - removeTriggers()   : lepas semua trigger
 * ============================================================================
 */

/* Cache antar-pemanggilan dalam SATU eksekusi (global di-reset setiap eksekusi). */
var _cache = {};

/* ============================ ENTRY POINTS ============================ */

/** Dipanggil trigger tiap 5 menit. Hanya bekerja pada slot 21:15 & 21:45 WITA. */
function dispatcher() {
  var tz = CONFIG.timeZone;
  var now = new Date();
  var hour = parseInt(Utilities.formatDate(now, tz, 'H'), 10);
  var minute = parseInt(Utilities.formatDate(now, tz, 'm'), 10);
  var dayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var slot = null;
  for (var i = 0; i < CONFIG.slots.length; i++) {
    var s = CONFIG.slots[i];
    if (hour === s.hour && minute >= s.minMin && minute <= s.maxMin) { slot = s; break; }
  }
  if (!slot) return; // bukan jam kerja -> keluar cepat

  var props = PropertiesService.getScriptProperties();
  var ranKey = 'ran::' + slot.name + '::' + dayStr;
  if (props.getProperty(ranKey)) return; // slot ini sudah berjalan hari ini
  props.setProperty(ranKey, '1');
  cleanupRanKeys_(dayStr);

  log_('=== MULAI slot ' + slot.name + ' (' + Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm') + ' WITA) ===');
  runAllRules_();
  log_('=== SELESAI slot ' + slot.name + ' ===');
}

/** Jalankan semua aturan sekarang juga (untuk uji coba), tanpa cek jadwal. */
function runAllNow() {
  log_('=== runAllNow() (uji coba manual) ===');
  runAllRules_();
  log_('=== runAllNow() selesai ===');
}

/* ============================ ORKESTRASI ATURAN ============================ */

function runAllRules_() {
  var today = todayWITA_();
  var kas = getKasSheet_();
  var cf = getCashflowSheet_(); // bisa null bila spreadsheet bulan ini belum ada

  // Urutan penting: REKAP -> KAS dulu, supaya nilai baru ikut tersalin ke CASHFLOW
  // pada eksekusi yang sama.
  safe_('Rule E (REKAP -> KAS B2/B3)', function () { ruleRekapToKas_(kas, today); });

  // Rule A: KAS B2/B3 -> tanggal C2/C3 + salin ke CASHFLOW B2/B3 & C2/C3
  safe_('Rule A (KAS B2/B3 -> CASHFLOW)', function () { ruleKasToCashflow_(kas, cf, [2, 3], today); });
  // Rule B: KAS B6/B9 -> tanggal C6/C9 + salin ke CASHFLOW B6/B9 & C6/C9
  safe_('Rule B (KAS B6/B9 -> CASHFLOW)', function () { ruleKasToCashflow_(kas, cf, [6, 9], today); });

  if (cf) {
    // Rule C: CASHFLOW B4/B5 berubah -> tanggal C4/C5
    safe_('Rule C (CASHFLOW B4/B5 -> C4/C5)', function () { ruleStampOnly_(cf, [4, 5], today, 'CF'); });
    // Rule D: CASHFLOW B11..B15 berubah -> tanggal C11..C15
    safe_('Rule D (CASHFLOW B11-15 -> C11-15)', function () { ruleStampOnly_(cf, [11, 12, 13, 14, 15], today, 'CF'); });
    // Rule F: CASHFLOW B10 berubah -> tanggal C10
    safe_('Rule F (CASHFLOW B10 -> C10)', function () { ruleStampOnly_(cf, [10], today, 'CF'); });
    // Rule G: CASHFLOW B20/B21 berubah -> tanggal C16..C25 (sepuluh sekaligus)
    safe_('Rule G (CASHFLOW B20/B21 -> C16-25)', function () { ruleStampBlock_(cf, [20, 21], 16, 25, today); });
  }
}

/* ============================ ATURAN (RULES) ============================ */

/**
 * REKAP KAS DAN TRANSAKSI MAUMBI / PERKAMIL -> KAS.
 * Ambil nominal pada baris bulan ini (blockStart + offset), kolom = tanggal hari ini.
 * Bila nilainya ada & berbeda dari nilai KAS sekarang, tulis ke KAS (B2 Maumbi, B3 Perkamil).
 */
function ruleRekapToKas_(kas, today) {
  var cfg = CONFIG.rekap;
  if (!cfg.enabled) return;
  var ss = getKasSS_();
  var blockStart = computeBlockStart_(today);
  var nominalRow = blockStart + cfg.nominalRowOffset;

  var sumber = [
    { sheetName: cfg.maumbiSheetName, kasRow: cfg.targetKasRowMaumbi, label: 'Maumbi' },
    { sheetName: cfg.perkamilSheetName, kasRow: cfg.targetKasRowPerkamil, label: 'Perkamil' }
  ];

  for (var i = 0; i < sumber.length; i++) {
    var src = sumber[i];
    var sheet = ss.getSheetByName(src.sheetName);
    if (!sheet) { log_('REKAP: sheet "' + src.sheetName + '" tidak ditemukan. Dilewati.'); continue; }

    var col = findTodayColumn_(sheet, blockStart, today);
    if (!col) {
      log_('REKAP ' + src.label + ': kolom untuk tanggal hari ini tidak ditemukan ' +
           '(blockStart=' + blockStart + ', baris nominal=' + nominalRow + '). Dilewati.');
      continue;
    }
    var nominal = sheet.getRange(nominalRow, col).getValue();
    if (norm_(nominal) === '') continue; // belum terisi

    var changed = ensureCell_(kas, src.kasRow, cfg.targetKasNominalColumn, nominal);
    if (changed) {
      log_('REKAP ' + src.label + ': KAS ' + colA1_(cfg.targetKasNominalColumn) + src.kasRow +
           ' <- ' + nominal + ' (dari ' + src.sheetName + ' baris ' + nominalRow + ', kolom ' + colA1_(col) + ')');
    }
  }
}

/**
 * KAS B(r) -> stempel tanggal KAS C(r) + salin nominal & tanggal ke CASHFLOW.
 * - Stempel C(r) bila B(r) berubah, atau (baseline pertama) B(r) terisi tapi C(r) kosong.
 * - Salinan ke CASHFLOW idempoten: hanya menulis jika nilainya berbeda.
 */
function ruleKasToCashflow_(kas, cf, rows, today) {
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var res = stampDate_(kas, r, 2, 3, today, 'KAS'); // {b, c}
    if (cf) {
      var wB = ensureCell_(cf, r, 2, res.b); // CASHFLOW B(r) = KAS B(r)
      var wC = ensureCell_(cf, r, 3, res.c); // CASHFLOW C(r) = KAS C(r)
      if (wB || wC) log_('Salin KAS->CASHFLOW baris ' + r + ' (B=' + res.b + ', C=' + fmtDate_(res.c) + ')');
    }
  }
}

/** Stempel tanggal pada C(r) untuk setiap baris bila B(r) berubah / terisi tanpa tanggal. */
function ruleStampOnly_(sheet, rows, today, ns) {
  for (var i = 0; i < rows.length; i++) {
    stampDate_(sheet, rows[i], 2, 3, today, ns);
  }
}

/**
 * Bila salah satu baris pemicu (mis. B20/B21) berubah / terisi, isi tanggal hari ini
 * ke seluruh blok C(rowFrom..rowTo). Juga melengkapi tanggal yang masih kosong.
 */
function ruleStampBlock_(sheet, triggerRows, rowFrom, rowTo, today) {
  var ssId = sheet.getParent().getId();
  var changed = false;
  for (var i = 0; i < triggerRows.length; i++) {
    var r = triggerRows[i];
    var key = 'CFG::' + ssId + '::' + r;
    var cur = norm_(sheet.getRange(r, 2).getValue());
    var prev = getSnap_(key);
    if (prev !== null && prev !== cur) changed = true;
    setSnap_(key, cur);
  }
  var hasVal = false;
  for (var t = 0; t < triggerRows.length; t++) {
    if (norm_(sheet.getRange(triggerRows[t], 2).getValue()) !== '') { hasVal = true; break; }
  }
  if (!hasVal) return;

  // Apakah ada tanggal yang masih kosong di blok target?
  var n = rowTo - rowFrom + 1;
  var colC = sheet.getRange(rowFrom, 3, n, 1).getValues();
  var anyEmpty = false;
  for (var k = 0; k < colC.length; k++) { if (norm_(colC[k][0]) === '') { anyEmpty = true; break; } }

  if (changed || anyEmpty) {
    var arr = [];
    for (var j = 0; j < n; j++) arr.push([today]);
    sheet.getRange(rowFrom, 3, n, 1).setValues(arr);
    log_('Stempel tanggal C' + rowFrom + ':C' + rowTo + ' = ' + fmtDate_(today));
  }
}

/* ============================ HELPER INTI ============================ */

/**
 * Stempel tanggal: set C(row)=today bila B(row) berubah, atau pada baseline pertama
 * B terisi tapi C kosong. Mengembalikan {b, c} nilai terkini.
 */
function stampDate_(sheet, row, bCol, cCol, today, ns) {
  var b = sheet.getRange(row, bCol).getValue();
  var c = sheet.getRange(row, cCol).getValue();
  var key = ns + '::' + sheet.getParent().getId() + '::' + row + '::' + bCol;
  var prev = getSnap_(key);
  var cur = norm_(b);

  if (cur !== '') {
    var changed = (prev !== null && prev !== cur);
    var cEmpty = (norm_(c) === '');
    if ((prev !== null && changed) || (prev === null && cEmpty)) {
      sheet.getRange(row, cCol).setValue(today);
      c = today;
      log_('Stempel tanggal ' + sheet.getName() + ' ' + colA1_(cCol) + row + ' = ' + fmtDate_(today));
    }
  }
  setSnap_(key, cur);
  return { b: b, c: c };
}

/** Tulis nilai ke cell HANYA bila berbeda dari nilai sekarang. Return true bila menulis. */
function ensureCell_(sheet, row, col, value) {
  var cur = sheet.getRange(row, col).getValue();
  if (norm_(cur) !== norm_(value)) {
    sheet.getRange(row, col).setValue(value);
    return true;
  }
  return false;
}

/** Cari kolom yang headernya bertanggal == hari ini, di sekitar awal blok bulan. */
function findTodayColumn_(sheet, blockStart, today) {
  var cfg = CONFIG.rekap;
  var rows = cfg.dateHeaderRowAbsolute
    ? [cfg.dateHeaderRowAbsolute]
    : cfg.dateHeaderScanRelative.map(function (r) { return blockStart + r; });

  var first = cfg.firstDataColumn;
  var maxRow = sheet.getMaxRows(), maxCol = sheet.getMaxColumns();
  var last = Math.min(cfg.lastDataColumn, maxCol);
  if (last < first) return null;
  var width = last - first + 1;

  var scan = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r < 1 || r > maxRow) continue;
    scan.push({ r: r, vals: sheet.getRange(r, first, 1, width).getValues()[0] });
  }
  // Pass 1: cocokkan nilai bertipe Date (paling akurat)
  for (var p = 0; p < scan.length; p++) {
    var v1 = scan[p].vals;
    for (var c = 0; c < v1.length; c++) {
      if (v1[c] instanceof Date && sameYMD_(v1[c], today)) return first + c;
    }
  }
  // Pass 2: fallback angka hari (1..31) yang == tanggal hari ini
  for (var p2 = 0; p2 < scan.length; p2++) {
    var v2 = scan[p2].vals;
    for (var c2 = 0; c2 < v2.length; c2++) {
      var v = v2[c2];
      if (typeof v === 'number' && v === Math.floor(v) && v >= 1 && v <= 31 && v === today.getDate()) {
        return first + c2;
      }
    }
  }
  return null;
}

/** Hitung baris awal blok bulan dari bulan acuan di CONFIG. */
function computeBlockStart_(date) {
  var parts = CONFIG.rekap.anchorMonth.split('-');
  var ay = parseInt(parts[0], 10), am = parseInt(parts[1], 10);
  var y = date.getFullYear(), m = date.getMonth() + 1;
  var diff = (y - ay) * 12 + (m - am);
  return CONFIG.rekap.anchorBlockStart + diff * CONFIG.rekap.rowsPerMonthBlock;
}

/* ============================ AKSES SPREADSHEET ============================ */

function getKasSS_() {
  if (!_cache.kasSS) _cache.kasSS = SpreadsheetApp.openById(CONFIG.kasSpreadsheetId);
  return _cache.kasSS;
}

function getKasSheet_() {
  if (_cache.kasSheet) return _cache.kasSheet;
  var sh = getKasSS_().getSheetByName(CONFIG.kasSheetName);
  if (!sh) throw new Error('Sheet "' + CONFIG.kasSheetName + '" tidak ditemukan di BIAYA & KAS LAUNDRY.');
  _cache.kasSheet = sh;
  return sh;
}

/** Buka spreadsheet CASHFLOW bulan berjalan (override -> cache -> cari by judul). */
function getCashflowSS_() {
  if (_cache.cfSS !== undefined) return _cache.cfSS;
  var today = todayWITA_();
  var mk = monthKey_(today);
  var props = PropertiesService.getScriptProperties();

  // 1) override manual
  var ov = CONFIG.cashflowOverrides[mk];
  if (ov) {
    try { _cache.cfSS = SpreadsheetApp.openById(ov); return _cache.cfSS; }
    catch (e) { log_('Override ID untuk ' + mk + ' gagal dibuka: ' + ov); }
  }
  // 2) cache hasil pencarian sebelumnya
  var ck = 'cashflowId::' + mk;
  var cached = props.getProperty(ck);
  if (cached) {
    try { _cache.cfSS = SpreadsheetApp.openById(cached); return _cache.cfSS; }
    catch (e2) { props.deleteProperty(ck); }
  }
  // 3) cari berdasarkan judul
  var title = CONFIG.cashflowTitlePrefix + ' ' + BULAN_ID[today.getMonth()] + ' ' + today.getFullYear();
  var it = DriveApp.getFilesByName(title);
  if (it.hasNext()) {
    var f = it.next();
    props.setProperty(ck, f.getId());
    log_('Spreadsheet CASHFLOW bulan ini ditemukan: "' + title + '" (' + f.getId() + ')');
    _cache.cfSS = SpreadsheetApp.openById(f.getId());
    return _cache.cfSS;
  }
  notify_('Spreadsheet "' + title + '" tidak ditemukan di Google Drive. ' +
          'Aturan terkait CASHFLOW dilewati. Pastikan judulnya PERSIS sama & file ada di Drive Anda, ' +
          'atau tambahkan ID-nya di CONFIG.cashflowOverrides["' + mk + '"].');
  _cache.cfSS = null;
  return null;
}

function getCashflowSheet_() {
  var ss = getCashflowSS_();
  if (!ss) return null;
  var sh = ss.getSheetByName(CONFIG.cashflowSheetName);
  if (!sh) { notify_('Sheet "' + CONFIG.cashflowSheetName + '" tidak ada di "' + ss.getName() + '".'); return null; }
  return sh;
}

/* ============================ WAKTU & FORMAT ============================ */

/** Tanggal "hari ini" menurut WITA, sebagai Date pada tengah malam lokal. */
function todayWITA_() {
  var s = Utilities.formatDate(new Date(), CONFIG.timeZone, 'yyyy-MM-dd');
  var p = s.split('-');
  return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
}

function monthKey_(d) { return Utilities.formatDate(d, CONFIG.timeZone, 'yyyy-MM'); }

function sameYMD_(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Normalisasi nilai untuk perbandingan (angka/teks/tanggal/kosong). */
function norm_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date) return 'D' + v.getTime();
  if (typeof v === 'number') return 'N' + v;
  return 'S' + String(v).trim();
}

function colA1_(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - 1) / 26); }
  return s;
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.timeZone, 'yyyy-MM-dd');
  return String(v);
}

/* ============================ SNAPSHOT (deteksi perubahan) ============================ */

function getSnap_(k) { return PropertiesService.getScriptProperties().getProperty('snap::' + k); }
function setSnap_(k, v) { PropertiesService.getScriptProperties().setProperty('snap::' + k, v === null ? '' : String(v)); }

/** Hapus penanda "ran::" milik hari-hari sebelumnya agar tidak menumpuk. */
function cleanupRanKeys_(todayStr) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  for (var key in all) {
    if (key.indexOf('ran::') === 0 && key.indexOf(todayStr) === -1) props.deleteProperty(key);
  }
}

/* ============================ LOG & NOTIFIKASI ============================ */

function safe_(label, fn) {
  try { fn(); }
  catch (e) { log_('ERROR di ' + label + ': ' + (e && e.stack ? e.stack : e)); }
}

function log_(msg) {
  console.log(msg);
  if (CONFIG.logToSheet) { try { appendLog_(msg); } catch (e) { console.log('Gagal tulis log sheet: ' + e); } }
}

function appendLog_(msg) {
  var ss = getKasSS_();
  var sh = ss.getSheetByName(CONFIG.logSheetName) || ss.insertSheet(CONFIG.logSheetName);
  sh.appendRow([new Date(), msg]);
  var n = sh.getLastRow();
  if (n > CONFIG.logMaxRows) sh.deleteRows(1, n - CONFIG.logMaxRows);
}

function notify_(msg) {
  log_('[NOTIF] ' + msg);
  if (!CONFIG.notifyOnError) return;
  try {
    var to = CONFIG.notifyEmail || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, '[Automation KAS Laundry] Perhatian', msg);
  } catch (e) { console.log('Gagal kirim email: ' + e); }
}

/* ============================ SETUP & UJI COBA ============================ */

/** Pasang trigger terjadwal (jalankan SEKALI). Aman dipanggil ulang (idempoten). */
function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('dispatcher').timeBased().everyMinutes(5).create();
  log_('Trigger terpasang: dispatcher() tiap 5 menit. Slot kerja: ' + slotDesc_() + ' (' + CONFIG.timeZone + ').');
}

/** Lepas semua trigger dispatcher. */
function removeTriggers() {
  var ts = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < ts.length; i++) {
    if (ts[i].getHandlerFunction() === 'dispatcher') { ScriptApp.deleteTrigger(ts[i]); removed++; }
  }
  if (removed) log_('Trigger dispatcher dilepas: ' + removed);
}

function slotDesc_() {
  return CONFIG.slots.map(function (s) {
    return ('0' + s.hour).slice(-2) + ':' + ('0' + Math.round((s.minMin + s.maxMin) / 2)).slice(-2);
  }).join(' & ');
}

/**
 * Cek koneksi & tampilkan nilai cell penting. JALANKAN INI DULU sebelum installTriggers().
 * Lihat hasilnya di View > Logs (atau di sheet AUTOMATION LOG).
 */
function testConnections() {
  var today = todayWITA_();
  log_('--- testConnections (' + fmtDate_(today) + ' WITA) ---');

  var kas = getKasSheet_();
  log_('OK: BIAYA & KAS LAUNDRY / sheet "' + kas.getName() + '" terbaca.');
  ['B2', 'C2', 'B3', 'C3', 'B6', 'C6', 'B9', 'C9'].forEach(function (a1) {
    log_('  KAS!' + a1 + ' = ' + valA1_(kas, a1));
  });

  // REKAP
  var cfg = CONFIG.rekap;
  var blockStart = computeBlockStart_(today);
  log_('REKAP blockStart bulan ini = ' + blockStart + ', baris nominal = ' + (blockStart + cfg.nominalRowOffset));
  [cfg.maumbiSheetName, cfg.perkamilSheetName].forEach(function (name) {
    var sh = getKasSS_().getSheetByName(name);
    if (!sh) { log_('  REKAP sheet "' + name + '" TIDAK DITEMUKAN.'); return; }
    var col = findTodayColumn_(sh, blockStart, today);
    if (!col) { log_('  ' + name + ': kolom tanggal hari ini TIDAK ditemukan (cek dateHeader* di Config).'); return; }
    var val = sh.getRange(blockStart + cfg.nominalRowOffset, col).getValue();
    log_('  ' + name + ': kolom hari ini = ' + colA1_(col) + ', nominal = ' + val);
  });

  // CASHFLOW
  var cf = getCashflowSheet_();
  if (cf) {
    log_('OK: CASHFLOW "' + cf.getParent().getName() + '" / sheet "' + cf.getName() + '" terbaca.');
    ['B2', 'B3', 'B4', 'B5', 'B6', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B20', 'B21'].forEach(function (a1) {
      log_('  CASHFLOW!' + a1 + ' = ' + valA1_(cf, a1));
    });
  } else {
    log_('CASHFLOW bulan ini belum tersedia (lihat pesan NOTIF di atas).');
  }
  log_('--- testConnections selesai ---');
}

function valA1_(sheet, a1) {
  var v = sheet.getRange(a1).getValue();
  return (v instanceof Date) ? fmtDate_(v) : v;
}

/**
 * Co Clean Laundry — Backend Live Dashboard "Input Biaya"
 * =======================================================
 * Skrip ini menjadi "jembatan" antara dashboard statis (GitHub Pages)
 * dan Google Spreadsheet. Tugasnya:
 *   - doGet  : mengirim opsi dropdown + data terbaru sheet BIAYA ke dashboard,
 *              dan (action=append) menambah baris baru. Mendukung JSONP via
 *              parameter "callback" agar bebas masalah CORS di browser.
 *   - doPost : sama seperti append, untuk pemanggil yang memakai POST JSON.
 *
 * PENTING: Buat skrip ini dari DALAM spreadsheet (Extensions > Apps Script)
 * agar SpreadsheetApp.getActiveSpreadsheet() menunjuk ke file yang benar.
 * Lihat README.md untuk langkah deploy & setting kata sandi.
 */

// ----- Nama sheet (ubah hanya jika Anda mengganti nama tab) -----
var SHEET_BIAYA  = 'BIAYA';
var SHEET_DAFTAR = 'DAFTAR BIAYA';
var SHEET_OUTLET = 'KODE OUTLET';

// ----- Jumlah & indeks kolom sheet BIAYA (1-based) -----
var COLS      = 14;
var C_NOMOR   = 1;  // A  (otomatis)
var C_SUBJEK  = 2;  // B  (formula)
var C_KET     = 3;  // C  KETERANGAN          <- input (dropdown)
var C_NOMINAL = 4;  // D  NOMINAL             <- input (angka)
var C_TGL     = 5;  // E  TANGGAL             <- input (tanggal)
var C_OUTLET  = 6;  // F  OUTLET              <- input (dropdown)
var C_SUMBER  = 7;  // G  SUMBER DANA         <- input (dropdown)
var C_KETPAKAI= 8;  // H  KETERANGAN PENGGUNAAN <- input (teks)
var C_POSAPP  = 9;  // I  POS BIAYA APLIKASI  (formula)
var C_ITEM    = 10; // J  ITEM BIAYA          (formula)
var C_STATUS  = 11; // K  STATUS LAPOR APLIKASI <- input (dropdown)
var C_KODE    = 12; // L  KODE TRANSAKSI      (formula)
var C_VERIF   = 13; // M  VERIFIKASI OWNER    <- input (dropdown)
var C_KOREKSI = 14; // N  KETERANGAN KOREKSI  (dikosongkan)

// =================================================================
// ENTRY POINTS
// =================================================================

function doGet(e) {
  var p = (e && e.parameter) || {};
  var result;
  if (!checkPassword_(p.password)) {
    result = { ok: false, error: 'UNAUTHORIZED' };
  } else if (p.action === 'append') {
    try { result = appendRow_(p); } catch (err) { result = { ok: false, error: String(err) }; }
  } else {
    try { result = buildData_(); } catch (err) { result = { ok: false, error: String(err) }; }
  }
  return reply_(result, p.callback);
}

function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (_) {}
  if (!checkPassword_(body.password)) return out_({ ok: false, error: 'UNAUTHORIZED' });
  try {
    return out_(appendRow_(body));
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

// =================================================================
// AUTH
// =================================================================

/**
 * Bandingkan kata sandi dengan Script Property "DASHBOARD_PASSWORD".
 * Set lewat: Project Settings > Script Properties (lihat README).
 */
function checkPassword_(pass) {
  var want = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
  if (!want) return false;            // belum dikonfigurasi -> tolak semua
  return String(pass || '') === String(want);
}

// =================================================================
// BACA DATA UNTUK DASHBOARD (doGet)
// =================================================================

function buildData_() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var biaya  = ss.getSheetByName(SHEET_BIAYA);
  var daftar = ss.getSheetByName(SHEET_DAFTAR);
  var outSh  = ss.getSheetByName(SHEET_OUTLET);
  if (!biaya)  throw 'Sheet "' + SHEET_BIAYA + '" tidak ditemukan';
  if (!daftar) throw 'Sheet "' + SHEET_DAFTAR + '" tidak ditemukan';
  if (!outSh)  throw 'Sheet "' + SHEET_OUTLET + '" tidak ditemukan';

  var headers = biaya.getRange(1, 1, 1, COLS).getValues()[0];

  // ---- DAFTAR BIAYA: kamus item & kode pos ----
  // Kolom: A POS BIAYA | B KODE | C KETERANGAN BIAYA | D POS BIAYA | E POS APP | F ITEM | G KODE
  var dRows = daftar.getRange(1, 1, daftar.getLastRow(), 7).getValues();

  var posCode = {}; // nama POS BIAYA -> kode 2 digit (dari kolom A:B)
  for (var i = 1; i < dRows.length; i++) {
    var nm = String(dRows[i][0]).trim();
    if (nm) posCode[nm] = String(dRows[i][1]).trim();
  }

  var ketMap = {};  // keterangan -> {subjek, posApp, item, kode}
  var ketList = [];
  for (i = 1; i < dRows.length; i++) {
    var k = String(dRows[i][2]).trim();   // C KETERANGAN BIAYA
    if (!k) continue;
    var subj = String(dRows[i][3]).trim(); // D POS BIAYA
    ketMap[k] = {
      subjek: subj,
      posApp: String(dRows[i][4]).trim(),  // E
      item:   String(dRows[i][5]).trim(),  // F
      kode:   posCode[subj] || ''
    };
    ketList.push(k);
  }
  ketList.sort(function (a, b) { return a.localeCompare(b); });

  // ---- KODE OUTLET: daftar outlet + kodenya ----
  var oRows = outSh.getRange(1, 1, outSh.getLastRow(), 2).getValues();
  var outletList = [], outletCode = {};
  for (i = 1; i < oRows.length; i++) {
    var on = String(oRows[i][0]).trim();
    if (on) { outletList.push(on); outletCode[on] = String(oRows[i][1]).trim(); }
  }

  // ---- Nilai unik yang sudah ada untuk dropdown G / K / M ----
  var lastData = lastDataRow_(biaya);
  var sumberDana = [], statusLapor = [], verifikasi = [];
  if (lastData >= 2) {
    var body = biaya.getRange(2, 1, lastData - 1, COLS).getValues();
    sumberDana  = distinct_(body, C_SUMBER  - 1);
    statusLapor = distinct_(body, C_STATUS  - 1);
    verifikasi  = distinct_(body, C_VERIF   - 1);
  }

  // ---- Baris terbaru untuk ditampilkan (read-only) ----
  var N = 30;
  var start = Math.max(2, lastData - N + 1);
  var cnt = Math.max(0, lastData - start + 1);
  var recent = cnt > 0 ? biaya.getRange(start, 1, cnt, COLS).getDisplayValues() : [];
  recent.reverse(); // terbaru di atas

  return {
    ok: true,
    headers: headers,
    keterangan: ketList,
    keteranganMap: ketMap,
    outlets: outletList,
    outletCode: outletCode,
    sumberDana: sumberDana,
    statusLapor: statusLapor,
    verifikasi: verifikasi,
    recent: recent,
    lastDataRow: lastData
  };
}

function distinct_(rows, colIdx) {
  var seen = {}, list = [];
  for (var i = 0; i < rows.length; i++) {
    var v = String(rows[i][colIdx]).trim();
    if (v && !seen[v]) { seen[v] = true; list.push(v); }
  }
  list.sort(function (a, b) { return a.localeCompare(b); });
  return list;
}

/** Baris data terakhir = baris terbawah yang kolom KETERANGAN (C)-nya terisi. */
function lastDataRow_(sh) {
  var max = sh.getMaxRows();
  var vals = sh.getRange(1, C_KET, max, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() !== '') return i + 1;
  }
  return 1;
}

// =================================================================
// TAMBAH BARIS (doPost / doGet action=append)
// =================================================================

function appendRow_(body) {
  // --- Ambil & rapikan input ---
  var ket      = trim_(body.keterangan);
  var outlet   = trim_(body.outlet);
  var sumber   = trim_(body.sumberDana);
  var status   = trim_(body.statusLapor);
  var verif    = trim_(body.verifikasi);
  var ketPakai = body.keteranganPenggunaan == null ? '' : String(body.keteranganPenggunaan);
  var nominal  = Number(body.nominal);
  var tgl      = trim_(body.tanggal);

  // --- Validasi ---
  if (!ket)            return { ok: false, error: 'Keterangan wajib dipilih.' };
  if (!(nominal > 0))  return { ok: false, error: 'Nominal harus berupa angka lebih dari 0.' };
  if (!tgl)            return { ok: false, error: 'Tanggal wajib diisi.' };
  if (!outlet)         return { ok: false, error: 'Outlet wajib dipilih.' };

  var parts = tgl.split('-'); // format dari <input type=date> = YYYY-MM-DD
  if (parts.length !== 3) return { ok: false, error: 'Format tanggal tidak valid.' };
  var dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_BIAYA);

  // Kunci agar dua orang tidak menulis ke baris yang sama bersamaan.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastData = lastDataRow_(sh);
    var r = lastData + 1;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);

    // Salin formula + format dari baris sebelumnya -> baris baru.
    // Referensi relatif (mis. $C2, E2) otomatis menyesuaikan ke baris baru,
    // sehingga kolom B/I/J/L tetap memakai formula asli sheet (locale aman).
    sh.getRange(lastData, 1, 1, COLS)
      .copyTo(sh.getRange(r, 1, 1, COLS), { contentsOnly: false });

    // Tulis kolom input (menimpa nilai hasil copy dari baris sebelumnya).
    sh.getRange(r, C_KET).setValue(ket);
    sh.getRange(r, C_NOMINAL).setValue(nominal);
    sh.getRange(r, C_TGL).setValue(dateObj);
    sh.getRange(r, C_OUTLET).setValue(outlet);
    sh.getRange(r, C_SUMBER).setValue(sumber);
    sh.getRange(r, C_KETPAKAI).setValue(ketPakai);
    sh.getRange(r, C_STATUS).setValue(status);
    sh.getRange(r, C_VERIF).setValue(verif);

    // NOMOR otomatis = nomor terbesar sebelumnya + 1.
    sh.getRange(r, C_NOMOR).setValue(nextNomor_(sh, lastData));

    // Kosongkan KETERANGAN KOREKSI yang ikut tersalin.
    sh.getRange(r, C_KOREKSI).clearContent();

    SpreadsheetApp.flush();

    var vals = sh.getRange(r, 1, 1, COLS).getDisplayValues()[0];
    return { ok: true, row: r, values: vals };
  } finally {
    lock.releaseLock();
  }
}

function nextNomor_(sh, lastData) {
  if (lastData < 2) return 1;
  var vals = sh.getRange(2, C_NOMOR, lastData - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < vals.length; i++) {
    var n = Number(vals[i][0]);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

// =================================================================
// UTIL
// =================================================================

function trim_(v) { return v == null ? '' : String(v).trim(); }

function out_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Bungkus JSONP jika ada parameter "callback" (menghindari masalah CORS di
// browser seperti Safari/iOS). Tanpa callback, kembalikan JSON biasa.
function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback) + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

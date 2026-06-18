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

// ----- Sheet DEPOSIT (deposito pelanggan): A nama | B tanggal | C outlet | D jumlah -----
// Baris 1 = header, baris 2 = TOTAL (=SUM(D3:D1001)), data mulai baris 3.
var SHEET_DEPOSIT = 'DEPOSIT';
var D_NAMA = 1, D_TGL = 2, D_OUTLET = 3, D_JUMLAH = 4;

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
  } else if (p.action === 'update') {
    try { result = updateRow_(p); } catch (err) { result = { ok: false, error: String(err) }; }
  } else if (p.action === 'delete') {
    try { result = deleteRow_(p); } catch (err) { result = { ok: false, error: String(err) }; }
  } else if (p.action === 'deposit') {
    try { result = appendDeposit_(p); } catch (err) { result = { ok: false, error: String(err) }; }
  } else if (p.action === 'daftarbiaya') {
    try { result = appendDaftar_(p); } catch (err) { result = { ok: false, error: String(err) }; }
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

  // ---- Rekomendasi untuk "Input Biaya Baru" (DAFTAR BIAYA kolom C..G) ----
  var posSet = {}, appSet = {}, itemSet = {}, posToApp = {}, appToItem = {}, lastDaftar = 1;
  for (i = 1; i < dRows.length; i++) {
    var aAcc = String(dRows[i][0]).trim();
    if (aAcc) posSet[aAcc] = true;
    if (String(dRows[i][2]).trim()) lastDaftar = i + 1; // baris terisi terakhir (kolom C)
    var dPos = String(dRows[i][3]).trim();
    var eApp = String(dRows[i][4]).trim();
    var fItem = String(dRows[i][5]).trim();
    if (dPos) posSet[dPos] = true;
    if (eApp) appSet[eApp] = true;
    if (fItem) itemSet[fItem] = true;
    if (dPos && eApp) { (posToApp[dPos] = posToApp[dPos] || {})[eApp] = true; }
    if (eApp && fItem) { (appToItem[eApp] = appToItem[eApp] || {})[fItem] = true; }
  }
  var daftar = {
    posBiaya: sortedKeys_(posSet),
    posBiayaAplikasi: sortedKeys_(appSet),
    itemBiaya: sortedKeys_(itemSet),
    posToApp: setMapToArr_(posToApp),
    appToItem: setMapToArr_(appToItem),
    posCode: posCode,
    lastDataRow: lastDaftar
  };

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

  // ---- Baris terbaru: nilai tampil (tabel) + nilai mentah (untuk edit) ----
  var N = 30;
  var recent = [];
  if (lastData >= 2) {
    var start = Math.max(2, lastData - N + 1);
    var cnt = lastData - start + 1;
    var disp = biaya.getRange(start, 1, cnt, COLS).getDisplayValues();
    var raw  = biaya.getRange(start, 1, cnt, COLS).getValues();
    for (var j = 0; j < cnt; j++) {
      recent.push({
        row: start + j,
        cells: disp[j],
        edit: {
          keterangan: raw[j][C_KET - 1],
          nominal: raw[j][C_NOMINAL - 1],
          tanggal: toDateStr_(raw[j][C_TGL - 1]),
          outlet: raw[j][C_OUTLET - 1],
          sumberDana: raw[j][C_SUMBER - 1],
          keteranganPenggunaan: raw[j][C_KETPAKAI - 1],
          statusLapor: raw[j][C_STATUS - 1],
          verifikasi: raw[j][C_VERIF - 1]
        }
      });
    }
    recent.reverse(); // terbaru di atas
  }

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
    lastDataRow: lastData,
    daftar: daftar,
    deposit: buildDeposit_()
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

function sortedKeys_(obj) {
  var a = Object.keys(obj);
  a.sort(function (x, y) { return x.localeCompare(y); });
  return a;
}

function setMapToArr_(m) {
  var o = {};
  for (var k in m) o[k] = sortedKeys_(m[k]);
  return o;
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
// TAMBAH / EDIT / HAPUS BARIS
// =================================================================

// Validasi & normalisasi input bersama (dipakai append & update).
function validateInput_(body) {
  var ket      = trim_(body.keterangan);
  var outlet   = trim_(body.outlet);
  var sumber   = trim_(body.sumberDana);
  var status   = trim_(body.statusLapor);
  var verif    = trim_(body.verifikasi);
  var ketPakai = body.keteranganPenggunaan == null ? '' : String(body.keteranganPenggunaan);
  var nominal  = Number(body.nominal);
  var tgl      = trim_(body.tanggal);

  if (!ket)            return { error: 'Keterangan wajib dipilih.' };
  if (!(nominal > 0))  return { error: 'Nominal harus berupa angka lebih dari 0.' };
  if (!tgl)            return { error: 'Tanggal wajib diisi.' };
  if (!outlet)         return { error: 'Outlet wajib dipilih.' };

  var parts = tgl.split('-'); // YYYY-MM-DD dari <input type=date>
  if (parts.length !== 3) return { error: 'Format tanggal tidak valid.' };
  var dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);

  return {
    ket: ket, outlet: outlet, sumber: sumber, status: status, verif: verif,
    ketPakai: ketPakai, nominal: nominal, dateObj: dateObj
  };
}

// Tulis kolom input ke satu baris (tanpa menyentuh kolom formula & NOMOR).
function writeInputs_(sh, r, v) {
  sh.getRange(r, C_KET).setValue(v.ket);
  sh.getRange(r, C_NOMINAL).setValue(v.nominal);
  sh.getRange(r, C_TGL).setValue(v.dateObj);
  sh.getRange(r, C_OUTLET).setValue(v.outlet);
  sh.getRange(r, C_SUMBER).setValue(v.sumber);
  sh.getRange(r, C_KETPAKAI).setValue(v.ketPakai);
  sh.getRange(r, C_STATUS).setValue(v.status);
  sh.getRange(r, C_VERIF).setValue(v.verif);
}

// Cek pengaman: pastikan KETERANGAN baris masih sama seperti saat dimuat.
function verifyRow_(sh, row, expectKeterangan) {
  if (expectKeterangan == null || expectKeterangan === '') return true;
  return String(sh.getRange(row, C_KET).getValue()) === String(expectKeterangan);
}

function appendRow_(body) {
  var v = validateInput_(body);
  if (v.error) return { ok: false, error: v.error };

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BIAYA);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastData = lastDataRow_(sh);
    var r = lastData + 1;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);

    // Salin formula + format dari baris sebelumnya -> baris baru (referensi
    // relatif menyesuaikan), agar kolom B/I/J/L tetap memakai formula sheet.
    sh.getRange(lastData, 1, 1, COLS)
      .copyTo(sh.getRange(r, 1, 1, COLS), { contentsOnly: false });

    writeInputs_(sh, r, v);
    sh.getRange(r, C_NOMOR).setValue(nextNomor_(sh, lastData)); // nomor otomatis
    sh.getRange(r, C_KOREKSI).clearContent();                    // kosongkan koreksi

    SpreadsheetApp.flush();
    var vals = sh.getRange(r, 1, 1, COLS).getDisplayValues()[0];
    return { ok: true, row: r, values: vals };
  } finally {
    lock.releaseLock();
  }
}

// Edit baris yang sudah ada (hanya kolom input; kolom formula terhitung ulang).
function updateRow_(body) {
  var row = parseInt(body.row, 10);
  var v = validateInput_(body);
  if (v.error) return { ok: false, error: v.error };

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BIAYA);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastData = lastDataRow_(sh);
    if (!(row >= 2 && row <= lastData)) {
      return { ok: false, error: 'Baris tidak valid. Klik Muat ulang lalu coba lagi.' };
    }
    if (!verifyRow_(sh, row, body.expectKeterangan)) {
      return { ok: false, error: 'Baris sudah berubah sejak dimuat. Klik Muat ulang lalu coba lagi.' };
    }
    writeInputs_(sh, row, v);
    SpreadsheetApp.flush();
    var vals = sh.getRange(row, 1, 1, COLS).getDisplayValues()[0];
    return { ok: true, row: row, values: vals };
  } finally {
    lock.releaseLock();
  }
}

// Hapus seluruh baris.
function deleteRow_(body) {
  var row = parseInt(body.row, 10);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BIAYA);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastData = lastDataRow_(sh);
    if (!(row >= 2 && row <= lastData)) {
      return { ok: false, error: 'Baris tidak valid. Klik Muat ulang lalu coba lagi.' };
    }
    if (!verifyRow_(sh, row, body.expectKeterangan)) {
      return { ok: false, error: 'Baris sudah berubah sejak dimuat. Klik Muat ulang lalu coba lagi.' };
    }
    sh.deleteRow(row);
    return { ok: true, deleted: row };
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
// DEPOSIT PELANGGAN
// =================================================================

// Baris data deposit terakhir (>= 3). Baris 2 (TOTAL) dilewati.
// Mengembalikan 2 bila belum ada data, sehingga baris berikutnya = 3.
function lastDepositRow_(sh) {
  var max = sh.getMaxRows();
  var vals = sh.getRange(1, D_NAMA, max, 1).getValues();
  for (var i = vals.length - 1; i >= 2; i--) { // i (0-based) >= 2 => baris >= 3
    if (String(vals[i][0]).trim() !== '') return i + 1;
  }
  return 2;
}

// Data deposit untuk dashboard: daftar nama unik + semua transaksi + total.
function buildDeposit_() {
  var dep = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DEPOSIT);
  if (!dep) return null;

  var lastDep = lastDepositRow_(dep);
  var rows = [], names = [], seen = {}, total = 0;
  if (lastDep >= 3) {
    var cnt = lastDep - 2;
    var disp = dep.getRange(3, 1, cnt, 4).getDisplayValues();
    var raw  = dep.getRange(3, 1, cnt, 4).getValues();
    for (var i = 0; i < cnt; i++) {
      var nm = String(raw[i][0]).trim();
      if (!nm) continue;
      var jumlah = Number(raw[i][3]) || 0;
      rows.push({ row: 3 + i, name: nm, tanggal: disp[i][1], outlet: disp[i][2], jumlah: jumlah });
      total += jumlah;
      if (!seen[nm]) { seen[nm] = true; names.push(nm); }
    }
  }
  names.sort(function (a, b) { return a.localeCompare(b); });
  return { names: names, rows: rows, total: total, lastDataRow: lastDep };
}

// Tambah satu transaksi deposit di baris kosong setelah baris data terakhir.
// jenis: 'PEMAKAIAN' -> nominal negatif; 'PENAMBAHAN' -> nominal positif.
function appendDeposit_(body) {
  var name    = trim_(body.name);
  var outlet  = trim_(body.outlet);
  var jenis   = trim_(body.jenis);
  var nominal = Number(body.nominal);
  var tgl     = trim_(body.tanggal);

  if (!name)          return { ok: false, error: 'Nama pelanggan wajib diisi.' };
  if (jenis !== 'PEMAKAIAN' && jenis !== 'PENAMBAHAN')
                      return { ok: false, error: 'Pilih PEMAKAIAN atau PENAMBAHAN deposit dulu.' };
  if (!(nominal > 0)) return { ok: false, error: 'Nominal harus berupa angka lebih dari 0.' };
  if (!tgl)           return { ok: false, error: 'Tanggal wajib diisi.' };
  if (!outlet)        return { ok: false, error: 'Outlet wajib dipilih.' };

  var parts = tgl.split('-');
  if (parts.length !== 3) return { ok: false, error: 'Format tanggal tidak valid.' };
  var dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);

  var jumlah = jenis === 'PEMAKAIAN' ? -nominal : nominal;

  var dep = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DEPOSIT);
  if (!dep) return { ok: false, error: 'Sheet "' + SHEET_DEPOSIT + '" tidak ditemukan.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastDep = lastDepositRow_(dep);
    var r = Math.max(3, lastDep + 1);
    if (r > dep.getMaxRows()) dep.insertRowsAfter(dep.getMaxRows(), 1);

    // Warisi format (tanggal & angka) dari baris data sebelumnya bila ada.
    if (lastDep >= 3) {
      dep.getRange(lastDep, 1, 1, 4).copyTo(dep.getRange(r, 1, 1, 4), { formatOnly: true });
    }

    dep.getRange(r, D_NAMA).setValue(name);
    dep.getRange(r, D_TGL).setValue(dateObj);
    dep.getRange(r, D_OUTLET).setValue(outlet);
    dep.getRange(r, D_JUMLAH).setValue(jumlah);

    SpreadsheetApp.flush();

    // Hitung saldo pelanggan setelah transaksi.
    var saldo = 0;
    var col = dep.getRange(3, 1, r - 2, 4).getValues();
    for (var i = 0; i < col.length; i++) {
      if (String(col[i][0]).trim() === name) saldo += Number(col[i][3]) || 0;
    }
    return { ok: true, row: r, name: name, jumlah: jumlah, saldo: saldo };
  } finally {
    lock.releaseLock();
  }
}

// =================================================================
// INPUT BIAYA BARU (DAFTAR BIAYA kolom C..G)
// =================================================================

// Tambah satu jenis biaya baru ke DAFTAR BIAYA pada baris kosong berikutnya.
// Kolom: C KETERANGAN | D POS BIAYA | E POS BIAYA APLIKASI | F ITEM BIAYA.
// G KODE TRANSAKSI = formula (disalin dari baris sebelumnya, otomatis).
function appendDaftar_(body) {
  var ket  = trim_(body.keterangan);
  var pos  = trim_(body.posBiaya);
  var app  = trim_(body.posBiayaAplikasi);
  var item = trim_(body.itemBiaya);
  if (!ket) return { ok: false, error: 'Keterangan Biaya wajib diisi.' };
  if (!pos) return { ok: false, error: 'POS BIAYA wajib dipilih.' };

  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DAFTAR);
  if (!sh) return { ok: false, error: 'Sheet "' + SHEET_DAFTAR + '" tidak ditemukan.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Baris data terakhir berdasarkan kolom C (KETERANGAN BIAYA).
    var max = sh.getMaxRows();
    var colC = sh.getRange(1, 3, max, 1).getValues();
    var lastRow = 1;
    for (var i = colC.length - 1; i >= 1; i--) {
      if (String(colC[i][0]).trim() !== '') { lastRow = i + 1; break; }
    }
    var r = lastRow + 1;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);

    // Salin format + formula KODE TRANSAKSI (kolom G) dari baris sebelumnya
    // (referensi $D{baris} otomatis menyesuaikan ke baris baru).
    if (lastRow >= 2) {
      sh.getRange(lastRow, 3, 1, 5).copyTo(sh.getRange(r, 3, 1, 5), { contentsOnly: false });
    }
    sh.getRange(r, 3).setValue(ket);   // C
    sh.getRange(r, 4).setValue(pos);   // D
    sh.getRange(r, 5).setValue(app);   // E
    sh.getRange(r, 6).setValue(item);  // F

    SpreadsheetApp.flush();
    var kode = sh.getRange(r, 7).getDisplayValue(); // G KODE TRANSAKSI
    return { ok: true, row: r, kode: kode, keterangan: ket };
  } finally {
    lock.releaseLock();
  }
}

// =================================================================
// UTIL
// =================================================================

function trim_(v) { return v == null ? '' : String(v).trim(); }

// Ubah nilai sel tanggal (Date atau serial number) menjadi "yyyy-MM-dd".
function toDateStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (typeof v === 'number' && v > 0) {
    var ms = Math.round((v - 25569) * 86400000); // serial 25569 = 1970-01-01
    return Utilities.formatDate(new Date(ms), 'UTC', 'yyyy-MM-dd');
  }
  return '';
}

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

/* =====================================================================
 * Co Clean Laundry — Dashboard Input Biaya (frontend)
 * Berkomunikasi dengan Google Apps Script Web App (lihat apps-script/Code.gs)
 * ===================================================================== */

'use strict';

// ---------- State ----------
var STATE = {
  keteranganMap: {},   // keterangan -> {subjek, posApp, item, kode}
  outletCode: {},      // outlet -> kode
  headers: []
};

// Baris yang sedang diedit: null = mode tambah; {row, keterangan} = mode edit.
var EDIT_ROW = null;

// Data deposit pelanggan: { names, rows:[{name,tanggal,outlet,jumlah}], total }.
var DEPOSIT = { names: [], rows: [], total: 0 };

// Data DAFTAR BIAYA untuk rekomendasi "Input Biaya Baru".
var DAFTAR = { posBiaya: [], posBiayaAplikasi: [], itemBiaya: [], posToApp: {}, appToItem: {}, posCode: {}, lastDataRow: 0 };

// Aliran Kas (REKAP per outlet): data bulan yang sedang ditampilkan.
var ALIRAN = { outlet: 'MAUMBI', year: 0, month: 0, monthName: '', days: [], metrics: [] };

// Nama bulan (Title Case) untuk dropdown & judul Aliran Kas.
var BULAN_LABEL = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
                   'Agustus', 'September', 'Oktober', 'November', 'Desember'];

// ---------- Helpers ----------
var $ = function (id) { return document.getElementById(id); };

function apiConfigured() {
  return typeof CONFIG !== 'undefined' &&
         CONFIG.API_URL &&
         /^https?:\/\//.test(CONFIG.API_URL) &&
         CONFIG.API_URL.indexOf('GANTI') === -1;
}

function getPw()  { return sessionStorage.getItem('ccl_pw') || ''; }
function setPw(v) { sessionStorage.setItem('ccl_pw', v); }
function clearPw(){ sessionStorage.removeItem('ccl_pw'); }

function show(el, on) { el.hidden = !on; }

function setMsg(el, text, kind) {
  el.textContent = text || '';
  el.className = 'msg' + (kind ? ' ' + kind : '');
}

// Format angka -> "1.234.567"
function formatThousand(digits) {
  digits = String(digits).replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function onlyDigits(s) { return String(s).replace(/\D/g, ''); }

// Serial tanggal Google Sheets (hari sejak 1899-12-30)
function sheetSerial(yyyy_mm_dd) {
  var p = yyyy_mm_dd.split('-');
  if (p.length !== 3) return null;
  var ms = Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30);
  return Math.floor(ms / 86400000);
}

// ---------- Network (JSONP) ----------
// Apps Script + browser sering kena masalah CORS (di Safari/iOS muncul
// "Load failed"). JSONP memuat respons lewat <script> sehingga bebas CORS
// dan jalan di semua browser. Backend membungkus balasan sebagai
// callback(JSON) bila ada parameter "callback".
// Catatan: parameter (termasuk password) ikut terkirim di URL.
function jsonp(params) {
  return new Promise(function (resolve, reject) {
    var cb = '__ccl_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    var s = document.createElement('script');
    var timer = setTimeout(function () {
      cleanup();
      reject(new Error('Timeout menghubungi server. Cek API_URL di config.js & koneksi.'));
    }, 25000);
    function cleanup() {
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
    }
    window[cb] = function (data) { cleanup(); resolve(data); };
    s.onerror = function () {
      cleanup();
      reject(new Error('Gagal memuat dari server (cek URL Web App / akses "Anyone").'));
    };
    var q = Object.keys(params).map(function (k) {
      var val = params[k] == null ? '' : params[k];
      return encodeURIComponent(k) + '=' + encodeURIComponent(val);
    }).join('&');
    s.src = CONFIG.API_URL + '?' + q + '&callback=' + cb + '&t=' + Date.now();
    document.body.appendChild(s);
  });
}

function apiGet() {
  return jsonp({ password: getPw() });
}

function apiAppend(payload) {
  payload.action = 'append';
  return jsonp(payload);
}

function apiUpdate(payload) {
  payload.action = 'update';
  return jsonp(payload);
}

function apiDelete(row, expectKeterangan) {
  return jsonp({ action: 'delete', row: row, expectKeterangan: expectKeterangan, password: getPw() });
}

// ---------- Populate dropdowns ----------
function fillSelect(sel, items, keepFirst) {
  // hapus opsi lama kecuali placeholder pertama (jika keepFirst)
  while (sel.options.length > (keepFirst ? 1 : 0)) {
    sel.remove(sel.options.length - 1);
  }
  items.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}

// Set nilai <select>; tambahkan opsi sementara bila nilai belum ada di daftar.
function setSelect(sel, val) {
  val = val == null ? '' : String(val);
  if (val) {
    var found = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === val) { found = true; break; }
    }
    if (!found) {
      var o = document.createElement('option');
      o.value = val; o.textContent = val;
      sel.appendChild(o);
    }
  }
  sel.value = val;
}

function applyData(data) {
  STATE.keteranganMap = data.keteranganMap || {};
  STATE.outletCode = data.outletCode || {};
  STATE.headers = data.headers || [];

  fillSelect($('keterangan'), data.keterangan || [], true);
  fillSelect($('outlet'), data.outlets || [], true);
  fillSelect($('sumberDana'), data.sumberDana || [], true);
  fillSelect($('statusLapor'), data.statusLapor || [], true);
  fillSelect($('verifikasi'), data.verifikasi || [], true);

  renderRecent(data);
  populateDeposit(data);
  populateDaftar(data);
}

// Salin teks ke clipboard (dengan fallback untuk browser lama).
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function (resolve, reject) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    } catch (e) { reject(e); }
  });
}

// Notifikasi singkat di bawah layar.
function toast(msg) {
  var t = $('cclToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cclToast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { t.classList.remove('show'); }, 1600);
}

function renderRecent(data) {
  var head = $('recentHead'), body = $('recentBody');
  head.innerHTML = ''; body.innerHTML = '';

  (data.headers || []).forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  });

  var thAksi = document.createElement('th');
  thAksi.textContent = 'Aksi';
  head.appendChild(thAksi);

  // Indeks kolom KETERANGAN (untuk fitur klik-salin)
  var ketIdx = (data.headers || []).indexOf('KETERANGAN');
  if (ketIdx < 0) ketIdx = 2;

  var oldFormat = false;
  (data.recent || []).forEach(function (raw) {
    // Dukung 2 format: objek {row, cells, edit} (baru) ATAU array sel (lama).
    var isObj = raw && typeof raw === 'object' && !Array.isArray(raw);
    if (!isObj) oldFormat = true;
    var item = isObj ? raw : { row: null, cells: raw, edit: null };

    var tr = document.createElement('tr');
    (item.cells || []).forEach(function (cell, ci) {
      var td = document.createElement('td');
      td.textContent = cell;
      if (ci === ketIdx && String(cell).trim() !== '') {
        td.className = 'copyable';
        td.title = 'Klik untuk menyalin keterangan';
        td.addEventListener('click', function () {
          copyText(td.textContent)
            .then(function () { toast('✓ Tersalin: ' + td.textContent); })
            .catch(function () { toast('Gagal menyalin.'); });
        });
      }
      tr.appendChild(td);
    });

    var act = document.createElement('td');
    act.className = 'actions';
    if (item.row != null && item.edit) {
      var bEdit = document.createElement('button');
      bEdit.type = 'button'; bEdit.className = 'mini'; bEdit.textContent = 'Edit';
      bEdit.addEventListener('click', function () { startEdit(item); });
      var bDel = document.createElement('button');
      bDel.type = 'button'; bDel.className = 'mini danger'; bDel.textContent = 'Hapus';
      bDel.addEventListener('click', function () { doDelete(item); });
      act.appendChild(bEdit); act.appendChild(bDel);
    } else {
      act.textContent = '—';
    }
    tr.appendChild(act);
    body.appendChild(tr);
  });

  var info = 'Menampilkan ' + (data.recent ? data.recent.length : 0) +
    ' entri terbaru · baris terakhir terisi: ' + (data.lastDataRow || '-');
  if (oldFormat) {
    info += ' · ⚠️ Backend masih versi lama: perbarui Code.gs lalu Deploy versi baru agar Edit/Hapus aktif.';
  }
  $('recentInfo').textContent = info;
}

// ---------- Pratinjau kolom otomatis ----------
function updatePreview() {
  var ket = $('keterangan').value;
  var outlet = $('outlet').value;
  var tgl = $('tanggal').value;
  var m = STATE.keteranganMap[ket] || {};

  $('pvSubjek').textContent = m.subjek || '—';
  $('pvPosApp').textContent = m.posApp || '—';
  $('pvItem').textContent = m.item || '—';

  // KODE TRANSAKSI = RIGHT(serial;4) + kodeOutlet + kodePos
  var kode = '—';
  var serial = tgl ? sheetSerial(tgl) : null;
  var oc = STATE.outletCode[outlet];
  if (serial != null && oc && m.kode) {
    kode = String(serial).slice(-4) + oc + m.kode;
  }
  $('pvKode').textContent = kode;
}

// ---------- Edit / Hapus ----------
function startEdit(item) {
  var e = item.edit || {};
  EDIT_ROW = { row: item.row, keterangan: e.keterangan };
  showView('form');

  setSelect($('keterangan'), e.keterangan);
  $('nominal').value = formatThousand(String(e.nominal == null ? '' : e.nominal));
  $('tanggal').value = e.tanggal || '';
  setSelect($('outlet'), e.outlet);
  setSelect($('sumberDana'), e.sumberDana);
  $('keteranganPenggunaan').value = e.keteranganPenggunaan || '';
  setSelect($('statusLapor'), e.statusLapor);
  setSelect($('verifikasi'), e.verifikasi);
  updatePreview();

  $('submitBtn').textContent = '✏️ Perbarui baris ' + item.row;
  show($('cancelEdit'), true);
  var banner = $('editBanner');
  banner.textContent = 'Mode EDIT — baris ' + item.row + ' (' + (e.keterangan || '') + '). Ubah lalu klik Perbarui.';
  show(banner, true);
  setMsg($('formMsg'), '', '');
  if (window.scrollTo) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  EDIT_ROW = null;
  $('submitBtn').textContent = '💾 Simpan ke Sheet';
  show($('cancelEdit'), false);
  show($('editBanner'), false);
  $('keterangan').selectedIndex = 0;
  $('nominal').value = '';
  $('keteranganPenggunaan').value = '';
  updatePreview();
}

function doDelete(item) {
  var e = item.edit || {};
  var ket = e.keterangan || (item.cells ? item.cells[2] : '');
  var nom = item.cells ? item.cells[3] : '';
  if (!window.confirm('Hapus baris ' + item.row + '?\n' + ket + ' — ' + nom)) return;

  setMsg($('formMsg'), 'Menghapus baris ' + item.row + '...', '');
  apiDelete(item.row, e.keterangan).then(function (res) {
    if (!res.ok) {
      if (res.error === 'UNAUTHORIZED') {
        clearPw();
        setMsg($('formMsg'), 'Sesi berakhir. Silakan masuk lagi.', 'err');
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      throw new Error(res.error || 'Gagal menghapus');
    }
    setMsg($('formMsg'), '✓ Baris ' + res.deleted + ' dihapus.', 'ok');
    if (EDIT_ROW && EDIT_ROW.row === item.row) cancelEdit();
    loadData();
  }).catch(function (err) {
    setMsg($('formMsg'), 'Gagal menghapus: ' + err.message, 'err');
  });
}

// ---------- Deposit ----------
// Format angka bertanda jadi "Rp 1.234.567" / "-Rp 1.234.567".
function rupiah(n) {
  n = Number(n) || 0;
  var sign = n < 0 ? '-' : '';
  return sign + 'Rp ' + formatThousand(String(Math.abs(Math.round(n))));
}

function depBalance(name) {
  var s = 0;
  DEPOSIT.rows.forEach(function (r) { if (r.name === name) s += Number(r.jumlah) || 0; });
  return s;
}

function populateDeposit(data) {
  var dep = (data && data.deposit) || { names: [], rows: [], total: 0 };
  DEPOSIT = { names: dep.names || [], rows: dep.rows || [], total: dep.total || 0 };

  // Dropdown nama (cek saldo) + datalist (input, boleh ketik nama baru)
  fillSelect($('depCekNama'), DEPOSIT.names, true);
  var dl = $('depNamaList');
  dl.innerHTML = '';
  DEPOSIT.names.forEach(function (n) {
    var o = document.createElement('option'); o.value = n; dl.appendChild(o);
  });

  // Outlet sama dengan form biaya
  fillSelect($('depOutlet'), (data && data.outlets) || [], true);

  onDepCekChange();
  updateDepPreview();
}

// Tampilkan saldo + riwayat untuk pelanggan yang dipilih di Cek Saldo.
function onDepCekChange() {
  var name = $('depCekNama').value;
  if (!name) { show($('depSaldoBox'), false); show($('depHistWrap'), false); return; }

  $('depSaldo').textContent = rupiah(depBalance(name));
  show($('depSaldoBox'), true);

  var histBody = $('depHistBody');
  histBody.innerHTML = '';
  var hist = DEPOSIT.rows.filter(function (r) { return r.name === name; });
  hist.forEach(function (r) {
    var tr = document.createElement('tr');
    [r.tanggal, r.outlet, rupiah(r.jumlah)].forEach(function (v) {
      var td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    histBody.appendChild(tr);
  });
  show($('depHistWrap'), hist.length > 0);
}

// Pratinjau transaksi deposit sebelum simpan.
function updateDepPreview() {
  var nama = $('depNama').value.trim();
  var jenis = $('depJenis').value;
  var nominal = Number(onlyDigits($('depNominal').value));

  $('dpvNama').textContent = nama || '—';
  $('dpvTanggal').textContent = $('depTanggal').value || '—';
  $('dpvOutlet').textContent = $('depOutlet').value || '—';

  var jumlah = (jenis && nominal > 0) ? (jenis === 'PEMAKAIAN' ? -nominal : nominal) : null;
  $('dpvJumlah').textContent = (jumlah == null) ? '—' : rupiah(jumlah);

  var saldoNow = nama ? depBalance(nama) : null;
  $('dpvSaldoNow').textContent = (saldoNow == null) ? '—' : rupiah(saldoNow);
  $('dpvSaldoAfter').textContent = (saldoNow == null || jumlah == null) ? '—' : rupiah(saldoNow + jumlah);
}

function handleDepSubmit(e) {
  e.preventDefault();
  var btn = $('depSubmitBtn');
  setMsg($('depMsg'), '', '');

  var payload = {
    action: 'deposit',
    password: getPw(),
    name: $('depNama').value.trim(),
    jenis: $('depJenis').value,
    tanggal: $('depTanggal').value,
    outlet: $('depOutlet').value,
    nominal: onlyDigits($('depNominal').value)
  };

  if (!payload.jenis) return setMsg($('depMsg'), 'Pilih PEMAKAIAN atau PENAMBAHAN deposit dulu.', 'err');
  if (!payload.name) return setMsg($('depMsg'), 'Nama pelanggan wajib diisi.', 'err');
  if (!(Number(payload.nominal) > 0)) return setMsg($('depMsg'), 'Nominal harus angka lebih dari 0.', 'err');
  if (!payload.tanggal) return setMsg($('depMsg'), 'Tanggal wajib diisi.', 'err');
  if (!payload.outlet) return setMsg($('depMsg'), 'Outlet wajib dipilih.', 'err');

  btn.disabled = true; btn.textContent = 'Menyimpan...';

  jsonp(payload).then(function (res) {
    if (!res.ok) {
      if (res.error === 'UNAUTHORIZED') {
        clearPw();
        setMsg($('depMsg'), 'Sesi berakhir. Silakan masuk lagi.', 'err');
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      throw new Error(res.error || 'Gagal menyimpan');
    }
    setMsg($('depMsg'), '✓ Tersimpan di baris ' + res.row + '. Saldo ' + res.name + ': ' + rupiah(res.saldo), 'ok');
    $('depNominal').value = '';
    loadData(); // segarkan saldo & daftar nama
  }).catch(function (err) {
    setMsg($('depMsg'), 'Gagal: ' + err.message, 'err');
  }).then(function () {
    btn.disabled = false; btn.textContent = '💾 Simpan Deposit';
  });
}

// ---------- Input Biaya Baru (DAFTAR BIAYA) ----------
function mergeUnique(primary, all) {
  var seen = {}, out = [];
  (primary || []).concat(all || []).forEach(function (v) {
    v = String(v);
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out;
}

function fillDatalist(el, items) {
  el.innerHTML = '';
  (items || []).forEach(function (v) {
    var o = document.createElement('option'); o.value = v; el.appendChild(o);
  });
}

// Saran POS BIAYA dari KETERANGAN: cocokkan dengan keterangan yang sudah ada.
function suggestPos(ket) {
  ket = (ket || '').trim().toLowerCase();
  if (!ket) return [];
  var words = ket.split(/\s+/).filter(function (w) { return w.length >= 3; });
  var score = {};
  Object.keys(STATE.keteranganMap).forEach(function (k) {
    var pos = (STATE.keteranganMap[k] || {}).subjek;
    if (!pos) return;
    var kl = k.toLowerCase();
    var sc = 0;
    if (kl === ket) sc += 100;
    if (kl.indexOf(ket) !== -1 || ket.indexOf(kl) !== -1) sc += 20;
    words.forEach(function (w) { if (kl.indexOf(w) !== -1) sc += 5; });
    if (sc > 0) score[pos] = Math.max(score[pos] || 0, sc);
  });
  return Object.keys(score).sort(function (a, b) { return score[b] - score[a]; }).slice(0, 4);
}

// Chip rekomendasi yang bisa diklik untuk mengisi field.
function renderRecos(containerId, items, inputId) {
  var c = $(containerId);
  c.innerHTML = '';
  if (!items || !items.length) return;
  var lbl = document.createElement('span');
  lbl.className = 'reco-label'; lbl.textContent = 'Saran:';
  c.appendChild(lbl);
  items.slice(0, 5).forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'reco'; b.textContent = v;
    b.addEventListener('click', function () {
      var el = $(inputId);
      el.value = v;
      el.dispatchEvent(new Event('change'));
    });
    c.appendChild(b);
  });
}

function populateDaftar(data) {
  var d = (data && data.daftar) || {};
  DAFTAR = {
    posBiaya: d.posBiaya || [],
    posBiayaAplikasi: d.posBiayaAplikasi || [],
    itemBiaya: d.itemBiaya || [],
    posToApp: d.posToApp || {},
    appToItem: d.appToItem || {},
    posCode: d.posCode || {},
    lastDataRow: d.lastDataRow || 0
  };
  fillDatalist($('dbPosList'), DAFTAR.posBiaya);
  fillDatalist($('dbAppList'), DAFTAR.posBiayaAplikasi);
  fillDatalist($('dbItemList'), DAFTAR.itemBiaya);
  onBaruKet();
  onBaruPos();
  onBaruApp();
}

// KETERANGAN -> saran POS BIAYA
function onBaruKet() {
  var recos = suggestPos($('dbKet').value);
  renderRecos('dbPosReco', recos, 'dbPos');
  fillDatalist($('dbPosList'), mergeUnique(recos, DAFTAR.posBiaya));
  updateBaruPreview();
}

// POS BIAYA -> saran POS BIAYA APLIKASI
function onBaruPos() {
  var reco = DAFTAR.posToApp[$('dbPos').value.trim()] || [];
  renderRecos('dbAppReco', reco, 'dbApp');
  fillDatalist($('dbAppList'), mergeUnique(reco, DAFTAR.posBiayaAplikasi));
  updateBaruPreview();
}

// POS BIAYA APLIKASI -> saran ITEM BIAYA
function onBaruApp() {
  var reco = DAFTAR.appToItem[$('dbApp').value.trim()] || [];
  renderRecos('dbItemReco', reco, 'dbItem');
  fillDatalist($('dbItemList'), mergeUnique(reco, DAFTAR.itemBiaya));
  updateBaruPreview();
}

function updateBaruPreview() {
  var pos = $('dbPos').value.trim();
  $('bpvKet').textContent = $('dbKet').value.trim() || '—';
  $('bpvPos').textContent = pos || '—';
  $('bpvApp').textContent = $('dbApp').value.trim() || '—';
  $('bpvItem').textContent = $('dbItem').value.trim() || '—';
  $('bpvKode').textContent = pos ? (DAFTAR.posCode[pos] || '(otomatis dari sheet)') : '—';
}

function handleBaruSubmit(e) {
  e.preventDefault();
  var btn = $('baruSubmitBtn');
  setMsg($('baruMsg'), '', '');

  var payload = {
    action: 'daftarbiaya',
    password: getPw(),
    keterangan: $('dbKet').value.trim(),
    posBiaya: $('dbPos').value.trim(),
    posBiayaAplikasi: $('dbApp').value.trim(),
    itemBiaya: $('dbItem').value.trim()
  };
  if (!payload.keterangan) return setMsg($('baruMsg'), 'Keterangan Biaya wajib diisi.', 'err');
  if (!payload.posBiaya) return setMsg($('baruMsg'), 'POS BIAYA wajib dipilih.', 'err');

  btn.disabled = true; btn.textContent = 'Menyimpan...';
  jsonp(payload).then(function (res) {
    if (!res.ok) {
      if (res.error === 'UNAUTHORIZED') {
        clearPw();
        setMsg($('baruMsg'), 'Sesi berakhir. Silakan masuk lagi.', 'err');
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      throw new Error(res.error || 'Gagal menyimpan');
    }
    setMsg($('baruMsg'), '✓ Tersimpan di baris ' + res.row + '. Kode Transaksi: ' + (res.kode || '-'), 'ok');
    $('dbKet').value = ''; $('dbPos').value = ''; $('dbApp').value = ''; $('dbItem').value = '';
    onBaruKet(); onBaruPos(); onBaruApp();
    loadData(); // segarkan agar keterangan baru muncul juga di form Tambah Biaya
  }).catch(function (err) {
    setMsg($('baruMsg'), 'Gagal: ' + err.message, 'err');
  }).then(function () {
    btn.disabled = false; btn.textContent = '💾 Simpan Biaya Baru';
  });
}

// ---------- Aliran Kas (REKAP per outlet) ----------
function apiCashflow(outlet, year, month) {
  return jsonp({ action: 'cashflow', password: getPw(), outlet: outlet, year: year, month: month });
}

// Format nilai aliran kas (boleh negatif): 761120 -> "761.120", -118600 -> "-118.600".
function fmtCash(n) {
  if (n == null || n === '') return '—';
  if (typeof n !== 'number') return String(n);
  var sign = n < 0 ? '-' : '';
  return sign + formatThousand(String(Math.abs(Math.round(n))));
}

function titleCaseMonth(s) {
  s = String(s || '').toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// Isi dropdown bulan: Maret 2026 s/d bulan berjalan (terbaru di atas).
function buildBulanOptions() {
  var sel = $('afBulan');
  if (!sel) return;
  sel.innerHTML = '';
  var now = new Date();
  var endY = now.getFullYear(), endM = now.getMonth() + 1; // 1..12
  var list = [], y = 2026, m = 3;
  while (y < endY || (y === endY && m <= endM)) {
    list.push({ y: y, m: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  if (!list.length) list.push({ y: 2026, m: 3 }); // jaga-jaga sebelum Mar 2026
  list.reverse();
  list.forEach(function (it) {
    var o = document.createElement('option');
    o.value = it.y + '-' + it.m;
    o.textContent = BULAN_LABEL[it.m - 1] + ' ' + it.y;
    sel.appendChild(o);
  });
}

// Isi dropdown tanggal opsional dari daftar hari yang tersedia.
function fillTanggalOptions(days) {
  var sel = $('afTanggal');
  sel.innerHTML = '';
  var o0 = document.createElement('option');
  o0.value = ''; o0.textContent = '— Semua tanggal —';
  sel.appendChild(o0);
  (days || []).forEach(function (d) {
    var o = document.createElement('option');
    o.value = String(d); o.textContent = 'Tanggal ' + d;
    sel.appendChild(o);
  });
  sel.value = '';
}

// Ambil data aliran kas sesuai outlet + bulan yang dipilih, lalu render.
function loadCashflow() {
  if (!apiConfigured()) { show($('configWarn'), true); return; }
  var outlet = $('afOutlet').value;
  var ym = ($('afBulan').value || '').split('-');
  if (ym.length !== 2) return;
  var year = parseInt(ym[0], 10), month = parseInt(ym[1], 10);

  setMsg($('afMsg'), 'Memuat aliran kas...', '');
  show($('afWrap'), false);

  apiCashflow(outlet, year, month).then(function (res) {
    if (!res.ok) {
      if (res.error === 'UNAUTHORIZED') {
        clearPw();
        setMsg($('afMsg'), 'Sesi berakhir. Silakan masuk lagi.', 'err');
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      throw new Error(res.error || 'Gagal memuat aliran kas');
    }
    ALIRAN = {
      outlet: res.outlet, year: res.year, month: res.month,
      monthName: res.monthName, days: res.days || [], metrics: res.metrics || []
    };
    fillTanggalOptions(ALIRAN.days);
    renderAliran(null);
  }).catch(function (err) {
    setMsg($('afMsg'), 'Gagal: ' + err.message, 'err');
    show($('afWrap'), false);
  });
}

// Render tabel aliran kas. filterDay = null (semua) atau angka tanggal tertentu.
function renderAliran(filterDay) {
  var head = $('afHead'), body = $('afBody');
  head.innerHTML = ''; body.innerHTML = '';

  var days = ALIRAN.days || [];
  var cols = (filterDay == null) ? days.slice() : days.filter(function (d) { return d === filterDay; });
  var lbl = titleCaseMonth(ALIRAN.monthName) + ' ' + (ALIRAN.year || '');

  if (!cols.length) {
    show($('afWrap'), false);
    setMsg($('afMsg'), 'Belum ada data tanggal untuk ' + ALIRAN.outlet + ' · ' + lbl + '.', 'ok');
    return;
  }

  // Header: kolom Metrik (lengket) + satu kolom per tanggal.
  var thM = document.createElement('th');
  thM.textContent = 'TANGGAL';
  head.appendChild(thM);
  cols.forEach(function (d) {
    var th = document.createElement('th');
    th.textContent = String(d); th.className = 'num';
    head.appendChild(th);
  });

  var colIdx = cols.map(function (d) { return days.indexOf(d); });

  (ALIRAN.metrics || []).forEach(function (m) {
    var tr = document.createElement('tr');
    var cls = [];
    if (m.highlight) cls.push('selreal');
    if (m.text) cls.push('textrow');
    if (cls.length) tr.className = cls.join(' ');

    var tdL = document.createElement('td');
    tdL.className = 'metric'; tdL.textContent = m.label;
    tr.appendChild(tdL);

    colIdx.forEach(function (ci) {
      var v = m.values[ci];
      var td = document.createElement('td');
      if (m.text) {
        // Teks panjang: bungkus agar wrap ke bawah (bukan melebarkan kolom).
        td.className = 'wrap';
        var box = document.createElement('div');
        box.className = 'wrapbox';
        box.textContent = (v == null || v === '') ? '' : String(v);
        td.appendChild(box);
      } else {
        td.className = 'num';
        td.textContent = fmtCash(v);
        if (m.highlight && typeof v === 'number' && v !== 0) {
          td.classList.add(v > 0 ? 'pos' : 'neg');
        }
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  show($('afWrap'), true);
  var info = ALIRAN.outlet + ' · ' + lbl +
    (filterDay == null ? (' · ' + cols.length + ' hari') : (' · tanggal ' + filterDay));
  setMsg($('afMsg'), info, 'ok');
}

// Muat data Aliran Kas saat pertama kali tab dibuka.
function ensureAliranLoaded() {
  if (!ALIRAN.year) loadCashflow();
}

// ---------- Load ----------
function loadData(opts) {
  opts = opts || {};
  if (!apiConfigured()) { show($('configWarn'), true); return; }
  var info = $('recentInfo');
  if (info) info.textContent = 'Memuat...';

  return apiGet().then(function (data) {
    if (!data.ok) {
      if (data.error === 'UNAUTHORIZED') {
        // kata sandi salah / sesi tidak valid -> kembali ke gate
        clearPw();
        show($('app'), false);
        show($('btnLogout'), false);
        show($('gate'), true);
        setMsg($('gateMsg'), 'Kata sandi salah atau belum diset di Apps Script.', 'err');
        return;
      }
      throw new Error(data.error || 'Gagal memuat data');
    }
    show($('gate'), false);
    show($('app'), true);
    show($('btnLogout'), true);
    applyData(data);
    if (opts.onok) opts.onok();
  }).catch(function (err) {
    // Tampilkan error di layar yang sedang aktif (gerbang login atau form).
    var target = $('gate').hidden ? $('formMsg') : $('gateMsg');
    setMsg(target, 'Gagal: ' + err.message, 'err');
    if (info) info.textContent = 'Gagal memuat.';
  });
}

// ---------- Submit ----------
function handleSubmit(e) {
  e.preventDefault();
  var btn = $('submitBtn');
  setMsg($('formMsg'), '', '');

  var payload = {
    password: getPw(),
    keterangan: $('keterangan').value,
    nominal: onlyDigits($('nominal').value),
    tanggal: $('tanggal').value,
    outlet: $('outlet').value,
    sumberDana: $('sumberDana').value,
    keteranganPenggunaan: $('keteranganPenggunaan').value,
    statusLapor: $('statusLapor').value,
    verifikasi: $('verifikasi').value
  };

  // Validasi ringan di sisi klien
  if (!payload.keterangan) return setMsg($('formMsg'), 'Keterangan wajib dipilih.', 'err');
  if (!(Number(payload.nominal) > 0)) return setMsg($('formMsg'), 'Nominal harus angka lebih dari 0.', 'err');
  if (!payload.tanggal) return setMsg($('formMsg'), 'Tanggal wajib diisi.', 'err');
  if (!payload.outlet) return setMsg($('formMsg'), 'Outlet wajib dipilih.', 'err');

  var editing = !!EDIT_ROW;
  var req;
  if (editing) {
    payload.row = EDIT_ROW.row;
    payload.expectKeterangan = EDIT_ROW.keterangan;
    req = apiUpdate(payload);
  } else {
    req = apiAppend(payload);
  }

  btn.disabled = true;
  btn.textContent = editing ? 'Memperbarui...' : 'Menyimpan...';

  req.then(function (res) {
    if (!res.ok) {
      if (res.error === 'UNAUTHORIZED') {
        clearPw();
        setMsg($('formMsg'), 'Sesi berakhir. Silakan masuk lagi.', 'err');
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      throw new Error(res.error || 'Gagal menyimpan');
    }
    if (editing) {
      setMsg($('formMsg'), '✓ Baris ' + res.row + ' diperbarui. Kode: ' + (res.values[11] || '-'), 'ok');
      cancelEdit();
    } else {
      setMsg($('formMsg'), '✓ Tersimpan di baris ' + res.row + '. Kode: ' + (res.values[11] || '-'), 'ok');
      // Reset sebagian field (biarkan tanggal & outlet untuk input beruntun)
      $('keterangan').selectedIndex = 0;
      $('nominal').value = '';
      $('keteranganPenggunaan').value = '';
      updatePreview();
    }
    loadData({ onok: function () { markNewRow(); } });
  }).catch(function (err) {
    setMsg($('formMsg'), 'Gagal: ' + err.message, 'err');
  }).then(function () {
    btn.disabled = false;
    btn.textContent = EDIT_ROW ? ('✏️ Perbarui baris ' + EDIT_ROW.row) : '💾 Simpan ke Sheet';
  });
}

function markNewRow() {
  var first = $('recentBody').querySelector('tr');
  if (first) first.classList.add('new');
}

// Tampilkan satu view aktif.
function showView(name) {
  var views = { form: 'viewForm', data: 'viewData', deposit: 'viewDeposit', baru: 'viewBaru', aliran: 'viewAliran' };
  var tabs = { form: 'tabForm', data: 'tabData', deposit: 'tabDeposit', baru: 'tabBaru', aliran: 'tabAliran' };
  Object.keys(views).forEach(function (k) {
    show($(views[k]), k === name);
    $(tabs[k]).classList.toggle('active', k === name);
  });
}

// ---------- Init ----------
function init() {
  $('appTitle').textContent = (typeof CONFIG !== 'undefined' && CONFIG.APP_TITLE) || 'Co Clean Laundry';

  // Default tanggal = hari ini
  var t = new Date();
  $('tanggal').value =
    t.getFullYear() + '-' +
    String(t.getMonth() + 1).padStart(2, '0') + '-' +
    String(t.getDate()).padStart(2, '0');

  // Format nominal saat mengetik
  $('nominal').addEventListener('input', function () {
    var pos = this.value.length - this.selectionStart;
    this.value = formatThousand(this.value);
    this.selectionStart = this.selectionEnd = this.value.length - pos;
  });

  // Pratinjau
  ['keterangan', 'outlet', 'tanggal'].forEach(function (id) {
    $(id).addEventListener('change', updatePreview);
  });

  // Tab / view
  $('tabForm').addEventListener('click', function () { showView('form'); });
  $('tabData').addEventListener('click', function () { showView('data'); });
  $('tabDeposit').addEventListener('click', function () { showView('deposit'); });
  $('tabBaru').addEventListener('click', function () { showView('baru'); });
  $('tabAliran').addEventListener('click', function () { showView('aliran'); ensureAliranLoaded(); });

  // Aliran Kas (REKAP per outlet)
  buildBulanOptions();
  $('afOutlet').addEventListener('change', loadCashflow);
  $('afBulan').addEventListener('change', loadCashflow);
  $('afTanggal').addEventListener('change', function () {
    var v = $('afTanggal').value;
    renderAliran(v ? parseInt(v, 10) : null);
  });

  // Deposit: tanggal default hari ini, format nominal, pratinjau, cek saldo
  $('depTanggal').value = $('tanggal').value;
  $('depNominal').addEventListener('input', function () {
    var pos = this.value.length - this.selectionStart;
    this.value = formatThousand(this.value);
    this.selectionStart = this.selectionEnd = this.value.length - pos;
  });
  ['depJenis', 'depNama', 'depTanggal', 'depOutlet', 'depNominal'].forEach(function (id) {
    $(id).addEventListener('input', updateDepPreview);
    $(id).addEventListener('change', updateDepPreview);
  });
  $('depCekNama').addEventListener('change', onDepCekChange);
  $('depForm').addEventListener('submit', handleDepSubmit);

  // Input biaya baru (DAFTAR BIAYA)
  $('dbKet').addEventListener('input', onBaruKet);
  $('dbPos').addEventListener('input', onBaruPos);
  $('dbPos').addEventListener('change', onBaruPos);
  $('dbApp').addEventListener('input', onBaruApp);
  $('dbApp').addEventListener('change', onBaruApp);
  $('dbItem').addEventListener('input', updateBaruPreview);
  $('dbItem').addEventListener('change', updateBaruPreview);
  $('baruForm').addEventListener('submit', handleBaruSubmit);

  // Form & tombol
  $('biayaForm').addEventListener('submit', handleSubmit);
  $('cancelEdit').addEventListener('click', cancelEdit);
  $('btnRefresh').addEventListener('click', function () { loadData(); });
  $('btnLogout').addEventListener('click', function () { clearPw(); location.reload(); });

  $('gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('gatePassword').value;
    if (!pw) return;
    setPw(pw);
    setMsg($('gateMsg'), 'Memeriksa...', '');
    $('gateBtn').disabled = true;
    loadData().then(function () { $('gateBtn').disabled = false; });
  });

  if (!apiConfigured()) {
    show($('configWarn'), true);
    show($('gate'), true);
    return;
  }

  // Auto-login bila sesi masih ada
  if (getPw()) {
    loadData();
  } else {
    show($('gate'), true);
  }
}

// Saat di-load dinamis (cache-busting), DOM bisa sudah siap -> jalankan langsung.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

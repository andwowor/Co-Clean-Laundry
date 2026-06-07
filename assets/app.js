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

function apiPostAppend(payload) {
  payload.action = 'append';
  return jsonp(payload);
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
}

function renderRecent(data) {
  var head = $('recentHead'), body = $('recentBody');
  head.innerHTML = ''; body.innerHTML = '';

  (data.headers || []).forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  });

  (data.recent || []).forEach(function (row) {
    var tr = document.createElement('tr');
    row.forEach(function (cell) {
      var td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });

  $('recentInfo').textContent =
    'Menampilkan ' + (data.recent ? data.recent.length : 0) +
    ' entri terbaru · baris terakhir terisi: ' + (data.lastDataRow || '-');
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

  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  apiPostAppend(payload).then(function (res) {
    if (!res.ok) {
      if (res.error === 'UNAUTHORIZED') {
        clearPw();
        setMsg($('formMsg'), 'Sesi berakhir. Silakan masuk lagi.', 'err');
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      throw new Error(res.error || 'Gagal menyimpan');
    }
    setMsg($('formMsg'), '✓ Tersimpan di baris ' + res.row + '. Kode: ' + (res.values[11] || '-'), 'ok');
    // Reset sebagian field (biarkan tanggal & outlet untuk input beruntun)
    $('keterangan').selectedIndex = 0;
    $('nominal').value = '';
    $('keteranganPenggunaan').value = '';
    updatePreview();
    loadData({ onok: function () { markNewRow(); } });
  }).catch(function (err) {
    setMsg($('formMsg'), 'Gagal menyimpan: ' + err.message, 'err');
  }).then(function () {
    btn.disabled = false;
    btn.textContent = '💾 Simpan ke Sheet';
  });
}

function markNewRow() {
  var first = $('recentBody').querySelector('tr');
  if (first) first.classList.add('new');
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

  // Form & tombol
  $('biayaForm').addEventListener('submit', handleSubmit);
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

document.addEventListener('DOMContentLoaded', init);

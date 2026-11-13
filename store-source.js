/* ============================================================
   NGUỒN CHUẨN DANH SÁCH CỬA HÀNG — WinMart+ Rural
   Sheet "Storelist Rural" › tab API_Stores (sinh tự động từ tab Storeslist).
   Sửa dữ liệu CH: chỉ sửa ở tab Storeslist. KHÔNG sửa tay API_Stores,
   KHÔNG sửa tay file storelist.json/.csv trong repo (file đó sinh lại từ API_Stores).

   Cách dùng:
     STORE_SOURCE.live(r => ({ ma: r.ma_sap, ten: r.ten_ch, ... }))
       .catch(() => <cách tải cũ: file tĩnh trong repo>)

   Cột của API_Stores:
     ma_sap ten_ch tinh_trang khai_truong(yyyy-mm-dd) mien tinh huyen
     tinh_moi xa_moi dia_chi lat lng mat_tien dtkd size_v
     qlkv gdv cht hub_rau hub_thit hub_kho nhom_dt
   ============================================================ */
(function (g) {
  var SHEET_ID = '1UMtB9MOxGOaZvxN5VAUGAS1bPaAL2tVVFEViGANd4Tk';
  var GID = '1472970142';
  var URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
            '/gviz/tq?tqx=out:csv&gid=' + GID;
  var CACHE_KEY = 'store_source_v1';
  var CACHE_MIN = 30;

  function parseCSV(text) {
    var rows = [], row = [], cur = '', q = false, i, c;
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function toObjects(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h).trim(); });
    return rows.slice(1).filter(function (r) { return r[0] && String(r[0]).trim(); })
      .map(function (r) {
        var o = {}, j;
        for (j = 0; j < head.length; j++) o[head[j]] = (r[j] == null ? '' : String(r[j]).trim());
        return o;
      });
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.t || !Array.isArray(c.d)) return null;
      if (Date.now() - c.t > CACHE_MIN * 60000) return null;
      return c.d;
    } catch (e) { return null; }
  }

  function writeCache(d) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
  }

  /* Trả về mảng object thô (theo tên cột của API_Stores). */
  function raw() {
    var c = readCache();
    if (c) return Promise.resolve(c);
    return fetch(URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('API_Stores HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      if (/^\s*</.test(t)) throw new Error('API_Stores tra ve HTML (sheet chua mo quyen xem)');
      var d = toObjects(parseCSV(t));
      if (d.length < 500) throw new Error('API_Stores chi co ' + d.length + ' dong');
      writeCache(d);
      return d;
    });
  }

  /* Trả về mảng đã đổi tên trường theo app. */
  function live(mapFn) {
    return raw().then(function (d) { return mapFn ? d.map(mapFn) : d; });
  }

  g.STORE_SOURCE = { url: URL, sheetId: SHEET_ID, gid: GID, raw: raw, live: live, parseCSV: parseCSV };
})(window);

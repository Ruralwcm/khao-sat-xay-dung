/**
 * ============================================================
 *  MULTI-PURPOSE SURVEY BACKEND — Google Apps Script
 *  Một GAS duy nhất dùng chung cho MỌI khảo sát / form của Rural.
 *  Hỗ trợ CRUD đầy đủ: list / save / upsert / update / delete / clear.
 * ============================================================
 *
 *  API (frontend truyền tham số `table`):
 *    GET  ?action=list&table=<key>               → toàn bộ records
 *    GET  ?action=tables                          → liệt kê các bảng
 *    GET  ?action=config&table=<key>              → header + số dòng + field list
 *
 *    POST {action:'save',   table, data}          → thêm mới (tự sinh id)
 *    POST {action:'upsert', table, key, data}     → thêm hoặc cập nhật (theo key)
 *    POST {action:'update', table, id, data}      → cập nhật theo id
 *    POST {action:'delete', table, id}            → xóa theo id
 *    POST {action:'clear',  table}                → xóa sạch (giữ header)
 *    POST {action:'remove', table, key, value}    → xóa theo field bất kỳ
 *
 *  → Schema động: không cần khai báo trước. GAS tự tạo tab + tự thêm
 *    cột (header) từ chính các field frontend gửi lên.
 *  → Muốn đặt tên tab đẹp / khóa field bắt buộc / khóa identity
 *    (cột dùng để upsert) → thêm vào TABLES bên dưới.
 *
 *  DEPLOY:
 *    1. Mở https://script.google.com → New project
 *    2. Paste toàn bộ file này vào Code.gs → Save (Ctrl+S)
 *    3. Deploy → New deployment → Web App
 *       - Execute as: Me   ·   Access: Anyone
 *    4. Copy Web App URL → dán vào app (ô GAS URL)
 *
 *  SHEET MẶC ĐỊNH: "Data Web App Rural"
 * ============================================================
 */

var DEFAULT_SHEET_ID = '1RtVPThy95QMdHGvfL_9lCMNwcgStXCxxqLj1Cpf-KwY';
var STORELIST_SOURCE_ID = '1fMmEm1GC9aei_3oeu2vcadPVsUM9ms9eVhm99d7pF8A'; // storelist nguồn
var STORE_SHEET_NAME = 'Store_list';
var CTP_SHEET_ID = '1vBgt-ERAP6cNWVKUF8sa45Sw203BQywAE4CBU0c_6XA'; // Công tác phí Rural
var CTP_USERS_TAB = '5-Users';

/** Định dạng date/time VN (UTC+7): dd/mm/yyyy HH:MM */
function nowVN() {
  var d = new Date(new Date().getTime() + 7 * 3600 * 1000);
  var dd = String(d.getUTCDate()).padStart(2, '0');
  var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  var yyyy = d.getUTCFullYear();
  var hh = String(d.getUTCHours()).padStart(2, '0');
  var min = String(d.getUTCMinutes()).padStart(2, '0');
  return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min;
}

/**
 * Registry — tên tab đẹp, field bắt buộc, key identity (cho upsert).
 * `key`   : cột dùng để nhận diện trùng (upsert / update theo field khác id).
 * `required`: các field bắt buộc khi save.
 */
var TABLES = {
  nha_thau:      { tab: 'NhaThau_Data',      required: ['hangMuc', 'tenCty'], key: null },
  thit_mdl:      { tab: 'ThitMDL_Data',      required: ['ma_ch'],             key: null },
  lich_lam_viec: { tab: 'LichLamViec_Data',  required: ['ho_ten'],            key: null }
};

/* ============================================================
 *  ENTRY POINTS
 * ============================================================ */
function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var action = p.action || 'list';
  var table  = p.table  || p.tab || '';

  if (action === 'list') {
    var data = listRecords(table, p);
    return json({ success: true, data: data, count: data.length });
  }
  if (action === 'tables') {
    return json({ success: true, data: listTables() });
  }
  if (action === 'config') {
    return json({ success: true, data: describeTable(table) });
  }
  // === Lịch làm việc — action tương thích ngược ===
  if (action === 'getStorelist') {
    return json(getStorelist(p));
  }
  if (action === 'getGdvList') {
    return json(getGdvList());
  }
  if (action === 'nhanSu' || action === 'getUsers') {
    return json(getUsers());
  }
  return json({ success: false, error: 'Unknown action: ' + action });
}

function doPost(e) {
  var body = parseBody(e);
  var action = body.action;
  var table  = body.table || body.tab || '';
  var data   = body.data || {};

  try {
    switch (action) {
      case 'list':   return json(listRecordsMulti(table, body));
      case 'save':   return json(saveRecord(table, data));
      case 'upsert': return json(upsertRecord(table, body.key || tableKeyOf(table), data));
      case 'update': return json(updateRecord(table, body.id, data));
      case 'delete': return json(deleteRecord(table, body.id));
      case 'remove': return json(removeWhere(table, body.key || tableKeyOf(table), body.value));
      case 'clear':  return json(clearTable(table));
      // === Lịch làm việc — action tương thích ngược ===
      case 'saveSchedule': return json(saveSchedule(data));
      case 'getSchedule':  return json(getSchedule(data));
      case 'getGdvList':   return json(getGdvList());
      case 'getStorelist': return json(getStorelist(body));
      case 'nhanSu':
      case 'getUsers':     return json(getUsers());
      default:       return json({ success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json({ success: false, error: 'Server error: ' + err.toString() });
  }
}

/* ============================================================
 *  CORE LOGIC
 * ============================================================ */

function tabNameOf(table) {
  var cfg = TABLES[table];
  if (cfg && cfg.tab) return cfg.tab;
  if (table) return table;
  return 'Survey_Data';
}

function tableKeyOf(table) {
  var cfg = TABLES[table];
  if (cfg && cfg.key) return cfg.key;
  return 'id';
}

function getOrCreateSheet(sheetName) {
  var ss = SpreadsheetApp.openById(DEFAULT_SHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  return sheet;
}

function getHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow < 1 || lastCol < 1) return [];
  var vals = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = [];
  for (var i = 0; i < vals.length; i++) {
    var h = String(vals[i]).trim();
    if (h) headers.push(h);
  }
  return headers;
}

/** Chuẩn hóa header: đảm bảo có đủ các field, thêm cột thiếu. Trả về headers cuối. */
function ensureHeaders(sheet, headerFields) {
  var headers = getHeaders(sheet);

  // Đảm bảo luôn có 'id' & 'created_at' ở cuối chuẩn
  var extra = ['id', 'created_at', 'updated_at'];
  for (var e = 0; e < extra.length; e++) {
    if (headers.indexOf(extra[e]) < 0) {
      // 'id' và 'created_at' nên đứng đầu cho gọn
      if (extra[e] === 'id' || extra[e] === 'created_at') {
        headers.unshift(extra[e]);
      } else {
        headers.push(extra[e]);
      }
    }
  }

  var needRewrite = false;
  for (var j = 0; j < headerFields.length; j++) {
    if (headers.indexOf(headerFields[j]) < 0) {
      headers.push(headerFields[j]);
      needRewrite = true;
    }
  }
  if (headerFields.length === 0 && headers.length !== getHeaders(sheet).length) needRewrite = true;

  // Ghi lại header nếu có thay đổi
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#C00000').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  return headers;
}

/** Lưu 1 record mới */
function saveRecord(table, data) {
  var cfg = TABLES[table];
  var sheet = getOrCreateSheet(tabNameOf(table));

  if (cfg && cfg.required) {
    for (var i = 0; i < cfg.required.length; i++) {
      var k = cfg.required[i];
      if (!data[k] && data[k] !== 0) {
        return { success: false, error: 'Thiếu field bắt buộc: ' + k };
      }
    }
  }

  var now = nowVN();
  var record = {};
  record['id'] = Utilities.getUuid();
  record['created_at'] = now;
  record['updated_at'] = now;
  for (var key in data) {
    if (data.hasOwnProperty(key)) record[key] = data[key];
  }

  var headers = ensureHeaders(sheet, Object.keys(record));
  var row = [];
  for (var c = 0; c < headers.length; c++) {
    var val = record[headers[c]];
    row.push(val !== undefined ? val : '');
  }
  sheet.appendRow(row);

  return { success: true, message: 'Đã lưu record', id: record['id'] };
}

/** Upsert: nếu tồn tại record có <key> == data[key] thì cập nhật, ngược lại thêm mới */
function upsertRecord(table, key, data) {
  var sheet = getOrCreateSheet(tabNameOf(table));
  var headers = ensureHeaders(sheet, Object.keys(data));
  var idCol = headers.indexOf('id');
  var keyCol = headers.indexOf(key || 'id');

  if (keyCol < 0) keyCol = idCol;

  var matchValue = data[key];
  var lastRow = sheet.getLastRow();
  var foundRow = -1;

  if (matchValue !== undefined && matchValue !== null && matchValue !== '') {
    var values = sheet.getRange(2, keyCol + 1, Math.max(1, lastRow - 1), 1).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]) === String(matchValue)) { foundRow = i + 2; break; }
    }
  }

  if (foundRow > 0) {
    var now = nowVN();
    data['updated_at'] = now;
    for (var f = 0; f < headers.length; f++) {
      var hdr = headers[f];
      if (hdr === 'id' || hdr === 'created_at') continue;
      var v = data[hdr];
      if (v !== undefined) sheet.getRange(foundRow, f + 1).setValue(v);
    }
    var existingId = sheet.getRange(foundRow, idCol + 1).getValue();
    return { success: true, message: 'Đã cập nhật record', id: String(existingId), updated: true };
  }

  return saveRecord(table, data);
}

/** Cập nhật record theo id */
function updateRecord(table, id, data) {
  if (!id) return { success: false, error: 'Thiếu id' };
  var sheet = getOrCreateSheet(tabNameOf(table));
  var headers = ensureHeaders(sheet, Object.keys(data));
  var idCol = headers.indexOf('id');
  if (idCol < 0) return { success: false, error: 'Không có cột id' };

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, idCol + 1, Math.max(1, lastRow - 1), 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      var rowNum = i + 2;
      var now = nowVN();
      data['updated_at'] = now;
      for (var f = 0; f < headers.length; f++) {
        var hdr = headers[f];
        if (hdr === 'id' || hdr === 'created_at') continue;
        var v = data[hdr];
        if (v !== undefined) sheet.getRange(rowNum, f + 1).setValue(v);
      }
      return { success: true, message: 'Đã cập nhật record' };
    }
  }
  return { success: false, error: 'Không tìm thấy id: ' + id };
}

/** Đọc toàn bộ records của một table */

/** Wrapper cho POST — trả về { success, data, count } */
function listRecordsMulti(table, body) {
  var rows = listRecords(table, body || {});
  return { success: true, data: rows, count: rows.length };
}

function listRecords(table, filter) {
  var sheet = getOrCreateSheet(tabNameOf(table));
  var headers = getHeaders(sheet);
  if (headers.length === 0) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var results = [];
  for (var i = 0; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[i][j] !== undefined ? values[i][j] : '';
    }
    results.push(obj);
  }

  // Filter tùy chọn (query string, chống chọi từng field)
  if (filter) {
    var keys = Object.keys(filter);
    for (var f = 0; f < keys.length; f++) {
      var fk = keys[f];
      if (fk === 'action' || fk === 'table' || fk === 'tab') continue;
      (function(field, val) {
        results = results.filter(function(r) {
          return String(r[field] !== undefined ? r[field] : '') === String(val);
        });
      })(fk, filter[fk]);
    }
  }

  return results;
}

/** Xóa 1 record theo id */
function deleteRecord(table, id) {
  if (!id) return { success: false, error: 'Thiếu id' };
  var sheet = getOrCreateSheet(tabNameOf(table));
  var headers = getHeaders(sheet);
  var idCol = headers.indexOf('id');
  if (idCol < 0) return { success: false, error: 'Không có cột id' };

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, idCol + 1, Math.max(1, lastRow - 1), 1).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      return { success: true, message: 'Đã xóa record' };
    }
  }
  return { success: false, error: 'Không tìm thấy id: ' + id };
}

/** Xóa toàn bộ record khớp (field == value) */
function removeWhere(table, key, value) {
  if (!key || value === undefined || value === null || value === '') {
    return { success: false, error: 'Thiếu key/value' };
  }
  var sheet = getOrCreateSheet(tabNameOf(table));
  var headers = getHeaders(sheet);
  var keyCol = headers.indexOf(key);
  if (keyCol < 0) return { success: false, error: 'Không có cột: ' + key };

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, keyCol + 1, Math.max(1, lastRow - 1), 1).getValues();
  var deleted = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(value)) {
      sheet.deleteRow(i + 2);
      deleted++;
    }
  }
  return { success: true, message: 'Đã xóa ' + deleted + ' record', count: deleted };
}

/** Xóa sạch dữ liệu (giữ header) */
function clearTable(table) {
  var sheet = getOrCreateSheet(tabNameOf(table));
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow > 1 && lastCol > 0) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }
  return { success: true, message: 'Đã xóa sạch bảng' };
}

/** Mô tả bảng: header + số dòng + field */
function describeTable(table) {
  var sheet = getOrCreateSheet(tabNameOf(table));
  var headers = getHeaders(sheet);
  var rows = Math.max(0, sheet.getLastRow() - 1);
  return {
    tab: tabNameOf(table),
    headers: headers,
    rows: rows,
    key: tableKeyOf(table)
  };
}

/** Liệt kê các tab đang có trong sheet */
function listTables() {
  var ss = SpreadsheetApp.openById(DEFAULT_SHEET_ID);
  var sheets = ss.getSheets();
  var out = [];
  for (var i = 0; i < sheets.length; i++) {
    out.push({ tab: sheets[i].getName(), rows: sheets[i].getLastRow() });
  }
  return out;
}

/* ============================================================
 *  LỊCH LÀM VIỆC — action đặc thù (tương thích ngược)
 * ============================================================ */
var LLV_HEADERS = [
  'id', 'ho_ten', 'vai_tro', 'nam', 'tuan', 'ngay',
  'task_type', 'task_custom', 'ma_ch', 'ten_ch', 'ghi_chu',
  'created_at', 'updated_at'
];

/** Danh sách GĐV (đọc trực tiếp từ Store_list) */
function getGdvList() {
  try {
    var ss = SpreadsheetApp.openById(STORELIST_SOURCE_ID);
    var sheet = ss.getSheetByName(STORE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Store_list not found' };

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    var headers = data[0];
    var gdvCol = -1;
    for (var h = 0; h < headers.length; h++) {
      if (String(headers[h]).trim() === 'GĐV') { gdvCol = h; break; }
    }
    if (gdvCol < 0) return { success: false, error: 'GĐV column not found' };

    var seen = {};
    var gdvList = [];
    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][gdvCol] || '').trim();
      if (name && !seen[name]) {
        seen[name] = true;
        gdvList.push({ ho_ten: name, vai_tro: 'GĐV' });
      }
    }
    gdvList.sort(function(a, b) { return a.ho_ten.localeCompare(b.ho_ten, 'vi'); });
    gdvList.unshift({ ho_ten: 'GĐM (Giám đốc Miền)', vai_tro: 'GĐM' });

    return { success: true, data: gdvList };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/** Danh sách cửa hàng (search) */
function getStorelist(params) {
  var search = '';
  if (params && params.search) search = String(params.search).toLowerCase().trim();

  try {
    var ss = SpreadsheetApp.openById(STORELIST_SOURCE_ID);
    var sheet = ss.getSheetByName(STORE_SHEET_NAME);
    if (!sheet) return { success: false, error: 'Store_list not found' };

    var data = sheet.getDataRange().getValues();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      var ma = String(row[0]).trim();
      var ten = String(row[1]).trim();
      if (search) {
        if (ma.toLowerCase().indexOf(search) >= 0 || ten.toLowerCase().indexOf(search) >= 0) {
          results.push({ ma_sap: ma, ten_ch: ten });
        }
      } else {
        results.push({ ma_sap: ma, ten_ch: ten });
      }
    }

    if (!search) results = results.slice(0, 500);
    return { success: true, data: results };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/** Lưu lịch làm việc (thay thế tasks của cùng ho_ten/nam/tuan) */
function saveSchedule(data) {
  var tasks = data.tasks;
  if (!tasks || !Array.isArray(tasks)) return { success: false, error: 'Invalid tasks array' };

  var sheet = getOrCreateSheet('LichLamViec_Data');
  if (getHeaders(sheet).length === 0) {
    sheet.getRange(1, 1, 1, LLV_HEADERS.length).setValues([LLV_HEADERS]);
    sheet.getRange(1, 1, 1, LLV_HEADERS.length)
      .setFontWeight('bold').setBackground('#C00000').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  var headers = getHeaders(sheet);

  // Index các cột cần
  function colIdx(name) { var ix = headers.indexOf(name); return ix < 0 ? -1 : ix; }
  var hoTenI = colIdx('ho_ten'), namI = colIdx('nam'), tuanI = colIdx('tuan');

  var allRows = sheet.getDataRange().getValues();

  // Xóa rows cũ khớp (ho_ten, nam, tuan)
  if (tasks.length > 0) {
    var sample = tasks[0];
    for (var i = allRows.length - 1; i >= 1; i--) {
      var r = allRows[i];
      if (r[hoTenI] === sample.ho_ten &&
          r[namI] === sample.nam &&
          String(r[tuanI]) === String(sample.tuan)) {
        sheet.deleteRow(i + 1);
      }
    }
  }

  // Append tasks mới
  var now = nowVN();
  var newRows = tasks.map(function(t) {
    var row = new Array(headers.length);
    for (var c = 0; c < headers.length; c++) row[c] = '';
    function set(name, val) { var ix = colIdx(name); if (ix >= 0) row[ix] = val; }
    set('id', t.id || Utilities.getUuid());
    set('ho_ten', t.ho_ten || '');
    set('vai_tro', t.vai_tro || '');
    set('nam', t.nam || '');
    set('tuan', t.tuan || '');
    set('ngay', t.ngay || '');
    set('task_type', t.task_type || '');
    set('task_custom', t.task_custom || '');
    set('ma_ch', t.ma_ch || '');
    set('ten_ch', t.ten_ch || '');
    set('ghi_chu', t.ghi_chu || '');
    set('created_at', t.created_at || now);
    set('updated_at', now);
    return row;
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { success: true, message: 'Đã lưu ' + newRows.length + ' task', count: newRows.length };
}

/** Đọc lịch làm việc (filter ho_ten/vai_tro/nam/tuan) */
function getSchedule(data) {
  var sheet = getOrCreateSheet('LichLamViec_Data');
  var headers = getHeaders(sheet);
  if (headers.length === 0) return { success: true, data: [] };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, data: [] };

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var results = [];
  for (var i = 0; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[i][j] !== undefined ? values[i][j] : '';
    }
    results.push(obj);
  }

  if (data) {
    if (data.ho_ten)  results = results.filter(function(r) { return r.ho_ten === data.ho_ten; });
    if (data.vai_tro) results = results.filter(function(r) { return r.vai_tro === data.vai_tro; });
    if (data.nam)     results = results.filter(function(r) { return String(r.nam) === String(data.nam); });
    if (data.tuan)    results = results.filter(function(r) { return String(r.tuan) === String(data.tuan); });
  }

  return { success: true, data: results };
}

/* ============================================================
 *  HELPERS
 * ============================================================ */
function parseBody(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      var b = JSON.parse(e.postData.contents);
      if (b && typeof b === 'object') return b;
    } catch (err) {
      return e.parameter || {};
    }
  }
  return e && e.parameter ? e.parameter : {};
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
 *  CTP — CÔNG TÁC PHÍ (đọc danh sách nhân sự)
 * ============================================================ */

/** Danh sách nhân sự từ sheet Công tác phí Rural, tab 5-Users */
function getUsers() {
  try {
    var ss = SpreadsheetApp.openById(CTP_SHEET_ID);
    var sheet = ss.getSheetByName(CTP_USERS_TAB);
    if (!sheet) return { success: false, error: '5-Users tab not found' };

    var rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };

    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r[0]) continue;
      out.push({
        maNV: String(r[0]).trim(),
        ten: r[1] || '',
        chucVu: r[2] || 'NV',
        role: r[2] || 'NV',
        gdv: r[3] || '',
        ngayVao: r[4] || ''
      });
    }
    return { success: true, data: out };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/* ============================================================
 *  TEST (chạy từ Apps Script editor nếu cần)
 * ============================================================ */
function testSave() {
  return saveRecord('demo_khao_sat', {
    hangMuc: 'Cơ khí', tenCty: 'Công ty Test', sdt: '0912345678'
  });
}

function testUpsert() {
  return upsertRecord('demo_khao_sat', 'tenCty', {
    tenCty: 'Công ty Test', sdt: '0987654321'
  });
}

function testList() {
  return listRecords('demo_khao_sat');
}

function testClear() {
  return clearTable('demo_khao_sat');
}

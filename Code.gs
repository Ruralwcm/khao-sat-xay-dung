/**
 * GAS Backend — Khảo sát Vấn đề Xây dựng
 * Sheet: Data Web App Rural (1RtVPThy95QMdHGvfL_9lCMNwcgStXCxxqLj1Cpf-KwY)
 * Tab: xay_dung (tự tạo nếu chưa có)
 *
 * API:
 *   GET  ?action=list              → trả về tất cả records
 *   GET  ?action=data              → trả về records (định dạng khác)
 *   POST {action:'save', data:{...}} → lưu 1 record
 */

var SHEET_ID = '1RtVPThy95QMdHGvfL_9lCMNwcgStXCxxqLj1Cpf-KwY';
var TAB_NAME = 'xay_dung';

function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  var action = p.action || 'list';

  if (action === 'list') {
    var rows = readAll();
    return json({ success: true, rows: rows, count: rows.length });
  }
  if (action === 'data') {
    var rows2 = readAll();
    return json({ success: true, data: rows2, count: rows2.length });
  }
  return json({ success: false, error: 'Unknown action: ' + action });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData ? e.postData.contents : '{}');
  } catch(err) {
    return json({ success: false, error: 'JSON parse error: ' + err });
  }

  var action = body.action || 'save';

  if (action === 'save') {
    var data = body.data || {};
    if (!data.ma_ch) return json({ success: false, error: 'Thiếu ma_ch (Mã CH)' });

    var sheet = getOrCreateSheet();
    var headers = getHeaders(sheet);

    // Build row matching headers
    var record = {};
    record['id'] = Utilities.getUuid();
    record['created_at'] = new Date().toISOString();
    record['updated_at'] = record['created_at'];
    for (var k in data) {
      if (data.hasOwnProperty(k)) record[k] = data[k];
    }

    // Ensure all headers exist
    var allKeys = Object.keys(record);
    for (var i = 0; i < allKeys.length; i++) {
      if (headers.indexOf(allKeys[i]) < 0) {
        headers.push(allKeys[i]);
      }
    }
    // Write headers
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Build row
    var row = [];
    for (var c = 0; c < headers.length; c++) {
      var val = record[headers[c]];
      row.push(val !== undefined && val !== null ? val : '');
    }
    sheet.appendRow(row);

    return json({ success: true, message: 'Đã lưu!', id: record['id'] });
  }

  return json({ success: false, error: 'Unknown action: ' + action });
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_NAME);
  }
  return sheet;
}

function getHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return ['id', 'created_at', 'updated_at'];
  var row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = [];
  for (var i = 0; i < row.length; i++) {
    if (row[i] && String(row[i]).trim() !== '') headers.push(String(row[i]).trim());
  }
  if (headers.length === 0) headers = ['id', 'created_at', 'updated_at'];
  return headers;
}

function readAll() {
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var headers = getHeaders(sheet);
  var lastCol = headers.length;
  var range = sheet.getRange(2, 1, lastRow - 1, Math.max(1, lastCol));
  var values = range.getValues();

  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = values[i][c];
    }
    // Skip empty rows
    if (obj['ma_ch'] || obj['id']) rows.push(obj);
  }
  return rows;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
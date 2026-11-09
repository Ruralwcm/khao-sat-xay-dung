// GAS: Khảo sát Vấn đề Xây dựng
// Deploy as Web App → lấy URL → paste vào index.html (GAS_URL)
// Sheet: "Data Web App Rural" hoặc sheet riêng "Khao_sat_XD"

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return handleRequest(data);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false, error: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'getStores') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Storeslist');
    if (!sheet) return json({ok: false, error: 'Sheet Storeslist not found'});
    const data = sheet.getDataRange().getValues();
    const stores = [];
    for (let i = 1; i < data.length; i++) {
      stores.push({ma: String(data[i][0]), ten: String(data[i][1] || '')});
    }
    return json({ok: true, stores});
  }
  return json({ok: true, message: 'Khảo sát Xây dựng API'});
}

function handleRequest(data) {
  const action = data.action;
  if (action === 'saveXayDung') return saveSurvey(data);
  return json({ok: false, error: 'Unknown action: ' + action});
}

function saveSurvey(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Khao_sat_XD');
  if (!sheet) {
    sheet = ss.insertSheet('Khao_sat_XD');
    sheet.appendRow(['Mã CH', 'Tên CH', 'Người báo cáo', 'Ngày báo cáo', 
                      'Vấn đề', 'Diễn giải', 'Thời gian hỏng', 'Thời gian gửi']);
  }

  const ts = new Date().toISOString();
  const issues = data.issues || [];
  
  if (issues.length === 0) {
    // Ghi 1 dòng "không có vấn đề"
    sheet.appendRow([data.ma_ch, data.ten_ch, data.nguoi_bao, data.ngay_bao,
                     'Không có vấn đề', '', '', ts]);
  } else {
    issues.forEach(iss => {
      sheet.appendRow([data.ma_ch, data.ten_ch, data.nguoi_bao, data.ngay_bao,
                       iss.van_de, iss.dien_giai, iss.tg_hong, ts]);
    });
  }

  return json({ok: true, count: Math.max(1, issues.length)});
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ════════════════════════════════════════════════════════════════════
 *  ICF-SL · DMS Chiefdom Logistics — Google Apps Script Webhook
 *  
 *  PURPOSE: Receives POST requests from the DMS Logistics HTML tool
 *           and appends dispatch records to a Google Sheet.
 *
 *  DEPLOYMENT INSTRUCTIONS:
 *  ─────────────────────────────────────────────────────────────────
 *  1. Open Google Sheets → create a new spreadsheet
 *     (or use an existing one — note the Spreadsheet ID from the URL)
 *
 *  2. In the spreadsheet, go to: Extensions → Apps Script
 *
 *  3. Delete all existing code and paste this entire file.
 *
 *  4. Update the SPREADSHEET_ID constant below with your Sheet ID.
 *     (The ID is the long string in the URL between /d/ and /edit)
 *
 *  5. Click "Save" (Ctrl+S / Cmd+S)
 *
 *  6. Click "Deploy" → "New deployment"
 *     - Type: Web app
 *     - Description: ICF-SL DMS Webhook v1
 *     - Execute as: Me (your Google account)
 *     - Who has access: Anyone
 *
 *  7. Click "Deploy" → Authorise the app (you will need to approve
 *     permissions for the script to access Sheets)
 *
 *  8. Copy the "Web app URL" that ends with /exec
 *
 *  9. Paste that URL into the SYNC STATUS tab of the DMS Logistics
 *     tool under "GOOGLE APPS SCRIPT WEBHOOK URL"
 *
 *  10. Click TEST CONNECTION to verify the setup.
 * ════════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ────────────────────────────────────────────────
var SPREADSHEET_ID   = 'YOUR_SPREADSHEET_ID_HERE'; // ← Replace this
var SHEET_NAME       = 'DMS Dispatch Records';       // Sheet tab name
var LOG_SHEET_NAME   = 'Sync Log';                   // Audit log tab

// Column headers (must match the data keys sent from the HTML tool)
var HEADERS = [
  'Timestamp',
  'Dispatch ID',
  'Date',
  'Time',
  'District',
  'Chiefdom',
  'PHU',
  'IG2 ITNs',
  'PBO ITNs',
  'Total ITNs',
  'Driver Name',
  'Driver Username',
  'Driver Phone',
  'Vehicle Plate',
  'DMS Staff Name',
  'DMS Staff Username',
  'DMS Staff District',
  'QR Generated',
  'Received At'
];

// ─── CORS HEADERS (required for direct fetch from browser) ────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };
}

/**
 * Handle OPTIONS preflight requests (CORS).
 * This is called automatically by browsers before a cross-origin POST.
 */
function doOptions(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
  // Note: GAS does not support setting response headers on ContentService output,
  // but most CORS issues with GAS can be resolved by deploying as "Anyone" access.
}

/**
 * Handle GET requests — useful for testing the endpoint is live.
 */
function doGet(e) {
  return buildResponse({ status: 'ok', message: 'ICF-SL DMS Webhook is running', timestamp: new Date().toISOString() });
}

/**
 * Main handler — receives POST from the DMS Logistics HTML tool.
 */
function doPost(e) {
  try {
    // ── 1. Parse incoming JSON ────────────────────────────────────
    var rawBody = e.postData ? e.postData.contents : '{}';
    var data;

    try {
      data = JSON.parse(rawBody);
    } catch (parseErr) {
      return buildError('Invalid JSON payload: ' + parseErr.message);
    }

    // ── 2. Handle test ping ───────────────────────────────────────
    if (data.type === 'TEST') {
      writeToLog('TEST', 'Test connection from DMS tool');
      return buildResponse({ status: 'ok', message: 'Test connection successful — ICF-SL DMS Webhook is live' });
    }

    // ── 3. Validate required fields ───────────────────────────────
    var required = ['dispatchId', 'chiefdom', 'phu', 'driverName', 'vehiclePlate'];
    for (var i = 0; i < required.length; i++) {
      if (!data[required[i]]) {
        return buildError('Missing required field: ' + required[i]);
      }
    }

    // ── 4. Prevent duplicate dispatch IDs ─────────────────────────
    if (isDuplicate(data.dispatchId)) {
      writeToLog(data.dispatchId, 'DUPLICATE — ignored');
      return buildResponse({
        status: 'ok',
        message: 'Duplicate dispatch ID — record already exists',
        duplicate: true
      });
    }

    // ── 5. Append to main sheet ───────────────────────────────────
    var receivedAt = new Date().toLocaleString('en-GB');
    var row = [
      data.timestamp      || '',
      data.dispatchId     || '',
      data.date           || '',
      data.time           || '',
      data.district       || '',
      data.chiefdom       || '',
      data.phu            || '',
      data.ig2            || 0,
      data.pbo            || 0,
      data.total          || 0,
      data.driverName     || '',
      data.driverUsername || '',
      data.driverPhone    || '',
      data.vehiclePlate   || '',
      data.staffName      || '',
      data.staffUsername  || '',
      data.staffDistrict  || '',
      data.qrGenerated    ? 'YES' : 'NO',
      receivedAt
    ];

    appendRow(SHEET_NAME, row);

    // ── 6. Write audit log ────────────────────────────────────────
    writeToLog(data.dispatchId, 'SUCCESS — appended to sheet');

    // ── 7. Return success response ────────────────────────────────
    return buildResponse({
      status:     'ok',
      message:    'Record saved successfully',
      dispatchId: data.dispatchId,
      receivedAt: receivedAt
    });

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    writeToLog('ERROR', err.toString());
    return buildError('Server error: ' + err.toString());
  }
}

// ─── HELPER: append a row to a named sheet, creating it if needed ─
function appendRow(sheetName, rowData) {
  var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    // Write header row
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#0B3B5C').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow(rowData);

  // Auto-resize columns on first few inserts
  if (sheet.getLastRow() <= 10) {
    sheet.autoResizeColumns(1, HEADERS.length);
  }
}

// ─── HELPER: write to audit log sheet ─────────────────────────────
function writeToLog(dispatchId, message) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(LOG_SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET_NAME);
      sheet.appendRow(['Timestamp', 'Dispatch ID', 'Message']);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1C4F70').setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([new Date().toLocaleString('en-GB'), dispatchId, message]);
  } catch (e) {
    Logger.log('Log write error: ' + e.toString());
  }
}

// ─── HELPER: check for duplicate dispatch ID ──────────────────────
function isDuplicate(dispatchId) {
  try {
    var ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return false;

    // Column B (index 2) holds Dispatch ID
    var ids = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === dispatchId) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ─── HELPER: build JSON success response ──────────────────────────
function buildResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── HELPER: build JSON error response ────────────────────────────
function buildError(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

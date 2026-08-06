/**
 * Fires n8n the instant someone types "Approved" in the triage sheet.
 *
 * This is what makes the pipeline event-driven instead of polled. Without it,
 * n8n has to keep asking "anything new?" every few minutes. With it, the sheet
 * tells n8n the moment it happens.
 *
 * SETUP (5 minutes, once):
 *   1. Open the tender spreadsheet
 *   2. Extensions -> Apps Script
 *   3. Delete whatever is there, paste this in
 *   4. Put your n8n Production webhook URL in WEBHOOK_URL below
 *   5. Save (disk icon)
 *   6. Left sidebar -> Triggers (alarm clock icon) -> + Add Trigger
 *        Function:            onApprovalEdit
 *        Event source:        From spreadsheet
 *        Event type:          On edit
 *      -> Save, then approve the Google permission prompt
 *
 * IMPORTANT: it must be an *installable* trigger, added through that Triggers
 * screen. A plain onEdit(e) function will NOT work here, because Google blocks
 * simple triggers from making outbound network calls.
 */

// ---------------------------------------------------------------- settings
var WEBHOOK_URL = 'PASTE_YOUR_N8N_PRODUCTION_WEBHOOK_URL_HERE';

var SHEET_NAME     = 'Claude v3';
var APPROVAL_COL   = 'HumanApproval';
var APPROVED_VALUE = 'approved';

// Only these sources have an automated download path. Others still get a Slack
// nudge from Workflow 2, so nothing is lost by not firing here.
var AUTOMATED_SOURCES = /vendorpanel/i;

// ---------------------------------------------------------------- trigger
function onApprovalEdit(e) {
  try {
    if (!e || !e.range) return;

    var sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAME) return;

    var row = e.range.getRow();
    if (row === 1) return; // header

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var approvalCol = headers.indexOf(APPROVAL_COL) + 1;
    if (approvalCol === 0) {
      Logger.log('Column "' + APPROVAL_COL + '" not found — check the header row.');
      return;
    }

    // Only react to an edit of the approval column itself.
    if (e.range.getColumn() !== approvalCol) return;

    var value = String(e.range.getValue() || '').trim().toLowerCase();
    if (value !== APPROVED_VALUE) return;

    // Read the whole row and index it by header name.
    var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    var get = function (name) {
      var i = headers.indexOf(name);
      return i === -1 ? '' : String(values[i] || '').trim();
    };

    // Already fetched? Don't spend a login re-downloading it.
    if (get('DocumentLink')) {
      Logger.log('Row ' + row + ' already has a DocumentLink — skipping.');
      return;
    }

    var source = get('Source');
    if (!AUTOMATED_SOURCES.test(source)) {
      Logger.log('Row ' + row + ' source "' + source + '" has no auto-download path — skipping.');
      return;
    }

    var payload = {
      rowId:  get('RowID'),
      title:  get('Title'),
      ref:    get('Ref'),
      link:   get('Link'),
      source: source,
      buyer:  get('BuyerOrg'),
      rowNumber: row,
      firedAt: new Date().toISOString()
    };

    if (!/^https?:\/\//i.test(payload.link)) {
      Logger.log('Row ' + row + ' has no usable Link — skipping.');
      return;
    }

    var res = UrlFetchApp.fetch(WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    Logger.log('Sent row ' + row + ' -> HTTP ' + res.getResponseCode());

    // Leave a visible breadcrumb so a human can see it fired.
    sheet.getRange(row, approvalCol)
         .setNote('Sent to n8n ' + new Date().toLocaleString() +
                  ' (HTTP ' + res.getResponseCode() + ')');

  } catch (err) {
    Logger.log('onApprovalEdit failed: ' + err);
  }
}

/**
 * Run this once from the Apps Script editor to check the webhook is reachable
 * before you rely on a real approval. Look for HTTP 200 in the execution log.
 */
function testWebhook() {
  var res = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      rowId: 'TEST-1',
      title: 'Test tender — ignore',
      ref: 'TEST',
      link: 'https://www.vendorpanel.com.au/PublicTenders.aspx',
      source: 'VendorPanel',
      firedAt: new Date().toISOString()
    }),
    muteHttpExceptions: true
  });
  Logger.log('HTTP ' + res.getResponseCode() + ' — ' + res.getContentText().slice(0, 300));
}

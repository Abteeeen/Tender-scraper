// =============================================================================
// Tender fetch robot  —  runs on GitHub Actions (see .github/workflows/fetch-tenders.yml)
//
// Job A (VendorPanel auto-download):
//   Reads the "Claude v3" triage sheet, finds rows that a human marked
//   HumanApproval = Approved but that still have an empty DocumentLink and a
//   VendorPanel source. For each: logs into VendorPanel, opens the tender,
//   downloads the pack, uploads it to a Google Drive folder, and writes the
//   Drive link back into the sheet's DocumentLink column. Your existing
//   Workflow 2 then proceeds automatically.
//
// Job B (QTenders discovery):
//   Renders the QTenders JavaScript site in a real browser, extracts the
//   current opportunities, keyword-filters them, and POSTs them to an n8n
//   Webhook so they flow through your normal normalize -> keyword -> LLM chain.
//
// IMPORTANT: the site-specific selectors below (VendorPanel login + download,
// QTenders list) are best-effort and MUST be confirmed against the live pages.
// Run once, read the Actions logs, then tune the values marked  // TUNE.
// =============================================================================

import { google } from 'googleapis';
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- config from environment / GitHub secrets -------------------------------
const {
  VENDORPANEL_USER,
  VENDORPANEL_PASS,
  GOOGLE_SA_JSON,
  SHEET_ID,
  DRIVE_FOLDER_ID,
  N8N_WEBHOOK_URL,               // optional: only needed for Job B (QTenders)
} = process.env;

const TRIAGE_TAB = process.env.TRIAGE_TAB || 'Claude v3';
const QTENDERS_URL = process.env.QTENDERS_URL
  || 'https://qtenders.hpw.qld.gov.au/qtenders/tender/search/tender-search.do?action=advanced-search';   // TUNE
const KEYWORDS = ['security', 'cleaning', 'guard', 'patrol', 'janitor', 'facilit', 'concierge', 'cctv'];

const must = (v, name) => { if (!v) { console.error(`Missing required env: ${name}`); process.exit(1); } return v; };
must(GOOGLE_SA_JSON, 'GOOGLE_SA_JSON');
must(SHEET_ID, 'SHEET_ID');

// ---- Google auth (Sheets + Drive) -------------------------------------------
const creds = JSON.parse(GOOGLE_SA_JSON);
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

// ---- small helpers ----------------------------------------------------------
const colLetter = (i) => {           // 0 -> A, 25 -> Z, 26 -> AA ...
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

async function readTriageRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TRIAGE_TAB}`,
  });
  const values = res.data.values || [];
  if (!values.length) return { header: [], rows: [] };
  const header = values[0];
  const idx = (name) => header.findIndex((h) => (h || '').toString().trim().toLowerCase() === name.toLowerCase());
  const col = {
    RowID: idx('RowID'),
    Title: idx('Title'),
    Source: idx('Source'),
    Link: idx('Link'),
    HumanApproval: idx('HumanApproval'),
    DocumentLink: idx('DocumentLink'),
  };
  const rows = values.slice(1).map((r, i) => ({
    rowNumber: i + 2,                 // 1-based, +1 for header
    RowID: r[col.RowID] || '',
    Title: r[col.Title] || '',
    Source: r[col.Source] || '',
    Link: r[col.Link] || '',
    HumanApproval: (r[col.HumanApproval] || '').toString().trim(),
    DocumentLink: (r[col.DocumentLink] || '').toString().trim(),
  }));
  return { header, col, rows };
}

async function writeDocumentLink(col, rowNumber, url) {
  const a1 = `${TRIAGE_TAB}!${colLetter(col.DocumentLink)}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: a1,
    valueInputOption: 'RAW',
    requestBody: { values: [[url]] },
  });
  console.log(`  ✎ wrote DocumentLink to ${a1}`);
}

async function uploadToDrive(filePath, name) {
  const res = await drive.files.create({
    requestBody: { name, parents: DRIVE_FOLDER_ID ? [DRIVE_FOLDER_ID] : undefined },
    media: { body: fs.createReadStream(filePath) },
    fields: 'id, webViewLink',
  });
  const id = res.data.id;
  // Make it readable by your Workflow 2 Drive credential. If your DRIVE_FOLDER_ID
  // already lives in the same Google account as the "U Agent" Drive credential,
  // you can DELETE this permission block — the account already has access.
  try {
    await drive.permissions.create({ fileId: id, requestBody: { role: 'reader', type: 'anyone' } });
  } catch (e) { console.warn('  (permission set skipped:', e.message, ')'); }
  return `https://drive.google.com/file/d/${id}/view`;
}

// ---- Job A: VendorPanel auto-download ---------------------------------------
async function vendorPanelLogin(page) {
  if (!VENDORPANEL_USER || !VENDORPANEL_PASS) {
    console.log('VendorPanel creds not set — skipping login (public pages only).');
    return false;
  }
  console.log('Logging into VendorPanel…');
  await page.goto('https://www.vendorpanel.com.au/Login.aspx', { waitUntil: 'domcontentloaded' });  // TUNE url
  // TUNE these selectors to the real login form field names:
  await page.fill('input[type="email"], #Email, input[name*="Email"]', VENDORPANEL_USER).catch(() => {});
  await page.fill('input[type="password"], #Password, input[name*="Password"]', VENDORPANEL_PASS).catch(() => {});
  await Promise.all([
    page.waitForLoadState('networkidle').catch(() => {}),
    page.click('button[type="submit"], input[type="submit"], #LoginButton').catch(() => {}),
  ]);
  const loggedIn = !/login/i.test(page.url());
  console.log(loggedIn ? '  ✓ logged in' : '  ⚠ login may have failed (check selectors / MFA)');
  return loggedIn;
}

async function downloadVendorPanelPack(context, link) {
  const page = await context.newPage();
  try {
    await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Best-effort: click "Register Interest" if present, then a download control.
    // TUNE the text/selectors to what VendorPanel actually shows.
    for (const label of ['Register Interest', 'Register interest', 'Access tender', 'Download all', 'Download']) {
      const el = page.locator(`text=${label}`).first();
      if (await el.count()) { await el.click().catch(() => {}); await page.waitForTimeout(1500); }
    }

    // Capture the file from a download event triggered by a download link/button.
    const dlPromise = context.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    const dlBtn = page.locator('a[href$=".zip"], a[href*="download"], button:has-text("Download")').first();  // TUNE
    if (await dlBtn.count()) await dlBtn.click().catch(() => {});
    const download = await dlPromise;
    if (!download) { console.log('  ⚠ no download captured for', link); return null; }

    const suggested = download.suggestedFilename() || `pack-${Date.now()}.zip`;
    const tmp = path.join(os.tmpdir(), `${Date.now()}-${suggested}`);
    await download.saveAs(tmp);
    console.log('  ↓ downloaded', suggested);
    return { tmp, name: suggested };
  } finally {
    await page.close().catch(() => {});
  }
}

async function jobVendorPanel(context) {
  const { col, rows } = await readTriageRows();
  const targets = rows.filter(r =>
    r.HumanApproval.toLowerCase() === 'approved' &&
    !r.DocumentLink &&
    /vendorpanel/i.test(r.Source) &&
    /^https?:/i.test(r.Link)
  );
  console.log(`Job A (VendorPanel): ${targets.length} approved row(s) awaiting a document.`);
  if (!targets.length) return;

  const page = await context.newPage();
  await vendorPanelLogin(page);
  await page.close().catch(() => {});

  for (const r of targets) {
    console.log(`• ${r.Title}`);
    try {
      const file = await downloadVendorPanelPack(context, r.Link);
      if (!file) continue;                       // Slack "document needed" fallback will fire in n8n
      const url = await uploadToDrive(file.tmp, `${r.RowID || r.Title}`.slice(0, 120).replace(/[\\/:*?"<>|]/g, '_') + '_' + file.name);
      await writeDocumentLink(col, r.rowNumber, url);
      fs.unlink(file.tmp, () => {});
    } catch (e) {
      console.error('  ✗ error:', e.message);
    }
  }
}

// ---- Job B: QTenders discovery ----------------------------------------------
async function jobQTenders(context) {
  if (!N8N_WEBHOOK_URL) { console.log('Job B (QTenders): N8N_WEBHOOK_URL not set — skipping.'); return; }
  console.log('Job B (QTenders): rendering', QTENDERS_URL);
  const page = await context.newPage();
  try {
    await page.goto(QTENDERS_URL, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(4000);             // let the SPA finish

    // Generic extraction: every anchor that looks like a tender + its row text.
    // TUNE the selector once you see the live DOM (e.g. 'table tbody tr', '.tender-row').
    const items = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll('a'));
      for (const a of anchors) {
        const title = (a.textContent || '').replace(/\s+/g, ' ').trim();
        if (title.length < 15) continue;
        const href = a.href || '';
        if (!/^https?:/i.test(href)) continue;
        const row = a.closest('tr, li, .row, article');
        const text = ((row ? row.textContent : title) || '').replace(/\s+/g, ' ').trim();
        out.push({ title, href, text });
      }
      return out;
    });

    const seen = new Set();
    const normalized = items
      .filter(it => {
        const blob = (it.title + ' ' + it.text).toLowerCase();
        return KEYWORDS.some(k => blob.includes(k));
      })
      .filter(it => (seen.has(it.href) ? false : (seen.add(it.href), true)))
      .map(it => ({
        title: it.title,
        link: it.href,
        guid: 'QT:' + it.href,
        posted_raw: '',
        source: 'QTenders',
        text: it.text.slice(0, 4000),
        search_blob: (it.title + ' ' + it.text).toLowerCase(),
      }));

    console.log(`  found ${normalized.length} keyword-matching QTenders item(s).`);
    if (!normalized.length) return;

    const resp = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
    });
    console.log('  → posted to n8n webhook, status', resp.status);
  } catch (e) {
    console.error('  ✗ QTenders error:', e.message);
  } finally {
    await page.close().catch(() => {});
  }
}

// ---- main -------------------------------------------------------------------
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  });
  try {
    await jobVendorPanel(context);
    await jobQTenders(context);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  console.log('Done.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

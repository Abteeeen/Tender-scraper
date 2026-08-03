// =============================================================================
// Tender Radar — VendorPanel document robot (Apify actor)
//
// Removes the one manual step left in the pipeline. You still approve tenders
// by hand in the sheet; this fetches the documents for you.
//
//   1. Read the "Claude v3" triage sheet
//   2. Find rows where HumanApproval = Approved and DocumentLink is empty
//   3. Log into VendorPanel, open each tender, register interest, download the pack
//   4. Upload the pack to Google Drive
//   5. Write the Drive link back into DocumentLink
//   → Workflow 2 picks it up on its next 5-minute poll and runs deep analysis.
//
// Anything it cannot fetch (captcha, MFA, no download button) is left alone, so
// the existing Slack "document needed" message still reaches a human. Nothing is
// silently lost.
//
// The selectors marked TUNE are best-effort. Run once, read the log, adjust.
// =============================================================================

import { Actor } from 'apify';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

await Actor.init();

const input = (await Actor.getInput()) || {};
const cfg = {
  vendorPanelUser: input.vendorPanelUser || process.env.VENDORPANEL_USER,
  vendorPanelPass: input.vendorPanelPass || process.env.VENDORPANEL_PASS,
  googleServiceAccount: input.googleServiceAccount || process.env.GOOGLE_SA_JSON,
  sheetId: input.sheetId || process.env.SHEET_ID,
  triageTab: input.triageTab || 'Claude v3',
  driveFolderId: input.driveFolderId || process.env.DRIVE_FOLDER_ID,
  maxTenders: input.maxTenders || 10,
  dryRun: input.dryRun === true,
};

const fail = (msg) => { log(`FATAL: ${msg}`); throw new Error(msg); };
function log(...a) { console.log(...a); }

if (!cfg.googleServiceAccount) fail('googleServiceAccount is required');
if (!cfg.sheetId) fail('sheetId is required');

// ---------------------------------------------------------------- Google auth
const creds = typeof cfg.googleServiceAccount === 'string'
  ? JSON.parse(cfg.googleServiceAccount)
  : cfg.googleServiceAccount;

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

const colLetter = (i) => {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

// ------------------------------------------------------------- read the sheet
async function readApprovedAwaitingDocs() {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: cfg.sheetId, range: cfg.triageTab });
  const values = res.data.values || [];
  if (values.length < 2) return { col: null, rows: [] };

  const header = values[0].map((h) => (h || '').toString().trim().toLowerCase());
  const idx = (n) => header.indexOf(n.toLowerCase());
  const col = {
    RowID: idx('RowID'), Title: idx('Title'), Source: idx('Source'), Link: idx('Link'),
    HumanApproval: idx('HumanApproval'), DocumentLink: idx('DocumentLink'),
  };
  for (const [k, v] of Object.entries(col)) {
    if (v === -1) fail(`Column "${k}" not found in the "${cfg.triageTab}" tab`);
  }

  const rows = values.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    RowID: r[col.RowID] || '',
    Title: r[col.Title] || '',
    Source: r[col.Source] || '',
    Link: r[col.Link] || '',
    HumanApproval: (r[col.HumanApproval] || '').toString().trim(),
    DocumentLink: (r[col.DocumentLink] || '').toString().trim(),
  })).filter((r) =>
    r.HumanApproval.toLowerCase() === 'approved' &&
    !r.DocumentLink &&
    /vendorpanel/i.test(r.Source) &&
    /^https?:/i.test(r.Link)
  );

  return { col, rows };
}

async function writeDocumentLink(col, rowNumber, url) {
  if (cfg.dryRun) { log(`  [dry run] would write ${url} to row ${rowNumber}`); return; }
  const a1 = `${cfg.triageTab}!${colLetter(col.DocumentLink)}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.sheetId, range: a1,
    valueInputOption: 'RAW', requestBody: { values: [[url]] },
  });
  log(`  wrote DocumentLink → ${a1}`);
}

async function uploadToDrive(filePath, name) {
  if (cfg.dryRun) { log(`  [dry run] would upload ${name}`); return 'https://drive.google.com/file/d/DRYRUN/view'; }
  const res = await drive.files.create({
    requestBody: { name, parents: cfg.driveFolderId ? [cfg.driveFolderId] : undefined },
    media: { body: fs.createReadStream(filePath) },
    fields: 'id, webViewLink',
  });
  return `https://drive.google.com/file/d/${res.data.id}/view`;
}

// ------------------------------------------------------------- VendorPanel
async function login(context) {
  if (!cfg.vendorPanelUser || !cfg.vendorPanelPass) {
    log('No VendorPanel credentials supplied — cannot fetch documents.');
    return false;
  }
  const page = await context.newPage();
  try {
    log('Logging into VendorPanel…');
    await page.goto('https://www.vendorpanel.com.au/Login.aspx', { waitUntil: 'domcontentloaded', timeout: 45000 }); // TUNE

    // TUNE: confirm the real field selectors from the live login form.
    const userSel = 'input[type="email"], #Email, input[name*="Email"], input[name*="User"]';
    const passSel = 'input[type="password"], #Password, input[name*="Password"]';
    await page.fill(userSel, cfg.vendorPanelUser);
    await page.fill(passSel, cfg.vendorPanelPass);
    await page.click('button[type="submit"], input[type="submit"], #LoginButton').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const ok = !/login/i.test(page.url());
    log(ok ? '  logged in' : '  login did not complete — check selectors, or MFA/captcha is blocking');
    if (!ok) await Actor.setValue('login-failure.png', await page.screenshot(), { contentType: 'image/png' });
    return ok;
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchPack(context, row) {
  const page = await context.newPage();
  try {
    await page.goto(row.Link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Register interest first where the button exists — documents are usually
    // gated behind it. TUNE the labels against the live page.
    for (const label of ['Register Interest', 'Register interest', 'Access Tender', 'Accept', 'Continue']) {
      const el = page.getByRole('button', { name: label }).or(page.locator(`a:has-text("${label}")`)).first();
      if (await el.count().catch(() => 0)) {
        await el.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    }

    const dlPromise = context.waitForEvent('download', { timeout: 25000 }).catch(() => null);
    const btn = page.locator('a[href$=".zip"], a[href*="DownloadAll"], a[href*="download"], button:has-text("Download")').first(); // TUNE
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 10000 }).catch(() => {});
    } else {
      log('  no download control found on the page');
    }

    const download = await dlPromise;
    if (!download) {
      await Actor.setValue(`no-download-${Date.now()}.png`, await page.screenshot(), { contentType: 'image/png' });
      return null;
    }

    const suggested = download.suggestedFilename() || `tender-pack-${Date.now()}.zip`;
    const tmp = path.join(os.tmpdir(), `${Date.now()}-${suggested}`);
    await download.saveAs(tmp);
    log(`  downloaded ${suggested}`);
    return { tmp, name: suggested };
  } finally {
    await page.close().catch(() => {});
  }
}

// ------------------------------------------------------------------- main
const { col, rows } = await readApprovedAwaitingDocs();
log(`${rows.length} approved tender(s) awaiting a document.`);

const results = [];
if (rows.length) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  });

  try {
    const loggedIn = await login(context);
    for (const row of rows.slice(0, cfg.maxTenders)) {
      log(`• ${row.Title}`);
      const outcome = { rowId: row.RowID, title: row.Title, link: row.Link, status: 'skipped', driveUrl: '' };
      try {
        if (!loggedIn) {
          outcome.status = 'not-logged-in';
        } else {
          const file = await fetchPack(context, row);
          if (!file) {
            outcome.status = 'no-document';   // Slack fallback in n8n handles it
          } else {
            const safe = `${row.RowID || row.Title}`.slice(0, 100).replace(/[\\/:*?"<>|]/g, '_');
            outcome.driveUrl = await uploadToDrive(file.tmp, `${safe}_${file.name}`);
            await writeDocumentLink(col, row.rowNumber, outcome.driveUrl);
            outcome.status = 'ok';
            fs.unlink(file.tmp, () => {});
          }
        }
      } catch (e) {
        outcome.status = 'error';
        outcome.error = e.message;
        log(`  error: ${e.message}`);
      }
      results.push(outcome);
      await Actor.pushData(outcome);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const ok = results.filter((r) => r.status === 'ok').length;
log(`Done. ${ok}/${results.length} document(s) retrieved.`);
await Actor.setValue('SUMMARY', { checked: rows.length, retrieved: ok, results });
await Actor.exit();

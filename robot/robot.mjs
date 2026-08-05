// =============================================================================
// VendorPanel tender-pack robot  —  runs on YOUR computer, no server needed
//
// What it does, every run:
//   1. Reads the "Claude v3" sheet
//   2. Finds rows where HumanApproval = Approved and DocumentLink is empty
//   3. Logs into VendorPanel (2-step: email -> Next -> password -> Next)
//   4. Opens each tender, clicks the download icon, saves the pack
//   5. Uploads it to Google Drive
//   6. Writes the Drive link back into DocumentLink
//   -> n8n Workflow 2 sees it on the next 5-minute poll and runs deep analysis.
//
// FIRST RUN:  set HEADLESS=false in .env and watch it drive the browser.
//             It saves screenshots to ./debug on anything unexpected.
//
// The login session is cached in ./session.json, so later runs skip the login
// entirely until it expires.
// =============================================================================

import { chromium } from 'playwright';
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const CFG = {
  user: process.env.VP_USER,
  pass: process.env.VP_PASS,
  sheetId: process.env.SHEET_ID,
  tab: process.env.TRIAGE_TAB || 'Claude v3',
  driveFolder: process.env.DRIVE_FOLDER_ID,
  saJson: process.env.GOOGLE_SA_JSON_PATH || './service-account.json',
  headless: process.env.HEADLESS !== 'false',
  max: Number(process.env.MAX_PER_RUN || 5),
  dryRun: process.env.DRY_RUN === 'true',
};

const DEBUG_DIR = './debug';
const SESSION = './session.json';
const DOWNLOADS = './downloads';
for (const d of [DEBUG_DIR, DOWNLOADS]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

const log = (...a) => console.log(new Date().toLocaleTimeString('en-AU'), ...a);
const die = (m) => { console.error('\n❌ ' + m); process.exit(1); };

if (!CFG.user || !CFG.pass) die('VP_USER / VP_PASS missing — check your .env file');
if (!CFG.sheetId) die('SHEET_ID missing — check your .env file');
if (!fs.existsSync(CFG.saJson)) die(`Service-account file not found at ${CFG.saJson}`);

// ---------------------------------------------------------------- Google APIs
const auth = new google.auth.GoogleAuth({
  keyFile: CFG.saJson,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
});
const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

const colLetter = (i) => {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

async function findApprovedRows() {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: CFG.sheetId, range: CFG.tab });
  const rows = res.data.values || [];
  if (rows.length < 2) return { col: null, jobs: [] };

  const head = rows[0].map((h) => (h || '').toString().trim().toLowerCase());
  const col = {};
  for (const name of ['RowID', 'Title', 'Source', 'Link', 'Ref', 'HumanApproval', 'DocumentLink']) {
    col[name] = head.indexOf(name.toLowerCase());
  }
  for (const req of ['HumanApproval', 'DocumentLink', 'Link', 'Title']) {
    if (col[req] === -1) die(`Column "${req}" not found in the "${CFG.tab}" tab`);
  }

  const jobs = rows.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    rowId: r[col.RowID] || '',
    title: r[col.Title] || '',
    source: r[col.Source] || '',
    link: r[col.Link] || '',
    ref: col.Ref > -1 ? (r[col.Ref] || '') : '',
    approval: (r[col.HumanApproval] || '').trim(),
    docLink: (r[col.DocumentLink] || '').trim(),
  })).filter((j) =>
    j.approval.toLowerCase() === 'approved' &&
    !j.docLink &&
    /vendorpanel/i.test(j.source) &&
    /^https?:/i.test(j.link)
  );

  return { col, jobs };
}

async function writeDocumentLink(col, rowNumber, url) {
  if (CFG.dryRun) { log(`   [dry run] would write ${url} to row ${rowNumber}`); return; }
  const a1 = `${CFG.tab}!${colLetter(col.DocumentLink)}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: CFG.sheetId, range: a1,
    valueInputOption: 'RAW', requestBody: { values: [[url]] },
  });
  log(`   ✎ wrote DocumentLink to ${a1}`);
}

async function uploadToDrive(filePath, name) {
  if (CFG.dryRun) { log(`   [dry run] would upload ${name}`); return 'https://drive.google.com/DRYRUN'; }
  const res = await drive.files.create({
    requestBody: { name, parents: CFG.driveFolder ? [CFG.driveFolder] : undefined },
    media: { body: fs.createReadStream(filePath) },
    fields: 'id, webViewLink',
  });
  log(`   ☁ uploaded to Drive (${res.data.id})`);
  return `https://drive.google.com/file/d/${res.data.id}/view`;
}

// ---------------------------------------------------------------- VendorPanel
const shot = async (page, name) => {
  const f = path.join(DEBUG_DIR, `${Date.now()}-${name}.png`);
  await page.screenshot({ path: f, fullPage: true }).catch(() => {});
  log(`   📷 screenshot: ${f}`);
};

async function login(page) {
  log('Logging into VendorPanel…');
  await page.goto('https://www.vendorpanel.com.au/Login.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // ---- step 1: email, then Next ----
  const email = page.locator('#UserName, input[name="UserName"]').first();
  await email.waitFor({ state: 'visible', timeout: 20000 });
  await email.fill(CFG.user);
  log('   ✓ email entered');

  await page.getByRole('button', { name: /^next$/i })
    .or(page.locator('input[type="submit"][value="Next" i], button:has-text("Next")')).first()
    .click();
  log('   → clicked Next');

  // ---- step 2: password, then Next ----
  const pw = page.locator('input[type="password"]').first();
  await pw.waitFor({ state: 'visible', timeout: 20000 });
  await pw.fill(CFG.pass);
  log('   ✓ password entered');

  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {}),
    page.getByRole('button', { name: /^next$/i })
      .or(page.locator('input[type="submit"][value="Next" i], button:has-text("Next")')).first()
      .click(),
  ]);

  await page.waitForTimeout(3000);
  const url = page.url();
  const ok = !/login/i.test(url);
  if (!ok) {
    await shot(page, 'login-failed');
    // surface any validation message on the page
    const msg = await page.locator('.validation-summary-errors, .field-validation-error, .alert')
      .first().textContent().catch(() => null);
    if (msg) log(`   ⚠ page says: ${msg.trim()}`);
  }
  log(ok ? '   ✅ logged in' : '   ❌ login did not complete');
  return ok;
}

async function downloadPack(context, job) {
  const page = await context.newPage();
  try {
    log(`   opening tender page…`);
    await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});

    // Some tenders gate documents behind an interest/accept step.
    for (const label of ['Register Interest', 'Register interest', 'Accept', 'I Accept', 'Continue', 'Follow']) {
      const btn = page.getByRole('button', { name: new RegExp('^' + label + '$', 'i') })
        .or(page.locator(`a:has-text("${label}")`)).first();
      if (await btn.count().catch(() => 0)) {
        await btn.click({ timeout: 8000 }).catch(() => {});
        log(`   → clicked "${label}"`);
        await page.waitForTimeout(2500);
      }
    }

    // The download control is an icon on the tender card. Try the most likely
    // shapes, widest net last. Log which one matched so this can be tightened.
    const candidates = [
      { why: 'title/aria contains download', loc: page.locator('[title*="ownload" i], [aria-label*="ownload" i]') },
      { why: 'anchor to a zip/pdf',          loc: page.locator('a[href$=".zip"], a[href$=".pdf"], a[href*="ownload" i]') },
      { why: 'download icon class',          loc: page.locator('i[class*="download" i], span[class*="download" i], img[src*="download" i]') },
      { why: 'button labelled download',     loc: page.getByRole('button', { name: /download/i }) },
    ];

    const dl = context.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    let clicked = false;
    for (const c of candidates) {
      const n = await c.loc.count().catch(() => 0);
      if (n > 0) {
        log(`   → found ${n} match(es): ${c.why} — clicking first`);
        await c.loc.first().click({ timeout: 10000 }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log('   ⚠ no download control found');
      await shot(page, 'no-download-control');
      return null;
    }

    const download = await dl;
    if (!download) {
      log('   ⚠ clicked, but no file came back');
      await shot(page, 'no-file-after-click');
      return null;
    }

    const suggested = download.suggestedFilename() || `pack-${Date.now()}.zip`;
    const safe = `${job.ref || job.rowId || job.title}`.slice(0, 80).replace(/[\\/:*?"<>|]/g, '_');
    const dest = path.join(DOWNLOADS, `${safe}_${suggested}`);
    await download.saveAs(dest);
    log(`   ⬇ downloaded ${suggested}`);
    return { dest, name: `${safe}_${suggested}` };
  } finally {
    await page.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------- main
(async () => {
  const { col, jobs } = await findApprovedRows();
  log(`${jobs.length} approved tender(s) waiting for documents.`);
  if (!jobs.length) { log('Nothing to do.'); return; }

  const browser = await chromium.launch({ headless: CFG.headless, slowMo: CFG.headless ? 0 : 300 });
  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: fs.existsSync(SESSION) ? SESSION : undefined,
    viewport: { width: 1400, height: 900 },
  });

  try {
    // reuse a cached session where possible
    const probe = await context.newPage();
    await probe.goto('https://www.vendorpanel.com.au/PublicTenders.aspx', { waitUntil: 'domcontentloaded' }).catch(() => {});
    const needLogin = /login/i.test(probe.url());
    await probe.close().catch(() => {});

    if (needLogin) {
      const page = await context.newPage();
      const ok = await login(page);
      await page.close().catch(() => {});
      if (!ok) { log('Stopping — could not log in. Check ./debug for a screenshot.'); return; }
      await context.storageState({ path: SESSION });
      log('   session saved to session.json');
    } else {
      log('Reusing saved session (no login needed).');
    }

    let done = 0;
    for (const job of jobs.slice(0, CFG.max)) {
      log(`\n• ${job.title.slice(0, 70)}`);
      try {
        const file = await downloadPack(context, job);
        if (!file) { log('   → left for a human; Slack fallback still applies'); continue; }
        const url = await uploadToDrive(file.dest, file.name);
        await writeDocumentLink(col, job.rowNumber, url);
        done++;
      } catch (e) {
        log(`   ✗ ${e.message}`);
      }
    }
    log(`\nFinished. ${done}/${Math.min(jobs.length, CFG.max)} pack(s) retrieved.`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

import fs from 'node:fs';

const SHEET_ID = '1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY';
const TAB = 'Claude v3';

let X = 0;
const at = (row = 0) => [260 + X++ * 240, 300 + row * 190];

const cred = (type, name) => ({ [type]: { id: 'REPLACE_ME', name } });

const nodes = [];
const conn = {};
const link = (from, to, out = 0) => {
  conn[from] = conn[from] || { main: [] };
  while (conn[from].main.length <= out) conn[from].main.push([]);
  conn[from].main[out].push({ node: to, type: 'main', index: 0 });
};

// ───────────────────────────────────────────────────────── 1. trigger
nodes.push({
  parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } },
  id: 'wf4-trigger', name: 'Poll Every 10 Min',
  type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: at(),
});

// ───────────────────────────────────────────────────────── 2. read sheet
nodes.push({
  parameters: {
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: TAB, mode: 'name' },
    options: {},
  },
  id: 'wf4-read', name: 'Read Triage Sheet',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: at(),
  credentials: cred('googleSheetsOAuth2Api', 'Google Sheets account'),
});

// ───────────────────────────────────────────────────────── 3. select jobs
nodes.push({
  parameters: {
    jsCode: `// Rows a human approved, that are VendorPanel, that still have no document.
// This is the "approval signal" the whole workflow waits on.
const out = [];

for (const item of $input.all()) {
  const r = item.json;

  const approval = String(r.HumanApproval || '').trim().toLowerCase();
  const docLink  = String(r.DocumentLink  || '').trim();
  const source   = String(r.Source || '');
  const link     = String(r.Link   || '').trim();

  if (approval !== 'approved') continue;   // not approved yet
  if (docLink) continue;                    // already fetched
  if (!/vendorpanel/i.test(source)) continue;
  if (!/^https?:\\/\\//i.test(link)) continue;

  out.push({
    json: {
      rowId:   r.RowID || '',
      title:   r.Title || '',
      ref:     r.Ref || '',
      link,
      source,
      buyer:   r.BuyerOrg || '',
      deadline: r.Deadline || '',
    },
  });
}

return out;`,
  },
  id: 'wf4-select', name: 'Approved, Awaiting Document',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 4. puppeteer
const PUPPET = `// ---------------------------------------------------------------------------
// Logs into VendorPanel and finds the tender pack's real download URL.
//
// We deliberately do NOT download the file inside Puppeteer — browser downloads
// are awkward to hand back to n8n. Instead we return the URL plus the session
// cookies, and let n8n's HTTP Request node fetch the bytes. That is far more
// reliable and keeps the binary in n8n's normal item pipeline.
// ---------------------------------------------------------------------------

const USER = $env.VP_USER;
const PASS = $env.VP_PASS;
if (!USER || !PASS) throw new Error('Set VP_USER and VP_PASS as n8n environment variables');

const job = $json;

await $page.setViewport({ width: 1400, height: 900 });
await $page.setUserAgent(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
);

// ---- log in (2 steps: email -> Next -> password -> Next) -------------------
await $page.goto('https://www.vendorpanel.com.au/Login.aspx', { waitUntil: 'domcontentloaded', timeout: 60000 });

const clickNext = async () => {
  const btn = await $page.$('input[type="submit"], button[type="submit"]');
  if (btn) { await btn.click(); return true; }
  // fall back to matching by visible text
  const byText = await $page.evaluateHandle(() => {
    const els = [...document.querySelectorAll('button, input[type=submit], a')];
    return els.find((e) => /^\\s*next\\s*$/i.test(e.innerText || e.value || '')) || null;
  });
  const el = byText.asElement();
  if (el) { await el.click(); return true; }
  return false;
};

await $page.waitForSelector('#UserName, input[name="UserName"], input[type="email"]', { timeout: 20000 });
await $page.type('#UserName, input[name="UserName"], input[type="email"]', USER, { delay: 30 });
await clickNext();

await $page.waitForSelector('input[type="password"]', { timeout: 20000 });
await $page.type('input[type="password"]', PASS, { delay: 30 });
await Promise.all([
  $page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => null),
  clickNext(),
]);

if (/login/i.test($page.url())) {
  return [{ json: { ...job, ok: false, reason: 'login failed — check VP_USER / VP_PASS', pageUrl: $page.url() } }];
}

// ---- open the tender and locate the download control -----------------------
await $page.goto(job.link, { waitUntil: 'networkidle2', timeout: 60000 });

const found = await $page.evaluate(() => {
  const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };

  // 1. a plain anchor pointing at a file or a download handler
  const anchors = [...document.querySelectorAll('a[href]')];
  const fileLink = anchors.find((a) =>
    /\\.(zip|pdf|docx?|xlsx?)($|\\?)/i.test(a.href) || /download/i.test(a.getAttribute('href') || '')
  );
  if (fileLink) return { url: abs(fileLink.href), how: 'anchor href' };

  // 2. an element whose tooltip/label says download, wrapped in or holding a link
  const labelled = [...document.querySelectorAll('[title],[aria-label]')]
    .find((e) => /download/i.test((e.getAttribute('title') || '') + (e.getAttribute('aria-label') || '')));
  if (labelled) {
    const a = labelled.closest('a[href]') || labelled.querySelector('a[href]');
    if (a) return { url: abs(a.href), how: 'labelled anchor' };
    return { url: null, how: 'labelled element (no href — needs a click)', selectorHint: labelled.outerHTML.slice(0, 300) };
  }

  return { url: null, how: 'nothing matched' };
});

// ---- hand the session cookies to the HTTP node -----------------------------
const cookies = await $page.cookies();
const cookieHeader = cookies.map((c) => \`\${c.name}=\${c.value}\`).join('; ');

return [{
  json: {
    ...job,
    ok: Boolean(found.url),
    downloadUrl: found.url,
    how: found.how,
    selectorHint: found.selectorHint || '',
    cookieHeader,
    pageUrl: $page.url(),
  },
}];`;

nodes.push({
  parameters: {
    operation: 'runCustomScript',
    scriptCode: PUPPET,
    options: { headless: true, launchArguments: { args: [{ arg: '--no-sandbox' }, { arg: '--disable-dev-shm-usage' }] } },
  },
  id: 'wf4-puppeteer', name: 'VendorPanel Login + Find Pack',
  type: 'n8n-nodes-puppeteer.puppeteer', typeVersion: 1, position: at(),
  onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── 5. gate
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      conditions: [{
        id: 'has-url',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
        leftValue: '={{ $json.ok }}', rightValue: '',
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'wf4-gate', name: 'Download URL Found?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(),
});

// ───────────────────────────────────────────────────────── 6. fetch binary
nodes.push({
  parameters: {
    url: '={{ $json.downloadUrl }}',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
        { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      ],
    },
    options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } }, timeout: 120000 },
  },
  id: 'wf4-fetch', name: 'Download Tender Pack',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── 7. name it
nodes.push({
  parameters: {
    jsCode: `// Give the file a name a human can recognise in Drive.
const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const base = (j.ref || j.rowId || j.title || 'tender')
    .toString().slice(0, 70).replace(/[\\\\/:*?"<>|]/g, '_').trim();

  // work out the extension from what actually came back
  const mime = item.binary?.data?.mimeType || '';
  let ext = item.binary?.data?.fileExtension || '';
  if (!ext) ext = /zip/i.test(mime) ? 'zip' : /pdf/i.test(mime) ? 'pdf' : 'bin';

  out.push({ json: { ...j, fileName: base + '_pack.' + ext }, binary: item.binary });
}
return out;`,
  },
  id: 'wf4-name', name: 'Name the File',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 8. drive
nodes.push({
  parameters: {
    name: '={{ $json.fileName }}',
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: 'root', mode: 'list', cachedResultName: '/ (Change me to your Tender Packs folder)' },
    options: {},
  },
  id: 'wf4-drive', name: 'Upload to Drive',
  type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: at(),
  credentials: cred('googleDriveOAuth2Api', 'Google Drive account'),
});

// ───────────────────────────────────────────────────────── 9. build link
nodes.push({
  parameters: {
    jsCode: `// The Drive node returns the new file's id; turn it into a link the
// sheet (and Workflow 2) can use.
const out = [];
for (let i = 0; i < $input.all().length; i++) {
  const uploaded = $input.all()[i].json;
  const job = $('Name the File').all()[i].json;
  const id = uploaded.id || uploaded.fileId;
  out.push({
    json: {
      RowID: job.rowId,
      DocumentLink: id ? \`https://drive.google.com/file/d/\${id}/view\` : (uploaded.webViewLink || ''),
      title: job.title,
      fileName: job.fileName,
    },
  });
}
return out;`,
  },
  id: 'wf4-link', name: 'Build Drive Link',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 10. write back
nodes.push({
  parameters: {
    operation: 'appendOrUpdate',
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: TAB, mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: { RowID: '={{ $json.RowID }}', DocumentLink: '={{ $json.DocumentLink }}' },
      matchingColumns: ['RowID'],
    },
    options: {},
  },
  id: 'wf4-write', name: 'Write DocumentLink',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: at(),
  credentials: cred('googleSheetsOAuth2Api', 'Google Sheets account'),
});

// ───────────────────────────────────────────────────────── 11. slack ok
nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=📦 *Tender pack retrieved*\n\n*{{ $json.title }}*\n{{ $json.DocumentLink }}\n\n_Workflow 2 will run the deep analysis within 5 minutes._',
    otherOptions: {},
  },
  id: 'wf4-slack-ok', name: 'Slack - Pack Ready',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: at(1),
  credentials: cred('slackApi', 'Slack account'),
  onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── 12. slack fail
nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=⚠️ *Could not auto-download this pack*\n\n*{{ $json.title }}*\n{{ $json.link }}\n\nReason: {{ $json.reason || $json.how }}\n\n_Download it by hand and paste the Drive link into DocumentLink._',
    otherOptions: {},
  },
  id: 'wf4-slack-fail', name: 'Slack - Manual Download Needed',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [260 + 5 * 240, 300 + 2 * 190],
  credentials: cred('slackApi', 'Slack account'),
  onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── wiring
link('Poll Every 10 Min', 'Read Triage Sheet');
link('Read Triage Sheet', 'Approved, Awaiting Document');
link('Approved, Awaiting Document', 'VendorPanel Login + Find Pack');
link('VendorPanel Login + Find Pack', 'Download URL Found?');
link('Download URL Found?', 'Download Tender Pack', 0);
link('Download URL Found?', 'Slack - Manual Download Needed', 1);
link('Download Tender Pack', 'Name the File');
link('Name the File', 'Upload to Drive');
link('Upload to Drive', 'Build Drive Link');
link('Build Drive Link', 'Write DocumentLink');
link('Write DocumentLink', 'Slack - Pack Ready');

const wf = {
  name: 'Workflow 4 — VendorPanel Auto-Download on Approval',
  nodes,
  connections: conn,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

fs.writeFileSync('/home/user/Tender-scraper/n8n_Workflow_4_VendorPanel_Download.json', JSON.stringify(wf, null, 2));
console.log('wrote workflow 4 —', nodes.length, 'nodes');

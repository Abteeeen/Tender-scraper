// Workflow 4 (Browserless edition)
//
// A real browser does the whole job: log in, find the tender, follow it if
// needed, click the download icon, click Download in the modal, and let Chrome
// receive the file. Browserless's /download endpoint returns that file straight
// back to n8n as binary, so the existing Drive + Sheet tail is unchanged.
//
// This replaces the hand-rolled HTTP login chain entirely — VendorPanel's
// package endpoint cannot be reached without a browser (verified: it returns a
// server-error page even in a real logged-in browser when requested directly).

import fs from 'node:fs';

const SHEET_ID = '1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY';
const TAB = 'Claude v3';

let col = 0;
const at = (row = 0) => [260 + col++ * 250, 300 + row * 200];
const cred = (t, n) => ({ [t]: { id: 'REPLACE_ME', name: n } });

const nodes = [];
const conn = {};
const link = (from, to, out = 0) => {
  conn[from] = conn[from] || { main: [] };
  while (conn[from].main.length <= out) conn[from].main.push([]);
  conn[from].main[out].push({ node: to, type: 'main', index: 0 });
};

// ───────────────────────────────────────────────────────── 1 webhook
nodes.push({
  parameters: {
    httpMethod: 'POST',
    path: 'vendorpanel-approved',
    responseMode: 'onReceived',
    responseData: 'allEntries',
    options: {},
  },
  id: 'c-hook', name: 'On Approval (Webhook)',
  type: 'n8n-nodes-base.webhook', typeVersion: 2, position: at(),
  webhookId: 'vendorpanel-approved',
});

// ───────────────────────────────────────────────────────── 2 validate
nodes.push({
  parameters: {
    jsCode: `// Apps Script posts one approved row. Check it before spending a browser on it.
const b = $json.body || $json;

const tender = {
  rowId: String(b.rowId || '').trim(),
  title: String(b.title || '').trim(),
  ref:   String(b.ref || '').trim(),
  link:  String(b.link || '').trim(),
  source: String(b.source || '').trim(),
};

if (!/^https?:\\/\\//i.test(tender.link)) {
  throw new Error('Webhook payload has no usable Link: ' + JSON.stringify(b).slice(0, 300));
}
if (!/vendorpanel/i.test(tender.source)) return [];  // nothing to fetch here

// VendorPanel's reference is embedded in the public link:
//   tsi.axd?id=<guid32>s517599s<hash>s<n>   ->  VP517599
const fromLink = (tender.link.match(/id=[0-9a-f]{32}s(\\d+)s/i) || [])[1] || '';
const fromRef  = (tender.ref.match(/VP\\s*(\\d{4,})/i) || [])[1] || '';
const vpRef = fromLink || fromRef;

return [{ json: { ...tender, vpRef, ok: Boolean(vpRef) } }];`,
  },
  id: 'c-valid', name: 'Validate Payload',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 3 build script
// The tender reference is baked into the script (it isn't secret). Credentials
// arrive separately in `context`, injected by the n8n credential, so they never
// appear in the workflow JSON or in an execution log.
const BROWSER_SCRIPT = String.raw`
export default async function ({ page, context }) {
  const { UserName, Password } = context || {};
  if (!UserName || !Password) throw new Error('No credentials in context — check the Browserless credential');

  const VP_REF = '__VP_REF__';
  const TITLE  = '__TITLE__';
  const log = [];
  const note = (m) => { log.push(m); console.log(m); };

  page.setDefaultTimeout(45000);
  await page.setViewport({ width: 1400, height: 900 });

  // ---- log in (2 steps: email -> Next -> password -> Next) ----------------
  await page.goto('https://www.vendorpanel.com.au/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#UserName', { visible: true });
  await page.type('#UserName', UserName, { delay: 20 });
  note('email entered');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
    page.click('#btnGo'),
  ]);

  await page.waitForSelector('#Password', { visible: true });
  await page.type('#Password', Password, { delay: 20 });
  note('password entered');

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => null),
    page.click('#btnGo'),
  ]);

  if (/account\/login/i.test(page.url())) {
    throw new Error('login did not complete — still at ' + page.url());
  }
  note('logged in');

  // ---- members' tender list ----------------------------------------------
  await page.goto('https://www.vendorpanel.com.au/Members/?do=Tenders:AllTenders',
    { waitUntil: 'networkidle2' });
  note('tender list loaded');

  // Don't use the search box — it filters on title text, not the VP reference,
  // so searching "517599" empties the list. The page shows all open tenders at
  // once, so scan it directly.
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => null);

  // ---- locate the row, follow it, click the download icon -----------------
  // Downloads are disabled on tenders that are not Followed, so follow first.
  const clicked = await page.evaluate((ref, title) => {
    const isIcon = (e) => {
      const s = (e.getAttribute('title') || '') + ' ' + (e.getAttribute('alt') || '') +
                ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.className || '') +
                ' ' + (e.getAttribute('src') || '') + ' ' + (e.getAttribute('href') || '') +
                ' ' + (e.getAttribute('onclick') || '');
      return /download|package/i.test(s);
    };

    const bodyText = document.body.innerText || '';
    const needles = ['VP' + ref, ref, title.slice(0, 40)].filter(Boolean);
    const present = needles.filter((n) => bodyText.includes(n));

    // Find the deepest element that names this tender, then walk up until an
    // ancestor also contains a download control — that ancestor is the row.
    let anchor = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.children.length) continue;                 // leaf nodes only
      const t = (el.textContent || '').trim();
      if (!t) continue;
      if (t.includes('VP' + ref) || t === ref || (title && t.includes(title.slice(0, 40)))) {
        anchor = el;
        break;
      }
    }

    if (!anchor) {
      return { found: false, reason: 'tender not present on the list page',
               needlesPresent: present, bodySample: bodyText.slice(0, 600),
               listLength: bodyText.length };
    }

    let row = anchor;
    let icon = null;
    for (let up = 0; up < 12 && row; up++) {
      icon = [...row.querySelectorAll('a, img, i, span, button, input')].find(isIcon);
      if (icon) break;
      row = row.parentElement;
    }

    if (!icon || !row) {
      return { found: false, reason: 'found the tender but no download control near it',
               needlesPresent: present,
               sample: (anchor.closest('tr') || anchor.parentElement || anchor).innerHTML.slice(0, 1200) };
    }

    // follow first if the row currently offers to
    const follow = [...row.querySelectorAll('a, span, div, label, input')]
      .find((e) => /^\s*follow\s*$/i.test((e.innerText || e.value || '').trim()));
    if (follow) follow.click();

    icon.click();
    return { found: true, followed: Boolean(follow),
             iconHtml: icon.outerHTML.slice(0, 200) };
  }, VP_REF, TITLE);

  if (!clicked.found) {
    throw new Error('Could not start the download: ' + clicked.reason +
      ' || needlesPresent=' + JSON.stringify(clicked.needlesPresent || []) +
      ' || listLength=' + (clicked.listLength ?? '?') +
      (clicked.sample ? ' || ROW=' + clicked.sample : '') +
      (clicked.bodySample ? ' || BODY=' + clicked.bodySample : ''));
  }
  note('clicked the download icon ' + (clicked.iconHtml || '') +
       (clicked.followed ? ' (followed first)' : ''));

  // ---- the modal, which may be inline or in an iframe ---------------------
  const pressDownload = async () => {
    const targets = [page, ...page.frames()];
    for (const t of targets) {
      const hit = await t.evaluate(() => {
        const b = [...document.querySelectorAll('a, button, input[type=submit]')]
          .find((e) => /^\s*download\s*$/i.test(e.innerText || e.value || ''));
        if (!b) return false;
        b.click();
        return true;
      }).catch(() => false);
      if (hit) return true;
    }
    return false;
  };

  let pressed = false;
  for (let i = 0; i < 20 && !pressed; i++) {
    pressed = await pressDownload();
    if (!pressed) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!pressed) throw new Error('The download modal never showed a Download button');
  note('pressed Download — waiting for the package to build');

  // VendorPanel builds the zip server-side ("Working on it.."). Give it time;
  // Browserless returns whatever Chrome downloads during this function.
  await new Promise((r) => setTimeout(r, 120000));
  note('done: ' + log.join(' | '));
}
`;

nodes.push({
  parameters: {
    jsCode: `// Bake the tender reference into the browser script. Credentials are NOT put
// here — they arrive in Browserless's \`context\`, injected by the credential.
const SCRIPT = ${JSON.stringify(BROWSER_SCRIPT)};

const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const code = SCRIPT
    .replace('__VP_REF__', String(j.vpRef).replace(/[^0-9]/g, ''))
    .replace('__TITLE__', String(j.title).replace(/['"\\\\]/g, ' ').slice(0, 80));
  out.push({ json: { ...j, code } });
}
return out;`,
  },
  id: 'c-script', name: 'Build Browser Script',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 4 gate
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      conditions: [{
        id: 'has-ref',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
        leftValue: '={{ $json.ok }}', rightValue: '',
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'c-gate', name: 'Have a VP Reference?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(),
});

// ───────────────────────────────────────────────────────── 5 browserless
nodes.push({
  parameters: {
    method: 'POST',
    url: 'https://production-sfo.browserless.io/download',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpCustomAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ code: $json.code }) }}',
    options: {
      response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
      timeout: 300000,
    },
  },
  id: 'c-browserless', name: 'Browserless Download',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  credentials: cred('httpCustomAuth', 'Browserless + VendorPanel'),
  onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── 6 name file
nodes.push({
  parameters: {
    jsCode: `const out = [];
const jobs = $('Have a VP Reference?').all();
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const job = jobs[i]?.json || {};
  const bin = items[i].binary?.data;

  if (!bin) {
    // Browserless returned JSON (an error) rather than a file.
    out.push({ json: { ...job, ok: false,
      reason: 'no file came back from Browserless',
      detail: JSON.stringify(items[i].json).slice(0, 900) } });
    continue;
  }

  const base = String(job.ref || ('VP' + job.vpRef) || job.rowId || job.title)
    .slice(0, 60).replace(/[\\\\/:*?"<>|]/g, '_').trim();

  let ext = bin.fileExtension || '';
  if (!ext) {
    const mime = bin.mimeType || '';
    ext = /zip/i.test(mime) ? 'zip' : /pdf/i.test(mime) ? 'pdf' : 'zip';
  }

  out.push({ json: { ...job, ok: true, fileName: base + '_pack.' + ext }, binary: items[i].binary });
}
return out;`,
  },
  id: 'c-name', name: 'Name the File',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 7 got a file?
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      conditions: [{
        id: 'got-file',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
        leftValue: '={{ $json.ok }}', rightValue: '',
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'c-gate2', name: 'Got the Pack?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(),
});

// ───────────────────────────────────────────────────────── 8 drive
nodes.push({
  parameters: {
    name: '={{ $json.fileName }}',
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: 'root', mode: 'list', cachedResultName: '/ ← CHANGE ME to Tender Packs' },
    options: {},
  },
  id: 'c-drive', name: 'Upload to Drive',
  type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: at(),
  credentials: cred('googleDriveOAuth2Api', 'Google Drive account'),
});

// ───────────────────────────────────────────────────────── 9 link
nodes.push({
  parameters: {
    jsCode: `const out = [];
const jobs = $('Name the File').all();
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const up = items[i].json;
  const job = jobs[i]?.json || {};
  const id = up.id || up.fileId;
  out.push({ json: {
    RowID: job.rowId,
    DocumentLink: id ? 'https://drive.google.com/file/d/' + id + '/view' : (up.webViewLink || ''),
    title: job.title,
  } });
}
return out;`,
  },
  id: 'c-mklink', name: 'Build Drive Link',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ───────────────────────────────────────────────────────── 10 sheet
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
  id: 'c-write', name: 'Write DocumentLink',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: at(),
  credentials: cred('googleSheetsOAuth2Api', 'Google Sheets account'),
});

// ───────────────────────────────────────────────────────── 11-12 slack
nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=📦 *Tender pack retrieved*\n\n*{{ $json.title }}*\n{{ $json.DocumentLink }}\n\n_Deep analysis runs within 5 minutes._',
    otherOptions: {},
  },
  id: 'c-ok', name: 'Slack - Pack Ready',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: at(1),
  credentials: cred('slackApi', 'Slack account'), onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=⚠️ *Could not auto-download this pack*\n\n*{{ $json.title }}*\n{{ $json.link }}\n\n{{ $json.reason }}\n{{ $json.detail }}\n\n_Fetch it by hand and paste the Drive link into DocumentLink._',
    otherOptions: {},
  },
  id: 'c-fail', name: 'Slack - Manual Download Needed',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [260 + 6 * 250, 300 + 2 * 200],
  credentials: cred('slackApi', 'Slack account'), onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── wiring
link('On Approval (Webhook)', 'Validate Payload');
link('Validate Payload', 'Build Browser Script');
link('Build Browser Script', 'Have a VP Reference?');
link('Have a VP Reference?', 'Browserless Download', 0);
link('Have a VP Reference?', 'Slack - Manual Download Needed', 1);
link('Browserless Download', 'Name the File');
link('Name the File', 'Got the Pack?');
link('Got the Pack?', 'Upload to Drive', 0);
link('Got the Pack?', 'Slack - Manual Download Needed', 1);
link('Upload to Drive', 'Build Drive Link');
link('Build Drive Link', 'Write DocumentLink');
link('Write DocumentLink', 'Slack - Pack Ready');

const wf = {
  name: 'Workflow 4 — VendorPanel Download via Browserless',
  nodes, connections: conn,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

fs.writeFileSync('/home/user/Tender-scraper/n8n_Workflow_4_VendorPanel_Browserless.json',
  JSON.stringify(wf, null, 2));
console.log('wrote', nodes.length, 'nodes');

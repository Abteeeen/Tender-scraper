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
const linkAi = (from, to, kind = 'ai_languageModel') => {
  conn[from] = conn[from] || {};
  conn[from][kind] = conn[from][kind] || [[]];
  conn[from][kind][0].push({ node: to, type: kind, index: 0 });
};
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

  // The list is paginated (50 per page, ~8 pages). A followed tender is pinned
  // to the top of page 1, but an unfollowed one can be on any page — and we
  // have to follow it before the download icon becomes active. So: widen the
  // page size, then walk the pages until the tender turns up.
  //
  // The search box is deliberately unused: it matches on title text, so typing
  // a VP reference into it empties the list.
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => null);

  // Show as many per page as the dropdown allows.
  const grew = await page.evaluate(() => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => [...s.options].every((o) => /^\d+$/.test(o.value)) && s.options.length > 1);
    if (!sel) return 0;
    const biggest = [...sel.options].map((o) => Number(o.value)).sort((x, y) => y - x)[0];
    sel.value = String(biggest);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return biggest;
  });
  if (grew) {
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => null);
    note('page size set to ' + grew);
  }

  const findAndClick = (ref, title) => {
    const isIcon = (e) => {
      const s = (e.getAttribute('title') || '') + ' ' + (e.getAttribute('alt') || '') +
                ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.className || '') +
                ' ' + (e.getAttribute('src') || '') + ' ' + (e.getAttribute('href') || '') +
                ' ' + (e.getAttribute('onclick') || '');
      return /download|package/i.test(s);
    };

    const bodyText = document.body.innerText || '';
    const needles = ['VP' + ref, title.slice(0, 40)].filter(Boolean);
    const present = needles.filter((n) => bodyText.includes(n));

    // deepest element naming this tender
    let anchor = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.children.length) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      if (t.includes('VP' + ref) || (title && t.includes(title.slice(0, 40)))) { anchor = el; break; }
    }
    if (!anchor) return { found: false, onThisPage: false, needlesPresent: present,
                          listLength: bodyText.length };

    // walk up to the ancestor that also holds a download control
    let row = anchor, icon = null;
    for (let up = 0; up < 12 && row; up++) {
      icon = [...row.querySelectorAll('a, img, i, span, button, input')].find(isIcon);
      if (icon) break;
      row = row.parentElement;
    }
    if (!icon || !row) {
      return { found: false, onThisPage: true, reason: 'found the tender but no download control near it',
               needlesPresent: present,
               sample: (anchor.closest('tr') || anchor.parentElement || anchor).innerHTML.slice(0, 1200) };
    }

    // must be Followed before the icon works
    const follow = [...row.querySelectorAll('a, span, div, label, input')]
      .find((e) => /^\s*follow\s*$/i.test((e.innerText || e.value || '').trim()));
    if (follow) follow.click();

    return { found: true, onThisPage: true, followed: Boolean(follow),
             iconHtml: icon.outerHTML.slice(0, 200) };
  };

  const gotoNextPage = () => {
    const nav = [...document.querySelectorAll('a, input, button, span')].find((e) => {
      const s = (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '') +
                ' ' + (e.className || '') + ' ' + (e.id || '') + ' ' + (e.getAttribute('onclick') || '');
      const disabled = e.disabled || /disabled/i.test(e.className || '');
      return /next/i.test(s) && !/nextpageset|disabled/i.test(e.className || '') && !disabled;
    });
    if (!nav) return false;
    nav.click();
    return true;
  };

  let clicked = { found: false };
  for (let pageNo = 1; pageNo <= 12; pageNo++) {
    clicked = await page.evaluate(findAndClick, VP_REF, TITLE);
    if (clicked.found || clicked.onThisPage) { note('found on page ' + pageNo); break; }

    const moved = await page.evaluate(gotoNextPage);
    if (!moved) { note('no further pages after ' + pageNo); break; }
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => null);
  }

  // Following changes the row, so re-locate and click the icon for real.
  if (clicked.found && clicked.followed) {
    await new Promise((r) => setTimeout(r, 3000));
    clicked = await page.evaluate(findAndClick, VP_REF, TITLE);
  }

  if (clicked.found) {
    await page.evaluate((ref, title) => {
      const isIcon = (e) => {
        const s = (e.getAttribute('title') || '') + ' ' + (e.getAttribute('alt') || '') +
                  ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.className || '') +
                  ' ' + (e.getAttribute('src') || '') + ' ' + (e.getAttribute('href') || '') +
                  ' ' + (e.getAttribute('onclick') || '');
        return /download|package/i.test(s);
      };
      let anchor = null;
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      while (w.nextNode()) {
        const el = w.currentNode;
        if (el.children.length) continue;
        const t = (el.textContent || '').trim();
        if (t.includes('VP' + ref) || (title && t.includes(title.slice(0, 40)))) { anchor = el; break; }
      }
      let row = anchor;
      for (let up = 0; up < 12 && row; up++) {
        const icon = [...row.querySelectorAll('a, img, i, span, button, input')].find(isIcon);
        if (icon) { icon.click(); return true; }
        row = row.parentElement;
      }
      return false;
    }, VP_REF, TITLE);
  }

  if (!clicked.found) {
    throw new Error('Could not start the download: ' + (clicked.reason || 'tender not found on any page') +
      ' || needlesPresent=' + JSON.stringify(clicked.needlesPresent || []) +
      ' || listLength=' + (clicked.listLength ?? '?') +
      (clicked.sample ? ' || ROW=' + clicked.sample : ''));
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

  // Register the listener BEFORE clicking, so we catch the request the moment
  // it is made rather than when it completes. VendorPanel spends ~21s building
  // the zip server-side, and the free Browserless plan caps a session at 60s —
  // so we grab the URL and let n8n fetch the bytes outside the browser.
  let downloadUrl = null;
  const urlSeen = new Promise((resolve) => {
    const onReq = (req) => {
      const u = req.url();
      if (/FileDownloader|\.zip(\?|$)|blob\.core\.windows\.net/i.test(u)) {
        try { page.off('request', onReq); } catch (e) {}
        resolve(u);
      }
    };
    page.on('request', onReq);
    setTimeout(() => resolve(null), 30000);
  });

  let pressed = false;
  for (let i = 0; i < 30 && !pressed; i++) {
    pressed = await pressDownload();
    if (!pressed) await new Promise((r) => setTimeout(r, 500));
  }
  if (!pressed) throw new Error('The download modal never showed a Download button');
  note('pressed Download');

  downloadUrl = await urlSeen;
  if (!downloadUrl) throw new Error('Download was pressed but no package URL was requested');
  note('package url captured');

  // Hand the session over too, in case the URL is not self-authenticating.
  const cookies = await page.cookies();
  const cookieHeader = cookies.map((c) => c.name + '=' + c.value).join('; ');

  return {
    data: { downloadUrl, cookieHeader, log },
    type: 'application/json',
  };
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
    url: 'https://production-sfo.browserless.io/function?timeout=58000',
    authentication: 'genericCredentialType',
    genericAuthType: 'httpCustomAuth',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ code: $json.code }) }}',
    options: { timeout: 90000 },
  },
  id: 'c-browserless', name: 'Browserless Find Package',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  credentials: cred('httpCustomAuth', 'Browserless + VendorPanel'),
  onError: 'continueRegularOutput',
});

// ─────────────────────────────────────────── 5b read the browserless result
nodes.push({
  parameters: {
    jsCode: `// Browserless /function replies { data, type }. Pull the package URL out.
const out = [];
const jobs = $('Have a VP Reference?').all();
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const job = jobs[i]?.json || {};
  const r = items[i].json || {};
  const d = r.data || r;

  if (!d || !d.downloadUrl) {
    out.push({ json: { ...job, ok: false,
      reason: 'Browserless did not return a package URL',
      detail: JSON.stringify(r).slice(0, 900) } });
    continue;
  }

  out.push({ json: { ...job, ok: true,
    downloadUrl: d.downloadUrl,
    cookieHeader: d.cookieHeader || '',
    browserLog: d.log || [] } });
}
return out;`,
  },
  id: 'c-read', name: 'Read Package URL',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────── 5c fetch the zip (no browser)
// The chain ends at an Azure blob URL carrying its own SAS token, so this needs
// no browser and no session cap. Cookies are sent anyway in case the first hop
// (FileDownloader) still wants them.
nodes.push({
  parameters: {
    url: '={{ $json.downloadUrl }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
    ] },
    options: {
      response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
      redirect: { redirect: { followRedirects: true, maxRedirects: 10 } },
      timeout: 300000,
    },
  },
  id: 'c-fetch', name: 'Fetch Package',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── 6 name file
nodes.push({
  parameters: {
    jsCode: `const out = [];
const jobs = $('Read Package URL').all();
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


// ═══════════════════════════════════════════════ deep analysis (was Workflow 2)
// Runs off the SAME in-memory zip we just downloaded — no Drive round-trip.

nodes.push({
  parameters: {},
  id: 'c-unzip', name: 'Unzip Tender Pack',
  type: 'n8n-nodes-base.compression', typeVersion: 1.1, position: at(1),
  onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    jsCode: `// Pick the documents worth reading, wherever they sit in the archive.
//
// A real pack looks like:
//   VP517599/Request Summary Report.pdf
//   VP517599/RequestDocs/Attachment_B-Specifications_and_Requirements.pdf
//   VP517599/RequestDocs/QPS23388_ITO_Part_A.pdf   ... 8 files, nested
//
// So never address files positionally (file_1, file_2...) — the order and depth
// vary by buyer. Score them by filename and take the most informative few.
const out = [];
const job = $('Name the File').first().json;

const score = (name) => {
  const n = name.toLowerCase();
  if (/spec|requirement|scope|statement of work|sow/.test(n)) return 100;
  if (/ito|invitation|rft|rfq|tender|part[_ -]?a/.test(n))    return 90;
  if (/condition|terms|contract|deed/.test(n))                return 60;
  if (/summary/.test(n))                                      return 55;
  if (/pricing|schedule|rates/.test(n))                        return 50;
  if (/confidential|privacy|conflict/.test(n))                 return 10;
  return 30;
};

for (const item of $input.all()) {
  const bins = item.binary || {};
  const files = Object.entries(bins).map(([key, b]) => ({
    key,
    name: b.fileName || key,
    mime: b.mimeType || '',
  }));

  // PDFs carry the substance; spreadsheets are pricing templates with little prose
  const pdfs = files
    .filter((f) => /pdf/i.test(f.mime) || /\\.pdf$/i.test(f.name))
    .sort((a, b) => score(b.name) - score(a.name))
    .slice(0, 5);

  if (!pdfs.length) {
    out.push({ json: { ...job, ok: false,
      reason: 'no PDFs found in the pack',
      filesSeen: files.map((f) => f.name).slice(0, 20) } });
    continue;
  }

  // one item per document, each with its binary under "data" so a single
  // Extract From File node can process them all
  pdfs.forEach((f, i) => {
    out.push({
      json: { ...job, ok: true, docName: f.name, docIndex: i, docCount: pdfs.length,
              allFiles: files.map((x) => x.name) },
      binary: { data: bins[f.key] },
    });
  });
}
return out;`,
  },
  id: 'c-pick', name: 'Select Documents',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(1),
});

nodes.push({
  parameters: { operation: 'pdf', binaryPropertyName: 'data', options: {} },
  id: 'c-pdf', name: 'Extract PDF Text',
  type: 'n8n-nodes-base.extractFromFile', typeVersion: 1, position: at(1),
  onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    jsCode: `// Stitch the documents together for the model, biggest-signal first.
const job = $('Name the File').first().json;
const picked = $('Select Documents').all();

let combined = '';
const used = [];
$input.all().forEach((item, i) => {
  const name = picked[i]?.json?.docName || ('document ' + (i + 1));
  const text = (item.json.text || '').toString();
  if (!text.trim()) return;
  used.push(name);
  combined += '\\n\\n===== ' + name + ' =====\\n' + text;
});

if (!combined.trim()) {
  return [{ json: { ...job, ok: false, reason: 'no text could be extracted from the PDFs' } }];
}

return [{ json: {
  ...job,
  ok: true,
  documentsUsed: used,
  allFiles: picked[0]?.json?.allFiles || [],
  doc_text: combined.replace(/[\\t ]+/g, ' ').slice(0, 250000),
} }];`,
  },
  id: 'c-combine', name: 'Combine Document Text',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(1),
});

nodes.push({
  parameters: {
    promptType: 'define',
    text: '=You are a tender analyst for a South East Queensland SECURITY (manpower guarding + electronic/CCTV) and COMMERCIAL CLEANING contractor. Read the full tender document below and extract the exact, contract-critical requirements. Where a value is not stated, use "Not stated" — never invent.\n\nReturn ONLY a valid JSON object (no markdown, no code fences, no prose):\n{\n  "compliance_requirements": "every licence, certification, clearance, insurance level and registration required",\n  "pricing_matrix": "the pricing/schedule-of-rates structure — line items, units, GST, escalation clauses",\n  "scope_of_work": "4-6 sentence precise description of work, sites, hours/roster and deliverables",\n  "kpis_slas": "performance indicators, response times, reporting obligations",\n  "submission_requirements": "forms, referees, page limits, lodgement method",\n  "evaluation_criteria": "assessment criteria and weightings if given",\n  "red_flags": "incumbent advantage, prequalification, unusual indemnities, tight timeframe",\n  "bid_strategy": "3-5 sentences of practical advice on positioning a competitive bid"\n}\n\nTender: {{ $json.title }}\nDocuments read: {{ $json.documentsUsed }}\n\nTENDER DOCUMENT:\n{{ $json.doc_text }}',
    hasOutputParser: false,
  },
  id: 'c-llm', name: 'Deep Analysis',
  type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1.4, position: at(1),
});

nodes.push({
  parameters: {
    model: { __rl: true, value: 'gpt-4.1-mini', mode: 'list', cachedResultName: 'gpt-4.1-mini' },
    options: { temperature: 0.3 },
  },
  id: 'c-model', name: 'OpenAI Chat Model',
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: 1.2, position: [260 + 11 * 250, 300 + 2 * 200],
  credentials: cred('openAiApi', 'n8n free OpenAI API credits'),
});

nodes.push({
  parameters: {
    mode: 'runOnceForEachItem',
    jsCode: `let raw = ($json.text || '').toString().replace(/\`\`\`json/gi, '').replace(/\`\`\`/g, '').trim();
let a;
try { a = JSON.parse(raw); } catch (e) { a = { parse_error: true, scope_of_work: raw.slice(0, 500) }; }

const meta = $('Combine Document Text').first().json;
const cap = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });

return { json: {
  RowID: meta.rowId || '',
  Title: meta.title || '',
  Analyzed: cap,
  ComplianceRequirements: a.compliance_requirements || '',
  PricingMatrix: a.pricing_matrix || '',
  ScopeOfWork: a.scope_of_work || '',
  KPIs_SLAs: a.kpis_slas || '',
  SubmissionRequirements: a.submission_requirements || '',
  EvaluationCriteria: a.evaluation_criteria || '',
  RedFlags: a.red_flags || '',
  BidStrategy: a.bid_strategy || '',
  DocumentsRead: (meta.documentsUsed || []).join(' | '),
  Link: meta.link || '',
} };`,
  },
  id: 'c-parse', name: 'Parse Deep Analysis',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(1),
});

nodes.push({
  parameters: {
    operation: 'append',
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: 'Deep Analysis', mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        RowID: '={{ $json.RowID }}', Title: '={{ $json.Title }}', Analyzed: '={{ $json.Analyzed }}',
        ComplianceRequirements: '={{ $json.ComplianceRequirements }}',
        PricingMatrix: '={{ $json.PricingMatrix }}', ScopeOfWork: '={{ $json.ScopeOfWork }}',
        KPIs_SLAs: '={{ $json.KPIs_SLAs }}',
        SubmissionRequirements: '={{ $json.SubmissionRequirements }}',
        EvaluationCriteria: '={{ $json.EvaluationCriteria }}',
        RedFlags: '={{ $json.RedFlags }}', BidStrategy: '={{ $json.BidStrategy }}',
        DocumentsRead: '={{ $json.DocumentsRead }}', Link: '={{ $json.Link }}',
      },
      matchingColumns: [], schema: [],
    },
    options: {},
  },
  id: 'c-deepsheet', name: 'Append to Deep Analysis Tab',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: at(1),
  credentials: cred('googleSheetsOAuth2Api', 'Google Sheets account'),
});

nodes.push({
  parameters: {
    operation: 'update',
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: TAB, mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: { RowID: '={{ $json.RowID }}', HumanApproval: 'Analyzed' },
      matchingColumns: ['RowID'], schema: [],
    },
    options: {},
  },
  id: 'c-mark', name: 'Mark Row Analyzed',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: at(1),
  credentials: cred('googleSheetsOAuth2Api', 'Google Sheets account'),
});

nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=✅ *Deep analysis complete: {{ $json.Title }}*\n\nDocuments read: {{ $json.DocumentsRead }}\n\nCompliance, pricing structure, scope and bid strategy are in the Deep Analysis tab.',
    otherOptions: {},
  },
  id: 'c-analysisdone', name: 'Slack - Analysis Ready',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: at(1),
  credentials: cred('slackApi', 'Slack account'), onError: 'continueRegularOutput',
});

// ───────────────────────────────────────────────────────── wiring
link('On Approval (Webhook)', 'Validate Payload');
link('Validate Payload', 'Build Browser Script');
link('Build Browser Script', 'Have a VP Reference?');
link('Have a VP Reference?', 'Browserless Find Package', 0);
link('Have a VP Reference?', 'Slack - Manual Download Needed', 1);
link('Browserless Find Package', 'Read Package URL');
link('Read Package URL', 'Fetch Package');
link('Fetch Package', 'Name the File');
link('Name the File', 'Got the Pack?');
link('Got the Pack?', 'Upload to Drive', 0);
link('Got the Pack?', 'Unzip Tender Pack', 0);
link('Unzip Tender Pack', 'Select Documents');
link('Select Documents', 'Extract PDF Text');
link('Extract PDF Text', 'Combine Document Text');
link('Combine Document Text', 'Deep Analysis');
linkAi('OpenAI Chat Model', 'Deep Analysis');
link('Deep Analysis', 'Parse Deep Analysis');
link('Parse Deep Analysis', 'Append to Deep Analysis Tab');
link('Append to Deep Analysis Tab', 'Mark Row Analyzed');
link('Mark Row Analyzed', 'Slack - Analysis Ready');
link('Got the Pack?', 'Slack - Manual Download Needed', 1);
link('Upload to Drive', 'Build Drive Link');
link('Build Drive Link', 'Write DocumentLink');
link('Write DocumentLink', 'Slack - Pack Ready');

const wf = {
  name: 'Workflow 4 — VendorPanel Download + Deep Analysis',
  nodes, connections: conn,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

fs.writeFileSync('/home/user/Tender-scraper/n8n_Workflow_4_VendorPanel_Browserless.json',
  JSON.stringify(wf, null, 2));
console.log('wrote', nodes.length, 'nodes');

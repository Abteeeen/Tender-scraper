# Workflow Changes v3 — BCC fix, New-Tender alert, Contacts, Extra source, Watchlist, Source-aware doc alert

This pack covers modifications **1–6** from the recommendation, as importable n8n JSON.
Copy a node's JSON, then in n8n press **Ctrl/Cmd+V** on the canvas to paste it in, and re-wire
as noted.

## First — the structural answer: it stays TWO workflows

Changes **1–5 belong to Workflow 1** (Discovery & Triage). Change **6 belongs to Workflow 2**
(Deep Analysis). They **cannot** be merged into one, because the **human approval gate** sits
between them: Workflow 1 ends by writing rows to the `Claude v3` sheet → a human ticks
`HumanApproval = Approved` and pastes a `DocumentLink` → Workflow 2 polls the sheet and picks up
from there. Collapsing them into one workflow would delete that human pause, which is the whole
point of the design. So: **import/keep both workflows; the changes below are grouped by which one
they go in.**

| # | Change | Workflow |
|---|--------|----------|
| 1 | Fix Brisbane City Council extraction (real per-tender title + link) | 1 |
| 2 | New-tender Slack alert (Tier A/B) at the end of triage | 1 |
| 3 | Contact / lead-gen columns | 1 (already written — see v2 doc) |
| 4 | Extra RSS source (generic, reusable) | 1 |
| 5 | Watchlist sub-flow (sheet-driven URL list) | 1 |
| 6 | Source-aware "document needed" Slack message | 2 |

> **Test order:** apply **1, 2, 3, 6** first — they work immediately with no extra setup.
> **4 and 5** are shipped **disabled by default** (they need a real feed URL / a new sheet tab);
> enable them once configured, so the workflow imports and runs cleanly in the meantime.

---

## PART A — Workflow 1

### Change 1 — Fix Brisbane City Council extraction

Today `Normalize (BCC)` does `row.slice(0,140)` for the title and hard-codes the landing-page URL
as every tender's link. The fix: make `Extract BCC Rows` return each row's **HTML** (so we can read
the anchor), then parse the real tender name + link out of it.

**1a. Replace `Extract BCC Rows`** (adds `returnValue: html`):

```json
{
  "parameters": {
    "operation": "extractHtmlContent",
    "extractionValues": {
      "values": [
        {
          "key": "rows",
          "cssSelector": "table tr",
          "returnValue": "html",
          "returnArray": true
        }
      ]
    },
    "options": {}
  },
  "id": "0ce867b4-95cd-4397-8ff1-6ad1360cf687",
  "name": "Extract BCC Rows",
  "type": "n8n-nodes-base.html",
  "typeVersion": 1,
  "position": [2740, 1760]
}
```

**1b. Replace `Normalize (BCC)`:**

```json
{
  "parameters": {
    "jsCode": "const BASE = 'https://www.brisbane.qld.gov.au';\nconst LANDING = BASE + '/business/council-tenders-and-market-led-proposals/current-tenders';\nreturn $input.all().map(it => {\n  const html = (it.json.rows || '').toString();\n  // first anchor in the row = the tender's own link + name\n  const a = html.match(/<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>([\\s\\S]*?)<\\/a>/i);\n  let link = LANDING, title = '';\n  if (a) {\n    link = /^https?:/i.test(a[1]) ? a[1] : BASE + (a[1].startsWith('/') ? '' : '/') + a[1];\n    title = a[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\\s+/g, ' ').trim();\n  }\n  const rowText = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\\s+/g, ' ').trim();\n  if (!title) title = rowText.slice(0, 140);\n  return { json: {\n    title: title,\n    link: link,\n    guid: 'BCC:' + (a ? link : rowText.slice(0, 90)),\n    posted_raw: '',\n    source: 'Brisbane City Council',\n    text: rowText,\n    search_blob: rowText.toLowerCase()\n  }};\n}).filter(x =>\n  x.json.text.length > 15 &&\n  !/^(tender|title|description|closing|status|reference|number)\\b/i.test(x.json.title.trim())\n);"
  },
  "id": "b521c687-899b-4198-a37b-424a17bffe14",
  "name": "Normalize (BCC)",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3140, 1760]
}
```

> **Validate against the live page.** BCC's current-tenders page may render its list without a
> plain `<table><tr>` (some council pages are card/JS based). If `table tr` returns nothing this
> branch simply yields no items — no error — but you'll get no BCC leads. If so, open the page,
> inspect the real list markup, and change the `cssSelector` in 1a (e.g. `.tender-list li`,
> `article`, etc.) and the anchor regex still applies. Keep BCC verified before enabling any
> auto-approval on its rows.

### Change 2 — New-tender Slack alert (Tier A/B)

Right now a Tier A tender closing in 2 days lands silently in the sheet. Add a branch off
`Format for Sheets`: keep its existing wire to `Google Sheets`, and add a **second** wire to a
filter → Slack.

**2a. New node — `High-Priority New Tender?` (filter):**

```json
{
  "parameters": {
    "conditions": {
      "options": { "caseSensitive": false, "leftValue": "", "typeValidation": "loose", "version": 2 },
      "conditions": [
        { "id": "t1", "leftValue": "={{ $json.Tier }}", "rightValue": "A", "operator": { "type": "string", "operation": "equals" } },
        { "id": "t2", "leftValue": "={{ $json.Tier }}", "rightValue": "B", "operator": { "type": "string", "operation": "equals" } }
      ],
      "combinator": "or"
    },
    "options": {}
  },
  "id": "aa10bb20-0001-4a10-9a10-newalertfilter",
  "name": "High-Priority New Tender?",
  "type": "n8n-nodes-base.filter",
  "typeVersion": 2,
  "position": [5760, 1180]
}
```

**2b. New node — `Slack - New Tender`:**

```json
{
  "parameters": {
    "select": "channel",
    "channelId": { "__rl": true, "value": "C0B6K8652GM", "mode": "list", "cachedResultName": "hermes-testing" },
    "text": "=:mega: *New tender — Tier {{ $json.Tier }} ({{ $json.Service }})*\n\n*{{ $json.Title }}*\n:round_pushpin: {{ $json.Location }}  |  {{ $json.Region }}\n:alarm_clock: Closes: {{ $json.Deadline }}  ({{ $json.DaysToClose }} days)\n:office: {{ $json.BuyerOrg }}\n:telephone_receiver: {{ $json.ContactName }}  {{ $json.ContactEmail }}  {{ $json.ContactPhone }}\n\n{{ $json.Summary }}\n\nApprove in the sheet, then paste the DocumentLink.\n{{ $json.Link }}",
    "otherOptions": {}
  },
  "id": "aa10bb20-0002-4a10-9a10-newalertslack",
  "name": "Slack - New Tender",
  "type": "n8n-nodes-base.slack",
  "typeVersion": 2.2,
  "position": [5980, 1180],
  "webhookId": "b1508ce0-0000-4f04-876c-newtenderalert",
  "credentials": { "slackApi": { "id": "wBwfpnkQv3zlsz8V", "name": "n8n BOT " } }
}
```

**Wiring:** `Format for Sheets → Google Sheets` (keep) **and**
`Format for Sheets → High-Priority New Tender? → Slack - New Tender`.

> The `BuyerOrg` / `Contact*` fields in the message come from Change 3. If you haven't applied
> Change 3 yet they just render blank — the alert still works.

### Change 3 — Contact / lead-gen columns

Already written and ready to paste: apply sections **A1, A2, A3** of
[`Workflow_Changes_v2.md`](./Workflow_Changes_v2.md) (updated `Basic LLM Chain` prompt, updated
`Format for Sheets`, and the 5 new sheet columns `BuyerOrg`, `ContactName`, `ContactRole`,
`ContactEmail`, `ContactPhone`). Nothing here supersedes it.

### Change 4 — Extra RSS source (generic, reusable)

**Important reality check:** the obvious target, **QTenders** (`qtenders.hpw.qld.gov.au`), is a
JavaScript single-page app and publishes **no public RSS feed** (verified — plain HTTP fetches get
an empty/error page). So a simple RSS node can't read it; QTenders itself needs the browser-robot
path (self-hosted Puppeteer / GitHub Actions Playwright) described in part 1 of the earlier answer.

What this change gives you instead is a **drop-in generic RSS branch** you can point at *any real
feed* (many councils and agencies do publish RSS). It mirrors your VendorPanel branch. Shipped
**disabled** until you set a real URL.

Paste these 5 nodes and wire `Fetch Extra RSS → Convert XML (Extra) → Split (Extra) →
Normalize (Extra) → Keyword (Extra) → Dedupe (new only)`. Also wire
`Schedule Trigger → Fetch Extra RSS`.

```json
{
  "parameters": {
    "url": "https://REPLACE-WITH-A-REAL-RSS-FEED.example/rss.xml",
    "sendHeaders": true,
    "headerParameters": { "parameters": [ { "name": "User-Agent", "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } ] },
    "options": {}
  },
  "id": "cc40dd50-0001-4a10-9a10-fetchextrarss",
  "name": "Fetch Extra RSS",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [2540, 2080],
  "disabled": true
}
```
```json
{
  "parameters": { "options": {} },
  "id": "cc40dd50-0002-4a10-9a10-convertextra",
  "name": "Convert XML (Extra)",
  "type": "n8n-nodes-base.xml",
  "typeVersion": 1,
  "position": [2740, 2080]
}
```
```json
{
  "parameters": { "fieldToSplitOut": "rss.channel.item", "options": {} },
  "id": "cc40dd50-0003-4a10-9a10-splitextra",
  "name": "Split (Extra)",
  "type": "n8n-nodes-base.itemLists",
  "typeVersion": 3,
  "position": [2940, 2080]
}
```
```json
{
  "parameters": {
    "jsCode": "return $input.all().map(it => {\n  const j = it.json;\n  const rawDesc = (typeof j.description === 'string' ? j.description : JSON.stringify(j.description || '')).toString();\n  const cleanDesc = rawDesc.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\\s+/g, ' ').trim();\n  const title = (j.title || '').toString();\n  const g = j.guid;\n  const guid = (g && typeof g === 'object') ? (g['#text'] || g._ || j.link) : (g || j.link);\n  return { json: {\n    title: title,\n    link: j.link || '',\n    guid: guid,\n    posted_raw: j.pubDate || '',\n    source: 'Extra RSS',\n    text: (title + ' \\u2014 ' + cleanDesc),\n    search_blob: (title + ' ' + cleanDesc).toLowerCase()\n  }};\n});"
  },
  "id": "cc40dd50-0004-4a10-9a10-normalizeextra",
  "name": "Normalize (Extra)",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [3140, 2080]
}
```
```json
{
  "parameters": {
    "conditions": {
      "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict", "version": 1 },
      "conditions": [
        { "id": "e1", "leftValue": "={{ $json.search_blob }}", "rightValue": "security", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e2", "leftValue": "={{ $json.search_blob }}", "rightValue": "cleaning", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e3", "leftValue": "={{ $json.search_blob }}", "rightValue": "guard", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e4", "leftValue": "={{ $json.search_blob }}", "rightValue": "patrol", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e5", "leftValue": "={{ $json.search_blob }}", "rightValue": "janitor", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e6", "leftValue": "={{ $json.search_blob }}", "rightValue": "facilit", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e7", "leftValue": "={{ $json.search_blob }}", "rightValue": "concierge", "operator": { "type": "string", "operation": "contains" } },
        { "id": "e8", "leftValue": "={{ $json.search_blob }}", "rightValue": "cctv", "operator": { "type": "string", "operation": "contains" } }
      ],
      "combinator": "or"
    },
    "options": {}
  },
  "id": "cc40dd50-0005-4a10-9a10-keywordextra",
  "name": "Keyword (Extra)",
  "type": "n8n-nodes-base.filter",
  "typeVersion": 2,
  "position": [3340, 2080]
}
```

To use it: set a real feed URL in `Fetch Extra RSS`, change `source: 'Extra RSS'` to the feed's
name, then **enable** the node.

### Change 5 — Watchlist sub-flow (sheet-driven URL list)

This is the scalable pattern: a new sheet tab lists the pages you want swept, and adding a new
university/council later is **one sheet row, no new nodes**.

**5a. Create a new tab `Watchlist`** in the same spreadsheet, with headers:
`SiteName | URL | Selector`  (Selector is optional — leave blank to scan all links on the page).
Example rows:

| SiteName | URL | Selector |
|----------|-----|----------|
| UQ Procurement | https://staff.uq.edu.au/…/current-tenders | |
| Griffith Uni | https://www.griffith.edu.au/…/tenders | |

**5b. New node — `Read Watchlist`** (disabled until the tab exists; select the tab in the node
after import, then enable):

```json
{
  "parameters": {
    "documentId": { "__rl": true, "value": "1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY", "mode": "list", "cachedResultName": "Tender sheets " },
    "sheetName": { "__rl": true, "value": "Watchlist", "mode": "list", "cachedResultName": "Watchlist" },
    "options": {}
  },
  "id": "dd50ee60-0001-4a10-9a10-readwatchlist",
  "name": "Read Watchlist",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.2,
  "position": [2540, 2320],
  "disabled": true,
  "credentials": { "googleSheetsOAuth2Api": { "id": "HLZxRgOR9Y2XBrnV", "name": "Sheets permission(14/07/2026)" } }
}
```

**5c. New node — `Scrape Watchlist`** (fetches each URL, extracts links, keyword-filters inline):

```json
{
  "parameters": {
    "jsCode": "const KW = ['security','cleaning','guard','patrol','janitor','facilit','concierge','cctv'];\nconst out = [];\nfor (const row of $input.all()) {\n  const site = (row.json.SiteName || 'Watchlist').toString();\n  const url = (row.json.URL || '').toString().trim();\n  if (!url) continue;\n  let html = '';\n  try {\n    const res = await this.helpers.httpRequest({ url, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 20000 });\n    html = (typeof res === 'string') ? res : JSON.stringify(res);\n  } catch (e) { continue; }\n  const originMatch = url.match(/^https?:\\/\\/[^/]+/);\n  const origin = originMatch ? originMatch[0] : '';\n  const re = /<a[^>]*href=[\"']([^\"'#]+)[\"'][^>]*>([\\s\\S]*?)<\\/a>/gi;\n  let m; const seen = new Set();\n  while ((m = re.exec(html)) !== null) {\n    let link = m[1];\n    const title = m[2].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\\s+/g, ' ').trim();\n    if (title.length < 15) continue;\n    const blob = title.toLowerCase();\n    if (!KW.some(k => blob.includes(k))) continue;\n    if (link.startsWith('/')) link = origin + link;\n    if (!/^https?:/i.test(link)) continue;\n    if (seen.has(link)) continue; seen.add(link);\n    out.push({ json: {\n      title: title,\n      link: link,\n      guid: 'WL:' + link,\n      posted_raw: '',\n      source: site,\n      text: title,\n      search_blob: blob\n    }});\n  }\n}\nreturn out;"
  },
  "id": "dd50ee60-0002-4a10-9a10-scrapewatchlist",
  "name": "Scrape Watchlist",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2820, 2320]
}
```

**Wiring:** `Schedule Trigger → Read Watchlist → Scrape Watchlist → Dedupe (new only)`.
(Keyword filtering is already done inside `Scrape Watchlist`, so it goes straight to Dedupe. The
downstream LLM + In-Zone Gate then do the fine filtering, exactly as for the other sources.)

> Note: this reads **server-rendered** pages. JS-only SPA pages (QTenders again) return little
> static HTML, so they yield nothing here — those still need the browser-robot path.

---

## PART B — Workflow 2

### Change 6 — Source-aware "document needed" Slack message

The `Approved Awaiting Document` rows already carry the `Source` column from the sheet, so we can
tailor the instructions. **Replace** the existing `Slack - Document Needed` node (same id / name /
position, so it pastes straight over):

```json
{
  "parameters": {
    "select": "channel",
    "channelId": { "__rl": true, "value": "C0B6K8652GM", "mode": "list", "cachedResultName": "hermes-testing" },
    "text": "=:rotating_light: *Tender approved — document needed*\n\n*{{ $json.Title }}*\n{{ ($json.Source || '').toString().toLowerCase().includes('vendorpanel') ? 'VendorPanel: log in, open the tender, click *Register Interest*, download the pack, upload it to Drive, then paste the file link into the DocumentLink column.' : (($json.Source || '').toString().toLowerCase().includes('austender') ? 'AusTender: open the ATM link, download the documents (most need no login), upload to Drive, then paste the file link into DocumentLink.' : 'Open the portal below, download the tender pack, upload it to Drive, then paste the file link into the DocumentLink column.') }}\n\nSource: {{ $json.Source }}\nPortal link: {{ $json.Link }}",
    "otherOptions": {}
  },
  "id": "2f85e4d7-d612-4c71-b37d-80419d4fee9b",
  "name": "Slack - Document Needed",
  "type": "n8n-nodes-base.slack",
  "typeVersion": 2.2,
  "position": [2560, 3200],
  "webhookId": "821508ce-90bc-4f04-876c-cae7fac4d0ef",
  "credentials": { "slackApi": { "id": "wBwfpnkQv3zlsz8V", "name": "n8n BOT " } }
}
```

---

## Quick apply checklist

- [ ] **WF1 · 1** — replace `Extract BCC Rows` + `Normalize (BCC)`; verify against live BCC page.
- [ ] **WF1 · 2** — add `High-Priority New Tender?` + `Slack - New Tender`; branch off `Format for Sheets`.
- [ ] **WF1 · 3** — apply A1/A2/A3 from the v2 doc + add the 5 contact columns to the sheet.
- [ ] **WF1 · 4** — paste the 5 Extra-RSS nodes; set a real feed URL; enable when ready.
- [ ] **WF1 · 5** — create the `Watchlist` tab; paste `Read Watchlist` + `Scrape Watchlist`; enable when ready.
- [ ] **WF2 · 6** — replace `Slack - Document Needed` with the source-aware version.

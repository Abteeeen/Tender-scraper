# Tender Radar — Handover

Everything built, what works, what doesn't, and what to do next.
Repo: `github.com/Abteeeen/Tender-scraper` · branch `claude/austender-rss-workflow-8nmfz0`

---

## 1. What this system is

An automated tender-radar for an Australian client: a **South East Queensland
security (manpower guarding + electronic/CCTV) and commercial cleaning
contractor**, operating within ~50 km of Brisbane and the Gold Coast.

It finds relevant tenders across multiple sources, filters out the ~95% that
aren't relevant, writes the survivors to a Google Sheet with an AI-written
summary, waits for a human to approve, then fetches the tender documents and
runs a deep analysis.

**The filtering is the product.** In a 492-item scan only 23 were relevant — a
4.7% base rate. Anyone can list tenders; the value is in not wasting the
client's time.

---

## 2. Architecture

```
WORKFLOW 1 (discovery & triage)    — schedule
   pulls every source → keyword prefilter → LLM classify → Google Sheet
        ↓
   HUMAN sets HumanApproval = "Approved" in the sheet
        ↓  (Apps Script fires instantly)
WORKFLOW 4 (document retrieval)    — webhook
   logs into VendorPanel → downloads the pack → Drive → writes DocumentLink
        ↓
WORKFLOW 2 (deep analysis)         — polls every 5 min
   sees DocumentLink → unzips → extracts PDFs → LLM → Deep Analysis tab

WORKFLOW 3 (contract expiry)       — weekly, independent
   AusTender contract notices → computes expiry → alerts 6–9 months out
```

The human approval gate is deliberate and must not be collapsed. It is what
keeps LLM cost down and keeps the client in control of what gets pursued.

---

## 3. Files — what is where

All paths relative to repo root.

### Workflows (import these into n8n)

| File | Nodes | Purpose | Status |
|---|---|---|---|
| `n8n_Workflow_1_v4.json` | 50 | Discovery & triage | ✅ Working |
| `n8n_Workflow_2_v3.json` | 21 | Deep analysis of approved tenders | ✅ Working |
| `n8n_Workflow_3_Contract_Expiry.json` | 10 | Weekly contract-expiry radar | ✅ Working |
| `n8n_Workflow_4_VendorPanel_OnApproval.json` | 27 | Document retrieval | ⚠️ **Blocked** — see §6 |

Older files (`n8n_Tender_Workflow*.json`, `n8n_Workflow_1_v3.json`) are
superseded. Ignore or delete them.

### Supporting code

| Path | What |
|---|---|
| `apps-script/OnApproval.gs` | Google Apps Script. Fires the Workflow 4 webhook the instant `HumanApproval` becomes `Approved`. **Installable on-edit trigger** — a plain `onEdit()` will not work, Google blocks outbound calls from simple triggers. |
| `robot/robot.mjs` | Local Playwright robot — the working alternative for document retrieval. Runs on a PC. |
| `robot/README.md`, `robot/WINDOWS_SETUP.md` | Setup for the robot |
| `robot/.env.example` | Config template |
| `apify/` | Earlier Apify actor (full pipeline incl. Google). Superseded but useful as a starting point. |
| `scripts/build-wf4b.mjs` | **Generator** for Workflow 4. Edit this, run `node scripts/build-wf4b.mjs`, not the JSON by hand. |
| `scripts/build-wf4.mjs` | Generator for the abandoned Puppeteer version |

> ⚠️ `scripts/build-wf4b.mjs` regenerates the JSON but does **not** re-apply the
> Custom Auth credential on the two POST nodes. After regenerating, re-apply it
> (see git history for the small Python snippet used each time), or the login
> nodes lose their credential binding.

### Documentation

| File | What |
|---|---|
| `CLIENT_REQUIREMENTS.md` | What to ask the client for (accounts, portals, licences) |
| `WORKFLOW_4_SETUP.md` | Workflow 4 setup incl. Google OAuth from scratch |
| `REBUILD_v4_SETUP.md` | Workflow 1/2 setup |
| `HANDOVER.md` | This file |

---

## 4. Data sources — verified, not assumed

Every claim below was tested with real HTTP requests.

### Live in Workflow 1

| Source | Method | Notes |
|---|---|---|
| **AusTender** | RSS + detail-page fetch | Federal. RSS blurb alone lacks location, so each keyword-matching item gets its detail page fetched before classification. |
| **VendorPanel** | RSS | **Carries ~83% of all relevant tenders** (19 of 23 in the sample scan). Most SEQ councils + Local Buy panels. The single most important source. |
| **Brisbane City Council** | HTML scrape | Only SEQ council not on VendorPanel. Titles are public; documents are behind SAP Ariba invitation. |
| **eTender Queensland (QBuild/HPW)** | HTML scrape | Schools, social housing, police facilities |

Also present but disabled: IMAP inbox capture, watchlist, robot-push webhook.

### Investigated and ruled out

| Candidate | Finding |
|---|---|
| `supply.qld.gov.au` | **Redundant.** Fetched it — every functional link points at VendorPanel (`MarketPlace.aspx?emcc=…`, "Login to VendorPanel" ×5). It's a landing page. Confirms the QTenders → VendorPanel migration. |
| Seqwater | Closed supplier network (`dewdrops.zycus.com`). Registration + email, not scrapeable. |
| Queensland Urban Utilities | Own SRM portal, closed |
| Energy Queensland, Griffith, QUT | HTTP 403 to a browser-UA request — bot-blocked |
| Port of Brisbane, Brisbane Airport, Queensland Rail, UQ, Unitywater, Bond | No public tender listing found; all plausible URLs 404'd |
| Queensland Airports Ltd (Gold Coast Airport) | `tenderlink.com/qldairports` — returns a 212-byte JS shell, needs a browser. **Genuine untapped source inside the client's zone.** |
| Paid aggregators (TenderLink, Australian Tenders, TenderHub, BidContender) | Resell what's already free. Public listing pages are viewable without subscription; the fee buys alerting, which the radar already does. **Do not subscribe.** |

**The real coverage gap** is private sector — facilities managers (JLL, CBRE,
Colliers, Cushman & Wakefield), body corporate managers, shopping centres,
private hospitals, aged care, private schools. None of it is published anywhere
at any price. That's business development, not scraping. Say so to the client.

**The cheapest coverage win** is a shared `tenders@` mailbox with IMAP access.
Closed portals (Ariba, Zycus, SRM) all deliver opportunities by **email**. One
credential covers what eight scrapers cannot.

---

## 5. Configuration

**Google Sheet:** `1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY`
**Triage tab:** `Claude v3` · other tabs: `Rejected`, `Deep Analysis`, `Pipeline Watch`, `Contracts`, `Watchlist`

**Triage columns (31):**
`RowID, Captured, HumanApproval, DocumentLink, Tier, IsPanel, Service, SecurityType, Title, Location, Region, State, Budget, ContractDuration, WorkHours, Posted, Deadline, DaysToClose, RedFlags, Summary, BuyerOrg, ContactName, ContactRole, ContactEmail, ContactPhone, BidDraft, Source, Link, AribaRequest, Ref, Category, TenderType, Details`

**n8n:** Cloud, Starter plan.
- Variables are **not available** on Starter — do not use `$env` or `$vars`.
- Community nodes: **only verified ones install**. `n8n-nodes-puppeteer` is rejected.
- Secrets live in a **Custom Auth credential** named `VendorPanel Login`:
  ```json
  {"body": {"UserName": "…@gmail.com", "Password": "…"}}
  ```
  Injected into the login POST bodies. Password field has `maxlength="20"`.

**LLM:** all three chains moved from OpenRouter to **OpenAI Chat Model**
(`gpt-4.1-mini`) so n8n's 2,300/month free AI credits can pay for them.
- Classifier: `temperature 0, topP 1` — **do not change.** Non-zero temperature
  caused tier drift, where the same tender scored A one run and B the next.
- Bid draft: `0.4` · Deep analysis: `0.3`
- Budget: ~120 calls on first run, then 20–40/day. If credits run out the
  classifier fails and **everything lands in Rejected** — a failure mode that
  has already cost a day. Watch the burn rate.

**Google OAuth:** the consent screen **must be Published**, not left in Testing.
Testing mode expires refresh tokens after 7 days — this caused a
`refresh token is invalid` outage.

---

## 6. Workflow 4 — the blocker, in full

### What works
Everything up to the download:
- Two-step login (email → Next → password → Next). **No MFA.**
- OIDC redirect chain walked manually — n8n follows redirects but reports only
  the final response's headers and carries no cookies between hops, so the auth
  cookie set on the intermediate 302 was being discarded. Fixed with explicit
  hop nodes and a hand-rolled cookie jar.
- Confirmed authenticated: `idsrv.session` + `.AspNetCore.Identity.Application`
- `opportunityId` extracted from the sheet's Link:
  `tsi.axd?id=<guid32>s517599s<hash>s<n>` → `517599` (= `VP517599` in the UI)

### What blocks it
The download endpoint

```
https://www.vendorpanel.com.au/VendorDownloadOpportunityPackage.aspx?opportunityId=517599
```

returns VendorPanel's **server-error page** ("Oops! An error has occurred",
reference e.g. `DCF-4F3-260806`) when requested directly.

**This was verified in a real logged-in browser, not just from n8n.** Pasting
that URL into the address bar produces the same error. The page depends on
server-side state established by the parent tenders-list page. No HTTP client
can reach it.

### The real UI flow (captured from a HAR)
```
1. GET  VendorDownloadOpportunityPackage.aspx?opportunityId=517599   200  ← modal, via dhtmlwindow.js
2. POST same URL                                                     302  ← "Download" clicked
3. GET  FileDownloader?code=pefB2pQyAnQa8baiErU9Hi83…                302
4. GET  <guid>.zip?sv=2021-1…                                        200  ← Azure blob w/ SAS token
```

Also: the download icon is **greyed out unless the tender is Followed**. Any
automation must follow the tender first, or it only works on tenders a human
already followed by hand.

### Conclusion
Document retrieval **requires a real browser**. Options, best first:

1. **Apify** — cloud Playwright, called from n8n by plain HTTP Request. No
   community node, so the Cloud plan is not a barrier. `apify/` has a starting
   point; `robot/robot.mjs` has the correct, current flow to port.
2. **Local robot** — `robot/robot.mjs`, already updated with the real flow.
   Free, but the PC must be on.
3. **Browserless / Browserbase / Steel** — hosted browser over HTTP. Same
   pattern as Apify.
4. **Self-hosted n8n** — unlocks the Puppeteer community node.

Whichever is chosen, the flow to implement is:
```
/Members/?do=Tenders:AllTenders
  → search for the VP reference
  → Follow the tender if it shows "Follow"
  → click the ⬇ icon on that row
  → click "Download" in the modal (may be in an iframe)
  → wait up to 5 min for server-side zip building
  → save the file
```

---

## 7. Bugs already found and fixed — do not reintroduce

| Bug | Cause | Fix |
|---|---|---|
| `/s+/g` deleted every lowercase "s" ("Council i eeking tender for ite") | Escaping slip turned `/\s+/g` into `/s+/g` | Fixed; sweep any new code node for this class |
| AusTender produced zero rows | Detail-page fetch was dropped in a rebuild, leaving the LLM a one-line blurb with no location | Restored `Download ATM Page → Extract ATM Text`, gated by a prefilter |
| Goods misclassified as services ("Motor Vehicles LB320" → Tier A Cleaning) | Prompt didn't distinguish supply from work | Rule: *is the winner paid to DELIVER PRODUCTS or to DO WORK?* Panels bundling services with equipment are services panels. |
| Tier drift between runs | Non-zero temperature | `temperature: 0, topP: 1` on the classifier |
| BCC rows mangled | `mailto:` href glued onto a base URL; one rendered copy double-encoded (`&amp;nbsp;`); mirrored tables not deduped | Detect mailto, `decode(decode(h))`, normalise dedupe key to `[^a-z0-9]`. 32 rows → 11 tenders. |
| Slack showed literal `\n` | Generator emitted escaped backslash-n | Emit real newlines |
| `res.body` empty in code nodes | n8n returns the payload under `.data` when `fullResponse` is on | Shared `bodyOf()` helper reading `.body ?? .data`, handling Buffers |
| False "logged in" — twice | Cookie test matched `.AspNetCore.Antiforgery` (via `\.AspNet`), then `ASP.NET_SessionId` — both issued to anonymous visitors | Only `idsrv`, `.AspNetCore.Identity.Application`, `.AspNetCore.Cookies`, `.ASPXAUTH` count |
| Regex terminated early | `<\\/title>` — over-escaped in the generator | Verify every generated code node with `new Function(code)` before shipping |

**A note on `emcc=000000000000`:** this looks like an empty member context but
is VendorPanel's *default channel* — its own asset paths use it
(`/rebrand/000000000000/…`). Don't chase it.

---

## 8. Immediate next steps

1. **Pick a browser-automation path** (§6). Recommend Apify.
2. **Port the flow** from `robot/robot.mjs` — it already encodes the correct
   sequence including the Follow step.
3. **Have Workflow 4 call it** — replace the nodes from `One Item Per Tender`
   onward with an HTTP Request to the actor, then keep the existing
   `Upload to Drive → Build Drive Link → Write DocumentLink` tail.
4. **Re-enable the two Slack nodes** — currently disabled for debugging. Without
   them, failures are silent.
5. **Make Workflow 2's ZIP handling dynamic** — `Extract PDF (Summary)` is
   hard-wired to `file_1`, `file_2`, `file_5` inside archives. Known, unfixed.
6. **Add Gold Coast Airport** (`tenderlink.com/qldairports`) once browser
   automation exists — real source, inside the client's zone.
7. **Push the shared `tenders@` mailbox** with the client. Biggest coverage win
   available and it costs nothing.

---

## 9. Things worth knowing before you change anything

- **Workflow 1 and 2 must stay separate.** The human approval gate between them
  is the design, not an accident.
- **The Rejected tab earns its keep.** It has already diagnosed two incidents —
  proving an AusTender regression, and proving a tender was rejected by the LLM
  rather than lost to dedupe. Keep routing rejects there.
- **Local Buy was ~35% of all relevant opportunities.** Panel membership is the
  highest-value action available to the client, and panel members receive direct
  RFQs that are never publicly advertised. Non-members can't see them at all.
- **Brisbane City Council's Ariba wall is administrative, not technical.** No
  tool defeats it. The route is registration + UNSPSC category selection, and
  alerts then arrive by email — which is why the shared mailbox matters.
- **Edit generators, not generated JSON.** `scripts/build-wf4b.mjs` is the
  source of truth for Workflow 4.
- **Verify generated code before shipping**: `new Function(node.parameters.jsCode)`
  over every code node. This caught a real regex bug.

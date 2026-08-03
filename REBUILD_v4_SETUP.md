# Tender Radar v4 — rebuilt system

Complete rebuild of the tender pipeline: every source we identified in the coverage
audit, a rejection log so recall becomes measurable, silent-failure alerts, contract
expiry intelligence, and an Apify robot that removes the last manual step.

## What you import

| File | What it is | Nodes |
|---|---|---|
| `n8n_Workflow_1_v4.json` | **Discovery & Triage** — all sources → filter → dedupe → AI tiering → sheet + Slack | 44 |
| `n8n_Workflow_2_v3.json` | **Deep Analysis** — unchanged from v3, still works | 21 |
| `n8n_Workflow_3_Contract_Expiry.json` | **Contract Expiry Tracker** — weekly, finds contracts before they go to market | 10 |
| `apify/` | **VendorPanel document robot** — Playwright actor | — |

The three workflows stay separate on purpose. Workflow 1 ends at the sheet, a human
approves, Workflow 2 picks up. Workflow 3 runs on a different cadence (weekly) and
produces different output. Merging them would destroy the approval gate.

---

## Sources now wired in

| Source | How | Enabled on import |
|---|---|---|
| AusTender | RSS | ✅ Yes |
| VendorPanel | RSS — carries QLD state gov, all 77 QLD councils, QUT/JCU/UniSC/CQU | ✅ Yes |
| Brisbane City Council — open tenders | HTML scrape | ✅ Yes |
| Brisbane City Council — forward schedule | Same scrape, routed to `Pipeline Watch` | ✅ Yes |
| Watchlist (UQ, eTender QLD, LG Tenderbox, any council) | Sheet-driven, one row per site | ⬜ Needs the tab |
| Robot push (Apify / any external fetcher) | Webhook | ✅ Yes |
| Tender inbox — panel RFQs, portal notifications | IMAP | ⬜ Needs a credential |
| AusTender awarded contracts | OCDS API (Workflow 3) | ⬜ Needs an API token |

> **QTenders is deliberately absent.** Queensland migrated to VendorPanel — its
> agencies already arrive through that feed. Building a QTenders scraper would
> duplicate data and add a fragile JavaScript-rendering dependency.

---

## New sheet tabs to create

Add these tabs to the **Tender sheets** spreadsheet before the first run. Header row only.

**`Rejected`** — every filtered-out item, so you can measure what you miss
```
Logged | Source | Title | Stage | Reason | Tier | Location | Link | Snippet
```

**`Pipeline Watch`** — tenders not yet released (BCC forward schedule)
```
Logged | Source | Title | Ref | Category | ExpectedRelease | Link | Detail
```

**`Contracts`** — awarded contracts and their expiry dates
```
Logged | ContractID | Title | Buyer | Incumbent | Value | StartDate | EndDate | DaysToExpiry | MonthsToExpiry | Window | Published | Notes | Alerted
```

**`Watchlist`** — sites to sweep. Adding a university is one row, not new nodes.
```
SiteName | URL | Selector
```
Suggested starting rows:

| SiteName | URL |
|---|---|
| UQ Procurement | UQProcure public event list |
| eTender QLD | https://etender.hpw.qld.gov.au/ |
| LG Tenderbox | QLD council aggregator |

**`Claude v3`** — add these columns to your existing tab:
```
IsPanel | AribaRequest
```
(plus `BuyerOrg`, `ContactName`, `ContactRole`, `ContactEmail`, `ContactPhone` if
you haven't already added them.)

---

## Setup, in order

### 1. Import the workflows
n8n → **Import from File**, once per JSON. They import as *new* workflows, so your
current ones stay untouched until you're happy.

### 2. Re-select credentials
Credential IDs are environment-specific. Open any node showing a credential warning
and pick yours from the dropdown: Google Sheets, Slack, OpenRouter. If you import
into the same n8n instance the IDs should bind automatically.

### 3. Create the sheet tabs above

### 4. Turn on the optional sources when ready
- **Watchlist** — create the tab, open `Read Watchlist`, re-select the tab, enable the node.
- **Tender inbox** — set up a dedicated `tenders@` mailbox, point every portal
  registration at it, add an IMAP credential to `Tender Inbox (IMAP)`, enable.
- **Contract expiry** — request an AusTender API token and put it in the
  `Authorization` header of `Fetch Contract Notices` (Workflow 3).

### 5. Run Workflow 1 once by hand
Watch for: rows landing in `Claude v3`, junk landing in `Rejected`, BCC forward
items landing in `Pipeline Watch`, and a Slack alert for Tier A/B or panel tenders.

---

## What's new in Workflow 1

**Rejection log.** Every dropped item is written to the `Rejected` tab with the stage
(`keyword` or `zone/tier`) and a plain-English reason. This is what converts the
coverage estimates in the audit into real numbers — audit it weekly and you can tell
the client your actual recall instead of guessing.

**Source health alerts.** If AusTender, VendorPanel or BCC returns zero rows, Slack
gets a warning naming the source. Previously a broken scraper looked exactly like a
quiet week — this was the biggest silent risk in the system.

**Persistent dedupe.** The seen-list is read from the sheet itself rather than n8n's
static data, so it survives re-imports and manual runs, and it never re-adds a row
you've already approved.

**Panel detection.** The classifier now sets `is_panel` for standing offers,
preferred-supplier arrangements and prequalification rounds. These fire a Slack alert
regardless of tier — each panel joined converts a permanently invisible channel into
an email feed.

**Brisbane City Council, fixed.** Open tenders and the forward schedule are now
separated, the mirrored tables are collapsed keeping the copy that carries the Ariba
request link, `mailto:` links are no longer mangled into broken URLs, and the Ariba
request address is captured in an `AribaRequest` column.

**Precision filter on every source.** The classifier that took VendorPanel from 72
noisy items to ~9 real ones now runs across all sources, with word-boundary matching
so `facilities`, `biosecurity` and `cyber security` stop leaking through.

---

## The Apify robot

Lives in `apify/`. You still approve tenders by hand; this fetches the documents.

1. Read the triage sheet for `Approved` rows with an empty `DocumentLink`
2. Log into VendorPanel, open the tender, register interest, download the pack
3. Upload to Google Drive
4. Write the Drive link back into `DocumentLink`
5. Workflow 2 picks it up on its next 5-minute poll

### Deploying it
```bash
npm install -g apify-cli
apify login
cd apify
apify push
```
Then in the Apify console: open the actor → **Input** → paste the service-account
JSON, sheet ID and Drive folder ID → **Schedule** every 15–30 minutes.

### Google service account
1. Google Cloud Console → enable **Sheets API** and **Drive API**
2. Create a service account → JSON key → download
3. Share the spreadsheet with the service-account email (**Editor**)
4. Create a Drive folder for packs, share it with the same email (**Editor**), copy its ID

> Put the Drive folder in the **same Google account** as your Workflow 2 "U Agent"
> Drive credential — then Workflow 2 can read the packs without any public sharing.

### Cost
One actor on the entry tier. The free tier's ~$5/month credit covers a low-volume
trial; ~$39 USD/month (~$60 AUD) if you want headroom. This is the only genuine
Apify spend on the project — everything else runs on RSS, plain HTTP, or an open API.

---

## Honest limits

**Selectors need one tuning pass.** VendorPanel's login and download DOM is
best-effort in the actor — search `main.mjs` for `TUNE`. Run it once, read the log
(it saves screenshots to the key-value store on failure), and adjust.

**The AusTender OCDS API needs a token.** The endpoint format is confirmed
(`api.tenders.gov.au/ocds/findByDates/contractPublished/{range}`) but access requires
a token you request from AusTender. Workflow 3 will run and return nothing until
that's in place.

**Captcha or MFA stops the robot.** By design it then leaves `DocumentLink` empty, so
the existing Slack "document needed" message reaches a human. Nothing is lost, it
just isn't automatic.

**Coverage is still not 100%, and can't be.** Panel-internal RFQs, private facilities
-management tenders and strata work are never publicly advertised. The inbox source
and the panel flag attack the first of those; the other two are business-development
problems, not engineering ones.

**Confirm automated access is acceptable.** The robot logs in with the client's own
credentials to reach tenders they're entitled to see. That's normally fine, but it's
the client's call to confirm against each platform's terms.

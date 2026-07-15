# Tender Automation — Current State, Known Issues & Path to Full Automation

**Prepared by:** CJ Studio
**For:** Chief Group Services
**Scope:** SEQ Security (manpower + electronic/CCTV) & Commercial Cleaning tenders
**Status of system:** Live (assisted) — two connected n8n workflows + Google Sheet + Slack

---

## 1. How the system works today (as-is)

The system runs as **two connected pipelines** with **one human checkpoint** between them.

### Workflow 1 — Discovery & Triage (runs hourly)
1. Pulls three sources in parallel: **AusTender** (RSS), **VendorPanel** (RSS), **Brisbane City Council** (HTML scrape of the current-tenders table).
2. Normalises each into a common shape and applies a **keyword filter** (security, cleaning, guard, patrol, CCTV, facilities…).
3. **Deduplicates** against a memory of previously seen tenders (kept in workflow static data, capped at ~8,000).
4. **AI pass #1 (Gemini via OpenRouter)** classifies each tender into structured JSON: service type, location, budget, term, hours, deadline, red flags and a **Tier (A/B/C/Reject)**.
5. **In-Zone Gate** — a whitelist of ~600 QLD suburbs/postcodes within ~50 km of Brisbane/Gold Coast; drops interstate and out-of-zone.
6. **AI pass #2** drafts a first-pass Expression of Interest.
7. Appends a row to the Google Sheet (`Claude v3` tab) with `HumanApproval = Pending`.

### Human checkpoint
A reviewer changes `HumanApproval` from **Pending → Approved** on worthwhile tenders. For sources that require it (e.g. VendorPanel), the reviewer also logs into the portal, downloads the tender pack, uploads it to Google Drive, and pastes the Drive link into the `DocumentLink` column.

### Workflow 2 — Deep Analysis (polls every 5 min)
1. Reads the sheet and splits rows into two branches:
   - **Approved + DocumentLink present** → download from Drive → unzip/extract PDF & XLSX → **AI pass #3** extracts compliance, pricing structure, scope, KPIs/SLAs, submission requirements, evaluation criteria, red flags and a bid strategy → writes to the `Deep Analysis` tab → marks the row `Analyzed` → Slack "analysis ready".
   - **Approved + DocumentLink empty** → Slack "document needed".

---

## 2. What we observed in today's run (14/07/2026)

Two rows written from the **Brisbane City Council** source demonstrate the core data-quality problem:

| Field | Row 1 | Row 2 |
|---|---|---|
| Tier | B | A |
| Service | Cleaning | **Security / Electronic-CCTV** |
| Title (as stored) | "Cleaning Services Council Sites … 150+ sites around …" | **identical** "Cleaning Services Council Sites … 150+ sites around …" |
| Summary (AI) | "Supply and delivery of **cleaning chemicals** … Queensland Health facilities…" | "Tender for the maintenance of **Access Control, CCTV, Duress, Nurse Call** …" |
| Link | BCC current-tenders **index page** | same BCC **index page** |
| Deadline | 27/Jul (13 days) | 16/Jul (**2 days**) |

**Three things are wrong here:**
1. Two clearly different tenders share the **same title** — the title is boilerplate, not the tender's real name.
2. The **title, service type and summary don't agree** (title says *Cleaning*; classified *Security/CCTV*; summary about *access control maintenance*).
3. The **Link is the generic index page**, not the specific tender — the reviewer can't click through to verify or download.

This is fine for internal testing but **will not survive a client handover** — it looks unreliable and makes the human step slow and error-prone.

---

## 3. Issues, categorised (the honest list)

### A. Document access / download (the main blocker for automation)
- **A1 — VendorPanel requires authenticated login + "register interest"** before documents are accessible. A plain HTTP request cannot reach the files; it needs a **headless browser session with stored credentials** (Apify/Playwright) or an **email-based intake** (register once, receive docs by email). Today this is 100% manual.
- **A2 — AusTender packs sit behind the ATM detail page.** The RSS `link` points to the ATM page, not the file. Some attachments are public; some require an AusTender login. Partly automatable.
- **A3 — BCC links point to the index page, not the tender.** Without a real per-tender URL, auto-download is impossible and manual download is slow.

### B. Data quality / extraction
- **B1 — BCC title is sliced from raw table-row text** (`row.slice(0,140)`), so it grabs boilerplate/intro text → duplicate/wrong titles (see §2).
- **B2 — Title vs classification vs summary mismatch** — the AI is fed a whole-page/row blob instead of one tender's own detail text, so it latches onto the wrong content.
- **B3 — No per-tender deep link captured** for BCC (and weakly for others).
- **B4 — Summary can describe a different tender than the title** (same root cause as B2).

### C. Workflow / process
- **C1 — Approval is a silent manual status change.** There is no alert when a new high-tier in-zone tender lands, so the reviewer has to watch the sheet.
- **C2 — The "document needed" alert is not source-aware.** It fires the same generic message whether it's VendorPanel (needs login), AusTender, or BCC — with no source-specific steps.
- **C3 — Deadline urgency is not surfaced in alerts.** Today a Tier A closed in 2 days; nothing flagged that.
- **C4 — Deep Analysis re-reads the entire sheet every 5 minutes** and relies on status flips to avoid re-work. This does not scale and risks duplicate analysis as the sheet grows.
- **C5 — Dedupe memory is fragile** — it lives in one workflow's static data (max 8,000) and is not shared between the two workflows; it resets if the workflow is rebuilt.

### D. Reliability / governance
- **D1 — Thin error handling.** A malformed feed, a failed XML/HTML parse, or bad LLM JSON is silently dropped (falls back to `Reject`), so tenders can vanish without a trace.
- **D2 — No secure secret management defined** for the portal credentials Phase 2 will need.
- **D3 — No audit trail** distinguishing auto-approved vs human-approved, or logging download success/failure — needed for client governance.

---

## 4. The path we have chosen (current decision)

**Keep the human as the approval control point for now, but make everything around it source-aware and notification-driven — then automate the download layer source by source.**

Concretely:

1. **Route every approved tender by `Source`** (an n8n Switch node), because each portal behaves differently.
2. **Download layer, per source:**
   - **Direct-link / API-capable sources** → fetch the pack automatically → straight into Deep Analysis.
   - **Authenticated portals (VendorPanel; some councils)** → **Apify actor** logs in with stored credentials, registers interest if required, and pulls the pack; **fallback** to a precise human-action Slack notification if the portal blocks automation (captcha, T&C acceptance).
3. **Notifications become first-class** (see §5) — the reviewer is told when to act and exactly what to do, instead of watching a sheet.
4. **Apify is the chosen mechanism** for authenticated scraping/downloading, kept as a pluggable option per source.

This lets us hand the client a system that is **reliable today** and has a **clear, staged route to hands-off**, rather than an all-or-nothing rewrite.

---

## 5. Notification design (what to build for handover)

Three distinct Slack alerts, each with the tender title, **Tier**, **days-to-close**, and a working deep link:

| Trigger | Message | Purpose |
|---|---|---|
| **New Tier A/B, in-zone, on capture** (Workflow 1 end) | ":rotating_light: New {Tier} {Service} — {Title} — closes in {DaysToClose} days. Review: {sheet link}" | Act fast; don't rely on watching the sheet. |
| **Approved + source needs manual/assisted download** (Workflow 2, source-aware) | ":inbox_tray: Approved — VendorPanel pack needed. {Title}. 1) Open {deep link} 2) Register interest 3) Upload pack to Drive 4) Paste link in DocumentLink. Closes in {DaysToClose} days." | Precise, source-specific human step. |
| **Analysis ready** (already exists) | ":white_check_mark: Deep analysis complete — {Title}. Compliance, pricing, scope & strategy in the Deep Analysis tab." | Hand to final review. |

> Answering your question directly: **yes** — you should notify on **both** conditions. Notify when a **VendorPanel** tender is approved (because it needs the manual/assisted download), *and* notify on **approval generally** so nothing sits idle. Make the message source-aware so VendorPanel gets the login steps while auto-download sources just say "fetching…".

---

## 6. Steps to full automation (Phase 2)

Ordered, lowest-risk first. Each step is independently shippable.

### Step 1 — Fix the data quality first (prerequisite)
Automation on top of bad data multiplies the errors. Before auto-downloading:
- Replace the BCC raw-row slice with **targeted extraction**: capture the tender **name cell**, **closing-date cell**, and the **per-tender link** (the `<a href>` in the row) as separate fields.
- Feed the AI **one tender's own detail text**, not a page blob. For BCC, follow the per-tender link and extract that page (as we already do for AusTender).
- Add a **consistency guard**: if `service_type` conflicts with the title keywords, flag `NeedsReview` rather than writing a confident-but-wrong row.

### Step 2 — Make the pipeline source-aware
- Add a **Switch on `Source`** at the start of Workflow 2.
- Tag each source with a `download_method`: `direct`, `apify`, or `manual`.

### Step 3 — Automate the "easy" downloads
- For sources exposing **direct document URLs or an API** (AusTender ATM attachments where public; any OCDS/government API), fetch with an HTTP node → straight into extraction.

### Step 4 — Automate authenticated portals with Apify
- Build/configure an **Apify actor per portal** (VendorPanel first):
  1. Log in with credentials stored as **n8n credentials / Apify secrets** (never in the sheet).
  2. Navigate to the approved tender (using the captured deep link).
  3. Register interest / accept terms if required.
  4. Download the pack; push the file to Drive (or return it directly to n8n).
- **Fallback:** if the actor hits a captcha or a manual T&C gate, emit the **source-aware Slack notification** from §5 so a human finishes that one — nothing stalls silently.

### Step 5 — Email-based intake (robust fallback / alternative to Apify)
- Many portals **email the documents or a download link** once you register interest.
- Add a **Gmail/IMAP trigger** workflow that watches a dedicated inbox, matches the tender, extracts attachments/links, and injects them into Deep Analysis. This is often more reliable than headless scraping and survives portal UI changes.

### Step 6 — Auto-approval (optional, removes the last human step)
- Auto-set `Approved` for **Tier A + in-zone + no blocking red flags**, and route straight to download.
- Keep **Tier B/C** on manual approval.
- Log every auto-approval to an **audit column** (who/what/when) for governance.

### Step 7 — Harden for production
- Wrap fetch/parse/LLM nodes in **error branches** with retry + a "failed" Slack alert (fixes D1).
- Move dedupe memory to a **persistent store** (a sheet tab or a small DB) shared by both workflows (fixes C5).
- Convert Deep Analysis from "re-read whole sheet" to **process only new Approved rows** (fixes C4).

---

## 7. Best practices to apply

- **Secrets:** portal logins in n8n credentials / a secret manager — never in the sheet or workflow JSON.
- **Idempotency:** every tender keyed by a stable `RowID`; never process the same pack twice.
- **Human-in-the-loop only where legally/technically required** (captcha, explicit T&C acceptance) — not as a routine step.
- **Fail loud, not silent:** every drop, parse error or download failure raises a visible alert.
- **Respect portal terms of use:** automate within each portal's ToS; where a portal forbids automated download, keep the assisted (notify-and-upload) path.
- **Audit everything:** capture status, actor, timestamp and document provenance for client governance.

---

## 8. Open decisions for the client

1. **VendorPanel credentials** — provide a service account we can automate against (and confirm ToS allows automated download), or keep VendorPanel assisted (notify + manual upload)?
2. **Auto-approval** — allow Tier A in-zone to skip human approval, or keep every tender on manual approval?
3. **Compliance dealbreakers** — the exact licences/insurance/certs the AI should treat as automatic red flags.
4. **Destination** — keep Google Sheets, or push finished analysis into a CRM / bid folder?
5. **Apify vs email-intake** — preferred primary mechanism for authenticated portals (we recommend Apify primary, email-intake fallback).

---

*Next deliverable once §8 is decided: the modified n8n workflow JSON implementing source-aware routing, the three notifications, and the first Apify download path (VendorPanel).*

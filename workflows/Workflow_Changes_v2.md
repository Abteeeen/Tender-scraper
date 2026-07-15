# Workflow Changes v2 — Point-of-Contact & Lead-Gen (free) + Social Scraper (paid)

This pack contains **only the nodes that change**, as importable n8n JSON. Copy a node's
JSON, then in n8n press **Ctrl/Cmd+V** on the canvas to paste it in, and re-wire as noted.
Nothing else in your two workflows needs to change.

**Design principle — free vs paid split:**
- **Free path (works today):** the LLM extracts the *real* contact details that are already
  written in the tender (buyer org, contact officer, email, phone). Government/council tenders
  almost always list these. No scraping, no cost, no hallucinated data.
- **Paid path (Apify):** a social-scraper step takes the buyer/officer name and finds verified
  LinkedIn / Facebook / Instagram profiles + missing email/phone. This node is included but
  **disabled by default** so the workflow imports cleanly until you plug in your Apify token.

Both services (security **and** cleaning) stay equal priority — no change to the keyword or
zone logic.

---

## PART A — Workflow 1 (Discovery & Triage)

### A1. Replace the **"Basic LLM Chain"** prompt (adds contact + buyer extraction)

Only the `prompt` string changes. Paste over the existing node (same id/name/position).

```json
{
  "parameters": {
    "prompt": "=You are a tender analyst for a SECURITY (manpower guarding + electronic/CCTV) and COMMERCIAL CLEANING company based in South East Queensland (within ~50km of Brisbane and the Gold Coast). Security and cleaning are EQUAL priority.\n\nSCOPE: The company ONLY provides security and cleaning SERVICES. Do NOT treat construction, building, refurbishment, or warehouse-build projects as leads — Reject those. BUT if a tender is for security or cleaning SERVICES located AT a construction site, warehouse, depot or building, that IS a valid Security/Cleaning lead — keep it.\n\nReturn ONLY a valid JSON object (no markdown, no code fences, no prose):\n{\n  \"service_type\": \"Security | Cleaning | Both | None\",\n  \"security_type\": \"Manpower/Guarding | Electronic/CCTV | Mixed | N/A\",\n  \"summary\": \"1-2 sentence plain summary\",\n  \"location_text\": \"most specific place named e.g. 'Carrara, Gold Coast' or 'Statewide QLD'\",\n  \"state\": \"QLD | NSW | VIC | SA | WA | TAS | NT | ACT | National\",\n  \"region\": \"SEQ | QLD-statewide | QLD-other | interstate | national\",\n  \"budget_value\": \"value or 'Not Listed'\",\n  \"contract_duration\": \"e.g. '3 years + 2x1yr extension' or 'Not stated'\",\n  \"work_hours_per_week\": \"e.g. '40 hrs/week', '24/7 coverage', or 'Not stated'\",\n  \"ongoing_contract\": true or false,\n  \"deadline\": \"closing date and time exactly as written\",\n  \"close_date_iso\": \"the closing date in YYYY-MM-DD, or '' if unclear\",\n  \"red_flags\": \"licences, prequalification, certs, incumbent, insurance, etc. or 'None found'\",\n  \"buyer_org\": \"the buying organisation / council / department, exactly as named, or ''\",\n  \"contact_name\": \"the tender contact officer's full name if explicitly stated, else ''\",\n  \"contact_role\": \"their position/title if stated, else ''\",\n  \"contact_email\": \"their email if explicitly stated, else ''\",\n  \"contact_phone\": \"their phone if explicitly stated, else ''\",\n  \"tier\": \"A | B | C | Reject\"\n}\n\nCONTACT RULES: Extract buyer_org and contact_* ONLY if the value is explicitly present in the tender text. NEVER invent, guess, or infer an email/phone/name. Government and council tenders usually name a contact officer with an email and phone — capture them verbatim. If absent, return ''.\n\nSetting state and region:\n- Use the closing-time TIMEZONE as a strong state signal. 'Brisbane time' / UTC+10 with NO daylight saving = QLD. 'Canberra/Melbourne/Sydney time' or 'Hobart time' = interstate.\n- region = \"SEQ\" if within ~75km of Brisbane or the Gold Coast: Brisbane, Gold Coast, Logan, Ipswich, Redland, Moreton Bay, Caboolture, Beenleigh, Scenic Rim, Tweed, Sunshine Coast edge.\n- region = \"QLD-statewide\" if a QLD standing offer / panel / 'multiple locations' / 'Queensland' with no single fixed remote site.\n- region = \"QLD-other\" if a specific QLD location far from SEQ (Townsville, Cairns, Mackay, Rockhampton, Gladstone, Gympie, Toowoomba, Mount Isa, Torres Strait, etc.).\n- region = \"interstate\" for a specific non-QLD location. region = \"national\" for Australia-wide.\n\nsecurity_type: Manpower/Guarding for static guards, patrols, crowd control, alarm response, concierge. Electronic/CCTV for camera supply/install, access control, monitoring systems. Mixed if both. N/A for cleaning-only.\n\nTiering (keep recall HIGH; when unsure lean B or C, never invent a Reject):\n- A = security or cleaning, region SEQ or QLD-statewide, ongoing or large, no blocking red flags.\n- B = security or cleaning but smaller/one-off, OR region QLD-other or national.\n- C = security or cleaning is only a minor or incidental part of a larger tender.\n- Reject = NOT a security or cleaning service (pure construction/refurbishment, supply of goods only, IT/cyber security, unrelated professional services).\n\nTender Text:\n{{ $json.text }}"
  },
  "id": "77225775-6a74-4f88-b84e-7cf1d67591c8",
  "name": "Basic LLM Chain",
  "type": "@n8n/n8n-nodes-langchain.chainLlm",
  "typeVersion": 1,
  "position": [4460, 1220]
}
```

> **"Parse Tender JSON"** needs **no change** — it already spreads `...parsed`, so the new
> `buyer_org` / `contact_*` fields flow through automatically.

### A2. Replace the **"Format for Sheets"** node (adds 5 contact columns)

```json
{
  "parameters": {
    "jsCode": "const fmt = (d) => { try { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane' }); } catch (e) { return ''; } };\nconst capturedTs = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });\nconst today = new Date();\nreturn $input.all().map(it => {\n  const j = it.json;\n  const close = j.close_date_iso ? new Date(j.close_date_iso) : null;\n  const daysToClose = (close && !isNaN(close)) ? Math.round((close - today) / 86400000) : '';\n  return { json: {\n    RowID: (j.guid || j.link || (j.title||'')).toString().slice(0,180).replace(/[\\t\\n]/g,' '),\n    Captured: capturedTs,\n    HumanApproval: 'Pending',\n    DocumentLink: '',\n    Tier: j.tier || '',\n    Service: j.service_type || '',\n    SecurityType: j.security_type || '',\n    Title: j.title || '',\n    Location: j.location_text || '',\n    Region: j.region || '',\n    State: j.state || '',\n    Budget: j.budget_value || '',\n    ContractDuration: j.contract_duration || '',\n    WorkHours: j.work_hours_per_week || '',\n    Posted: j.posted_raw ? fmt(j.posted_raw) : '',\n    Deadline: j.deadline || '',\n    DaysToClose: daysToClose,\n    RedFlags: j.red_flags || '',\n    Summary: j.summary || '',\n    BuyerOrg: j.buyer_org || '',\n    ContactName: j.contact_name || '',\n    ContactRole: j.contact_role || '',\n    ContactEmail: j.contact_email || '',\n    ContactPhone: j.contact_phone || '',\n    BidDraft: j.bid_draft || '',\n    Source: j.source || '',\n    Link: j.link || ''\n  }};\n});"
  },
  "id": "2e43a3bf-5183-4a10-8a48-dfc6c84859f7",
  "name": "Format for Sheets",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [5540, 1440]
}
```

### A3. Google Sheet — add 5 columns + map them

1. In the **`Claude v3`** tab, add these header columns (anywhere, order doesn't matter):
   `BuyerOrg`, `ContactName`, `ContactRole`, `ContactEmail`, `ContactPhone`.
2. In the **"Google Sheets"** append node, add these 5 lines under `columns → value`:

```json
"BuyerOrg": "={{ $json.BuyerOrg }}",
"ContactName": "={{ $json.ContactName }}",
"ContactRole": "={{ $json.ContactRole }}",
"ContactEmail": "={{ $json.ContactEmail }}",
"ContactPhone": "={{ $json.ContactPhone }}"
```
(Also add matching entries in that node's `schema` array — easiest way: open the node, click
**"Refresh columns / Map automatically"** after adding the headers, and n8n will pick them up.)

---

## PART B — Workflow 2 (Deep Analysis) — contact + social enrichment

### B1. Replace the **"Deep Analysis (Gemini)"** prompt (adds the best contact to reach)

```json
{
  "parameters": {
    "prompt": "=You are a tender analyst + lead-researcher for a South East Queensland SECURITY (manpower guarding + electronic/CCTV) and COMMERCIAL CLEANING contractor. Security and cleaning are EQUAL priority. Read the full tender document below and extract the exact, contract-critical requirements AND the best human point of contact to approach. Where a value is not stated, use \"Not stated\" — never invent an email, phone or name.\n\nReturn ONLY a valid JSON object (no markdown, no code fences, no prose):\n{\n  \"compliance_requirements\": \"every licence, certification, clearance, insurance level and registration required\",\n  \"pricing_matrix\": \"the pricing/schedule-of-rates structure — line items, units, GST, escalation clauses\",\n  \"scope_of_work\": \"4-6 sentence precise description of work, sites, hours/roster and deliverables\",\n  \"kpis_slas\": \"performance indicators, response times, reporting obligations\",\n  \"submission_requirements\": \"forms, referees, page limits, lodgement method\",\n  \"evaluation_criteria\": \"assessment criteria and weightings if given\",\n  \"red_flags\": \"incumbent advantage, prequalification, unusual indemnities, tight timeframe\",\n  \"bid_strategy\": \"3-5 sentences of practical advice on positioning a competitive bid\",\n  \"buyer_org\": \"the buying organisation / council / department, exactly as named\",\n  \"buyer_website\": \"the buyer's official website/domain if present in the document, else 'Not stated'\",\n  \"best_contact_name\": \"the single best person to reach out to (tender/contract/procurement officer), else 'Not stated'\",\n  \"best_contact_role\": \"their position/title, else 'Not stated'\",\n  \"best_contact_email\": \"their email exactly as written, else 'Not stated'\",\n  \"best_contact_phone\": \"their phone exactly as written, else 'Not stated'\"\n}\n\nCONTACT RULES: Extract the contact ONLY from what is explicitly written in the document. NEVER fabricate an email, phone number or name. If several people are listed, pick the procurement/tender contact as best_contact.\n\nTender: {{ $json.title }}\n\nTENDER DOCUMENT:\n{{ $json.doc_text }}"
  },
  "id": "87077709-472e-40be-812e-8343a406ca62",
  "name": "Deep Analysis (Gemini)",
  "type": "@n8n/n8n-nodes-langchain.chainLlm",
  "typeVersion": 1,
  "position": [3840, 2980]
}
```

### B2. Replace **"Parse Deep Analysis"** (carries contact fields + prepares social queries)

```json
{
  "parameters": {
    "mode": "runOnceForEachItem",
    "jsCode": "let raw = ($json.text || '').toString().replace(/```json/gi, '').replace(/```/g, '').trim();\nlet a;\ntry { a = JSON.parse(raw); } catch (e) { a = { parse_error: true, scope_of_work: raw.slice(0, 500) }; }\nconst meta = $('Extract Drive File ID').first().json;\nconst cap = new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });\nconst org = a.buyer_org || meta.BuyerOrg || '';\nconst person = a.best_contact_name && a.best_contact_name !== 'Not stated' ? a.best_contact_name : '';\nreturn { json: {\n  RowID: meta.RowID || '',\n  Title: meta.Title || '',\n  Analyzed: cap,\n  ComplianceRequirements: a.compliance_requirements || '',\n  PricingMatrix: a.pricing_matrix || '',\n  ScopeOfWork: a.scope_of_work || '',\n  KPIs_SLAs: a.kpis_slas || '',\n  SubmissionRequirements: a.submission_requirements || '',\n  EvaluationCriteria: a.evaluation_criteria || '',\n  RedFlags: a.red_flags || '',\n  BidStrategy: a.bid_strategy || '',\n  BuyerOrg: org,\n  BuyerWebsite: a.buyer_website || 'Not stated',\n  BestContactName: a.best_contact_name || 'Not stated',\n  BestContactRole: a.best_contact_role || 'Not stated',\n  ContactEmail: a.best_contact_email || 'Not stated',\n  ContactPhone: a.best_contact_phone || 'Not stated',\n  // seed queries for the (paid) social scraper\n  social_query_linkedin: person ? (person + ' ' + org + ' LinkedIn') : (org + ' procurement LinkedIn'),\n  social_query_org: org,\n  Link: meta.Link || ''\n} };"
  },
  "id": "1c305a1e-3a26-493f-86d8-105667448b46",
  "name": "Parse Deep Analysis",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [4160, 2980]
}
```

### B3. NEW — **"Apify — Find Socials"** (PAID, disabled by default)

Paste this node in **between** `Parse Deep Analysis` and `Append to Deep Analysis Tab`.
It is `"disabled": true` so it does nothing until you (a) enable it and (b) set your Apify
token + actor. Recommended actor: an Apify **Google Search Results Scraper** or a
**LinkedIn/Company profile** actor.

```json
{
  "parameters": {
    "method": "POST",
    "url": "=https://api.apify.com/v2/acts/YOUR_ACTOR_ID/run-sync-get-dataset-items?token=YOUR_APIFY_TOKEN",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"queries\": [\n    {{ JSON.stringify($json.social_query_linkedin) }},\n    {{ JSON.stringify($json.social_query_org + ' Facebook') }},\n    {{ JSON.stringify($json.social_query_org + ' Instagram') }}\n  ],\n  \"resultsPerPage\": 3\n}",
    "options": {}
  },
  "id": "aa11bb22-cc33-dd44-ee55-ff6677889900",
  "name": "Apify - Find Socials",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4,
  "position": [4380, 3180],
  "disabled": true
}
```

### B4. NEW — **"Build Contact Card"** (merges LLM contact + any social results)

Paste after `Parse Deep Analysis` (and after `Apify - Find Socials` when that is enabled).
When the social node is disabled it simply passes the LLM-extracted contact through and leaves
the social columns blank — so it is safe on the free path.

```json
{
  "parameters": {
    "mode": "runOnceForEachItem",
    "jsCode": "// Pull optional social results if the Apify node ran; otherwise stay blank.\nlet li = '', fb = '', ig = '';\ntry {\n  const s = $('Apify - Find Socials').item.json;\n  const blob = JSON.stringify(s || {}).toLowerCase();\n  const grab = (host) => { const m = JSON.stringify(s).match(new RegExp('https?://[^\"\\\\s]*' + host + '[^\"\\\\s]*','i')); return m ? m[0] : ''; };\n  li = grab('linkedin.com');\n  fb = grab('facebook.com');\n  ig = grab('instagram.com');\n} catch (e) { /* social node disabled — free path */ }\nconst j = $json;\nconst has = (v) => v && v !== 'Not stated';\nconst confidence = has(j.ContactEmail) ? 'High (email in doc)' : (has(j.BestContactName) ? 'Medium (name only)' : (li || fb ? 'Low (social match)' : 'None'));\nreturn { json: { ...j, LinkedIn: li, Facebook: fb, Instagram: ig, ContactConfidence: confidence } };"
  },
  "id": "bb22cc33-dd44-ee55-ff66-778899001122",
  "name": "Build Contact Card",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [4380, 2980]
}
```

**Wiring:**
`Parse Deep Analysis → Build Contact Card → Append to Deep Analysis Tab`
When you enable the paid scraper, insert it in parallel:
`Parse Deep Analysis → Apify - Find Socials → Build Contact Card` (Build Contact Card reads both).

### B5. Deep Analysis tab — add columns + map them

1. In the **`Deep Analysis`** tab, add headers:
   `BuyerOrg`, `BuyerWebsite`, `BestContactName`, `BestContactRole`, `ContactEmail`,
   `ContactPhone`, `LinkedIn`, `Facebook`, `Instagram`, `ContactConfidence`.
2. In **"Append to Deep Analysis Tab"**, add these under `columns → value`:

```json
"BuyerOrg": "={{ $json.BuyerOrg }}",
"BuyerWebsite": "={{ $json.BuyerWebsite }}",
"BestContactName": "={{ $json.BestContactName }}",
"BestContactRole": "={{ $json.BestContactRole }}",
"ContactEmail": "={{ $json.ContactEmail }}",
"ContactPhone": "={{ $json.ContactPhone }}",
"LinkedIn": "={{ $json.LinkedIn }}",
"Facebook": "={{ $json.Facebook }}",
"Instagram": "={{ $json.Instagram }}",
"ContactConfidence": "={{ $json.ContactConfidence }}"
```

---

## PART C — Notes on making the FREE path give cleaner in-range results

These are optional tweaks (no new cost) to raise precision for the Brisbane/Gold-Coast 50 km range:

1. **BCC extraction is still the weak link** (boilerplate titles, index-only links — see
   `docs/Automation_Plan.md`). Until it captures per-tender name + link, expect BCC rows to be
   the noisiest. Recommend fixing BCC before enabling any auto-approval.
2. **The In-Zone Gate already drops interstate + QLD-other** — today's run correctly rejected
   Cairns, Mount Isa, Toowoomba, NSW, VIC, WA. That is working as intended.
3. To tighten further, set `KEEP_STATEWIDE = false` in the In-Zone Gate **only** if statewide
   panels (e.g. "Queensland Health, statewide") are creating noise — but note this also drops
   genuine statewide standing offers you can service from SEQ. Leave `true` for now.

---

## Summary of new lead-gen columns

| Stage | New columns |
|---|---|
| Triage (`Claude v3`) | BuyerOrg, ContactName, ContactRole, ContactEmail, ContactPhone |
| Deep Analysis | BuyerOrg, BuyerWebsite, BestContactName, BestContactRole, ContactEmail, ContactPhone, LinkedIn, Facebook, Instagram, ContactConfidence |

**Free path** fills the org/name/email/phone from the tender text (reliable, no cost).
**Paid path (Apify)** fills LinkedIn/Facebook/Instagram and boosts confidence.

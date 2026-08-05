# Tender Radar — what we need from you to go live

Two separate lists here. **Part A** is access we need to run the automation.
**Part B** is registrations *you* need to hold so the tenders are actually winnable
once we find them. Part B matters more than Part A — the radar can only surface
opportunities you're eligible to bid on.

---

## Part A — access we need from you

| # | What | Why | How to send it |
|---|---|---|---|
| A1 | **VendorPanel supplier login** (email + password) | The robot signs in as you to download tender packs. ~83% of your relevant tenders come through here. | Password manager share, or a 1-time secure note |
| A2 | **Google account** for the tender sheet + Drive folder | Where the radar writes results and stores downloaded packs | Share the sheet + a Drive folder as **Editor** with the service-account email we provide |
| A3 | **Slack workspace** (or a notification email address) | Where alerts land | Invite us to the workspace, or nominate a monitored inbox |
| A4 | **Nominated decision-maker** | One named person who ticks Approved / Rejected in the sheet daily | Name + email |
| A5 | *(optional)* **A shared mailbox** e.g. `tenders@yourcompany.com.au` | Lets us capture invitation-only tenders that arrive by email — Ariba invites, panel RFQs, incumbent renewals | IMAP credentials, or forward to an address we supply |

> **A5 is the one people skip and shouldn't.** A large share of security and cleaning
> work never appears on a public portal — it arrives as a direct RFQ to suppliers
> already on a panel. If those emails land in a monitored inbox, the radar reads
> them too. If they land in someone's personal Outlook, they're invisible to us.

### Security note
We never store your VendorPanel password in the workflow or on GitHub. It lives in
a local `.env` file on the machine running the robot, which is excluded from source
control. If you'd prefer, create a **separate VendorPanel user** under your company
account for the robot, so you can revoke it independently.

---

## Part B — portals you must be registered on

### B1. Free and mandatory — register on all of these

| Portal | Covers | Cost | Link |
|---|---|---|---|
| **VendorPanel** | Most SEQ councils (Moreton Bay, Logan, Redland, Ipswich, Gold Coast, Scenic Rim…), Local Buy panels, QLD state agencies migrating off QTenders | Free supplier account | <https://www.vendorpanel.com.au> |
| **AusTender** | All Federal Government — Defence bases, Services Australia, ATO, Border Force sites | Free | <https://www.tenders.gov.au> |
| **QTenders / Queensland Government** | State agencies. **Now migrating to VendorPanel** — register both while the transition runs | Free | <https://qtenders.epw.qld.gov.au> |
| **eTender Queensland (QBuild / Housing & Public Works)** | Government building maintenance, schools, social housing, police facilities | Free | <https://www.hpw.qld.gov.au/qbuild> |
| **Brisbane City Council — SAP Ariba** | BCC only. Not on VendorPanel, has its own walled portal | Free (SAP Business Network *Standard* account) | see B2 below |

### B2. Brisbane City Council — do this one properly, it has a trap

BCC publishes tender *titles* publicly but keeps the documents behind SAP Ariba.
No scraper can get past that — it's an administrative wall, not a technical one.
The fix is registration:

1. Complete the **Supplier Self-Registration Request** form on
   <https://www.brisbane.qld.gov.au/business/council-tenders-and-market-led-proposals/supplier-portal--sap-ariba--support>
2. Allow **2 business days** for Council to approve.
3. You'll get an email titled *"Invitation: Register to become a supplier with
   Brisbane City Council"* — **you must complete the questionnaire within 90 days**
   or the invitation expires and you start over.
4. Create a **SAP Business Network Standard** account (free). Do **not** be upsold
   to an Enterprise account — Standard is sufficient to receive and respond to
   tenders.
5. **The critical step:** during registration you pick **UNSPSC category codes**.
   BCC sends tender alerts based *only* on the codes you select. Pick the wrong
   ones and you get nothing. Select everything covering:
   - building & office cleaning / janitorial services
   - guard & protective services
   - security systems, CCTV and alarm installation & maintenance
   - grounds and facilities maintenance

   Use the portal's own category search — don't guess codes from memory, and select
   broadly rather than narrowly. Over-selecting costs you nothing but extra emails;
   under-selecting costs you the contract.

Once registered, BCC's alerts arrive by **email** — which is exactly why item **A5**
above matters. Point them at the shared mailbox and the radar picks them up.

### B3. Panels and prequalification — the highest-leverage item on this page

In our sample scan, **Local Buy accounted for roughly 35% of all relevant
opportunities.** Panel membership is not optional if you want that third.

| Scheme | What it unlocks | Notes |
|---|---|---|
| **Local Buy** (LGAQ-owned) | Pre-qualified panel for Queensland councils. Councils buy off it without going to open tender | Panels are periodic — you can only apply when a category re-opens. **Register for notification of the next cleaning and security panel refresh now.** <https://www.localbuy.net.au> |
| **QLD Government standing offer arrangements** | State agency work without per-job tendering | Via QTenders / VendorPanel |
| **QBuild prequalification (PQC)** | Government building maintenance work | Required for some HPW work |
| **Individual council supplier lists** | Direct RFQs under the tender threshold | Usually a form on each council's site |

**Being on a panel changes what you receive.** Non-panel suppliers see public
tenders only. Panel members receive direct RFQs — lower competition, faster
turnaround, and often never publicly advertised at all.

### B4. Licences and documents to have ready before bidding

Tender responses are frequently rejected on missing paperwork, not on price.
Have current copies of all of these in one folder:

**Security side (Queensland Office of Fair Trading):**
- **Security firm licence** — required to operate as a security business
- **Security provider licence Class 1** — unarmed guarding, crowd control
- **Security provider licence Class 2** — where applicable
- **Security equipment installer licence** — required for the CCTV / electronic side
- Individual licences for every guard on the roster

**Both sides:**
- ABN, current ASIC company extract
- **Public liability insurance** — most government contracts require $20M
- **WorkCover Queensland** policy
- Professional indemnity insurance
- Workplace Health & Safety management system / documented SWMS
- Referees — three comparable contracts, contactable
- Environmental and quality policies (ISO 9001 / 14001 if held — often scored)
- Modern Slavery statement if turnover triggers it
- Evidence of award-compliant wage rates (Cleaning Services Award / Security
  Services Industry Award) — increasingly audited

**Queensland Procurement Policy 2026 note:** compliance with the *Queensland
Government Supplier Code of Conduct* is now a gateway condition, and from
**1 April 2026** applies to all supplier engagements regardless of value. Read and
be able to attest to it before your next state bid.

---

## Part C — paid tender sites: our honest recommendation

**Don't subscribe to any of them yet.**

Paid aggregators (TenderLink, Australian Tenders, TenderHub, BidContender and
similar) charge a monthly fee to re-publish tenders that are *already public* on the
portals in Part B. Their pitch is convenience — one search box across many sources.
Your radar already does that, for the sources that matter to you, filtered to your
services and your 50 km radius.

Concretely: in a 492-item scan we found 23 relevant opportunities, and 19 of them
came through VendorPanel alone. A paid aggregator would have shown you the same
19, plus several hundred irrelevant ones, for a monthly fee.

**When a paid subscription *would* be worth it:**
- You expand beyond SEQ into NSW or VIC and want private-sector work
- You want **contract award history** to see who holds an incumbent contract and
  when it expires — some paid services package this well. (Our Workflow 3 already
  pulls federal contract expiries from AusTender for free; the paid value would be
  state and council awards.)
- You want tender-writing support bundled in, which some resellers offer

If you want, we'll benchmark two of them against a month of your radar's output and
show you exactly what, if anything, they caught that we didn't. That's a fairer test
than any of their marketing.

---

## Suggested order of action

1. **Today** — send us A1–A4. The radar is otherwise ready.
2. **This week** — start the BCC SAP Ariba registration (it has a 2-day approval
   step and a 90-day expiry, so don't leave it).
3. **This week** — set up the shared tenders mailbox (A5).
4. **This month** — get on Local Buy's notification list for the next cleaning and
   security panel refresh. This is the single highest-value action on this page.
5. **Ongoing** — keep the Part B4 document folder current. Expired insurance
   certificates disqualify otherwise-winning bids.

---

*Sources: [Brisbane City Council SAP Ariba supplier portal](https://www.brisbane.qld.gov.au/business/council-tenders-and-market-led-proposals/supplier-portal--sap-ariba--support) · [Local Buy](https://www.localbuy.net.au/Home) · [QLD security firm licence](https://www.qld.gov.au/law/laws-regulated-industries-and-accountability/queensland-laws-and-regulations/regulated-industries-and-licensing/regulated-industries-licensing-and-legislation/security-industry-regulation/managing-a-security-firm/apply-for-a-security-firm-licence) · [QLD security equipment installer licence](https://www.qld.gov.au/law/laws-regulated-industries-and-accountability/queensland-laws-and-regulations/regulated-industries-and-licensing/regulated-industries-licensing-and-legislation/security-industry-regulation/security-technical-licence/apply-for-a-security-equipment-installer-licence) · [Queensland Procurement Policy 2026 — MinterEllison](https://www.minterellison.com/articles/queensland-procurement-policy-2026-what-you-need-to-know)*

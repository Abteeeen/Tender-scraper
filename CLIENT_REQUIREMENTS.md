# Tender Radar — what we need from you

**What you get:** a continuously updated, filtered list of security and cleaning
tenders relevant to your business, each one with a written analysis — scope,
location, closing date, budget signals, contact details and risk flags — delivered
to a live sheet and to Slack.

**What we need:** four things. Two are contact details, two are accounts.

---

## 1. Email address — 2 minutes

The address that should receive tender alerts and have access to the live sheet.

We host the sheet on our Google Drive and invite you to it, so there's nothing to
set up on your side.

---

## 2. Slack — 2 minutes

The Slack account (or email address) to invite, so matched tenders reach you in
real time rather than only when someone opens the sheet.

If you don't use Slack, tell us and we'll send alerts by email instead.

---

## 3. n8n account — the automation platform

n8n is where the workflows run: pulling tenders from every source, filtering them
to your services and your region, and writing the analysis.

**What we need:** an **owner** or **admin** level invitation — not a standard user
login. A standard user can't import workflows or create credentials, so the setup
can't be completed from one.

- Sign up at <https://n8n.io> (Cloud) — or, if you already run n8n, just send us the
  URL and an admin invite
- Invite our email as an **Owner** / **Admin**

---

## 4. Apify account — the data collection layer

Several tender portals require a real browser session to reach the tender
documents — they can't be read by a simple web request. Apify runs that browser
automation in the cloud, on a schedule.

**Why it matters:** the alternative is running the automation on a physical
computer that has to stay switched on. Apify removes that dependency entirely — the
radar runs whether or not anyone's machine is on, including overnight and over
weekends, which is when a lot of tender activity lands.

**What we need:**
- Sign up at <https://apify.com>
- Invite our email to the account, or send us the **API token**
  (Settings → Integrations → API token)

Start on the free tier. We'll tell you if and when the volume justifies moving up a
plan, and what it would cost, before anything is charged.

---

## 5. Optional but valuable — a shared tenders mailbox

If you have (or can create) an address like **`tenders@yourcompany.com.au`** and
give us its IMAP login, we can widen your coverage significantly.

A large share of security and cleaning work is never publicly advertised — it
arrives as a direct invitation to suppliers already on a procurement panel, or as
an incumbent contract renewal. Those come by **email**, not through any portal.

- In a shared mailbox we can read → they get captured, analysed and added to your
  sheet like everything else.
- In one person's personal inbox → they're invisible to the system, and they get
  missed whenever that person is away.

Entirely your call, but it's the cheapest coverage increase available.

---

## 6. One named reviewer

The radar finds and ranks opportunities. It doesn't decide which ones you chase.

We need one person who opens the sheet and marks tenders **Approved** or
**Rejected**. The deeper analysis — full document retrieval, detailed scope
breakdown — only runs on the ones you approve, so the system stays focused on what
you actually care about.

Please nominate a name and email. Daily review is ideal; tenders routinely close
within 10 business days of publication.

---

## For your side — not something we need, but worth knowing

We deliver the opportunities and the analysis. Bidding is yours. A few things that
determine whether the opportunities we surface are actually winnable for you:

**Register on the portals** — most tenders require you to be a registered supplier
before you can download documents or submit. The main ones for your region:
VendorPanel, AusTender, QTenders, eTender Queensland, and Brisbane City Council's
SAP Ariba portal.

> **Brisbane City Council specifically:** their registration has a 2-business-day
> approval step, and the follow-up questionnaire expires after 90 days. They also
> only send tender alerts for the exact product categories you select during
> registration — select broadly across cleaning, guarding, security systems and
> facilities maintenance, or you'll receive nothing.

**Get on Local Buy** — this is the highest-value action available to you. Local Buy
is the Queensland local-government procurement panel. In our sample scan it
accounted for roughly a third of all relevant opportunities. Panel members receive
direct quote requests that are never publicly advertised; non-members only ever see
open tenders. Panels open periodically, so get on the notification list for the next
cleaning and security refresh.

**Keep your compliance folder current** — tender responses are more often rejected
on paperwork than on price. Have ready: ABN and ASIC extract, public liability
(most government contracts require $20M), WorkCover Queensland, professional
indemnity, your QLD security firm and provider licences plus the security equipment
installer licence for the electronic side, a documented WHS system, and three
contactable referees. Watch the expiry dates — a lapsed certificate disqualifies an
otherwise winning bid.

**You don't need a paid tender subscription.** Services that resell tender listings
for a monthly fee are republishing what's already free on the official portals. In
our testing, 19 of 23 relevant opportunities came through a single free source. The
radar already covers them.

---

## Summary — what to send us

| | Item | Effort |
|---|---|---|
| 1 | Email address for alerts | 2 min |
| 2 | Slack account to invite | 2 min |
| 3 | n8n account — **owner/admin** invite | 10 min |
| 4 | Apify account — invite or API token | 10 min |
| 5 | *(optional)* Shared tenders mailbox + IMAP login | 15 min |
| 6 | Name of the person who'll review the sheet | 1 min |

Once items 1–4 arrive we can have the radar running and delivering tenders.

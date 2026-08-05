# VendorPanel tender robot

Runs **on your own computer**. No server access needed, nothing to install on n8n,
no Apify, no monthly cost.

It closes the last manual gap in the pipeline:

```
You tick "Approved" in the sheet
        ↓
   THIS ROBOT: log in → download the pack → upload to Drive → write DocumentLink
        ↓
n8n Workflow 2 (already running) picks it up within 5 minutes → deep analysis
```

You still decide *which* tenders are worth pursuing. The robot only does the
click-work you'd otherwise do by hand.

---

## Setup — about 15 minutes, once

### 1. Install Node.js
Download the **LTS** version from <https://nodejs.org> and install it.
Check it worked — open Command Prompt / Terminal:
```
node --version
```

### 2. Put these files somewhere sensible
e.g. `C:\tender-robot` (Windows) or `~/tender-robot` (Mac).

### 3. Install the dependencies
```bash
cd C:\tender-robot
npm install
npx playwright install chromium
```

### 4. Google service account
The robot needs permission to read your sheet and write to Drive.

1. <https://console.cloud.google.com> → create or pick a project
2. **APIs & Services → Enable APIs** → enable **Google Sheets API** and **Google Drive API**
3. **Credentials → Create credentials → Service account** → create
4. Open it → **Keys → Add key → Create new key → JSON** → download
5. Rename the file to **`service-account.json`** and put it beside `robot.mjs`
6. Open the JSON, copy the `client_email` value (looks like `something@project.iam.gserviceaccount.com`)
7. **Share your "Tender sheets" spreadsheet** with that email as **Editor**
8. Create a Drive folder for tender packs, **share it with the same email** as **Editor**,
   and copy its ID from the URL: `drive.google.com/drive/folders/<THIS_PART>`

> Put that Drive folder in the **same Google account** as the "U Agent" Drive
> credential your Workflow 2 uses — then Workflow 2 can read the packs with no
> public sharing at all.

### 5. Create your `.env`
Copy `.env.example` to `.env` and fill it in:

```ini
VP_USER=abhiramaanil@gmail.com
VP_PASS=your-vendorpanel-password
SHEET_ID=1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY
TRIAGE_TAB=Claude v3
DRIVE_FOLDER_ID=the-folder-id-from-step-8
GOOGLE_SA_JSON_PATH=./service-account.json
HEADLESS=false
MAX_PER_RUN=5
DRY_RUN=false
```

`.env`, `service-account.json` and `session.json` are all git-ignored — they never
leave your machine.

---

## First run — watch it work

Approve a VendorPanel tender in the sheet (leave `DocumentLink` empty), then:

```bash
npm run dry
```

`dry` opens a **visible browser** and does everything **except** uploading and
writing to the sheet. You'll see it type the email, click Next, type the
password, open the tender and hunt for the download control.

Watch the terminal. It tells you exactly what it found:

```
10:42:01 Logging into VendorPanel…
10:42:04    ✓ email entered
10:42:04    → clicked Next
10:42:07    ✓ password entered
10:42:11    ✅ logged in
10:42:12 • Provision of Cleaning Services to Qld Police Service Oxley…
10:42:15    opening tender page…
10:42:18    → found 1 match(es): title/aria contains download — clicking first
10:42:21    ⬇ downloaded VP517599_TenderPack.zip
```

When that looks right:
```bash
npm run watch     # visible browser, real uploads
npm start         # headless, for scheduled runs
```

---

## Schedule it

**Windows — Task Scheduler**
1. Task Scheduler → **Create Basic Task** → name it *Tender Robot*
2. Trigger: **Daily**, repeat every **30 minutes** for 1 day
3. Action: **Start a program**
   - Program: `node`
   - Arguments: `robot.mjs`
   - Start in: `C:\tender-robot`
4. Set `HEADLESS=true` in `.env` first so no window pops up

**Mac / Linux — cron**
```bash
crontab -e
# every 30 minutes
*/30 * * * * cd ~/tender-robot && /usr/local/bin/node robot.mjs >> robot.log 2>&1
```

---

## When something goes wrong

Every failure writes a screenshot to **`./debug/`**. Open it — you'll usually see
immediately what the page was showing.

| Symptom | Cause | Fix |
|---|---|---|
| `login did not complete` | wrong password, or the form changed | check `./debug/*-login-failed.png` |
| `no download control found` | the icon selector doesn't match | send me `./debug/*-no-download-control.png` and I'll tighten it |
| `clicked, but no file came back` | the click opened a page instead of a file | same — send the screenshot |
| `Column "X" not found` | a sheet header is missing or renamed | check the `Claude v3` header row |
| Nothing happens | no rows are `Approved` with an empty `DocumentLink` | approve one and retry |

**Delete `session.json`** to force a fresh login — useful if the saved session
goes stale.

---

## Notes

- **Your computer must be on** for a scheduled run to fire. For tender work with
  weeks of lead time that's normally fine.
- The robot uses **your own VendorPanel account** to fetch tenders you're
  entitled to see. Confirm that automated access is acceptable for that account.
- If VendorPanel ever adds MFA or a captcha, the robot stops on that tender and
  leaves `DocumentLink` empty — your existing Slack "document needed" message
  still reaches a human, so nothing is lost.
- The download-control selector is deliberately broad and logs which pattern
  matched. Once we see a real run, it can be narrowed to the exact element.

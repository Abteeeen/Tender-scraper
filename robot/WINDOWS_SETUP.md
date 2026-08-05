# Windows setup — copy/paste, top to bottom

Everything below is run in **PowerShell**. Open it with `Win` → type `powershell` → Enter.

---

## Step 0 — check what you already have

```powershell
node --version
git --version
```

- `node` should print `v20.x` or `v22.x`. If it says *not recognized*, install the **LTS**
  build from <https://nodejs.org>, then **close and reopen PowerShell** and check again.
- `git` should print `git version 2.x`. If not, install from <https://git-scm.com/download/win>
  (accept every default), reopen PowerShell, check again.

---

## Step 1 — get the files

```powershell
cd C:\Users\Codev
git clone https://github.com/Abteeeen/Tender-scraper.git
cd C:\Users\Codev\Tender-scraper
git checkout claude/austender-rss-workflow-8nmfz0
cd robot
```

You should now be at `PS C:\Users\Codev\Tender-scraper\robot>`. Confirm:

```powershell
dir
```

Expect to see `robot.mjs`, `package.json`, `README.md`, `.env.example`.

> Later, to pick up fixes: `cd C:\Users\Codev\Tender-scraper` then `git pull`.
> Your `.env`, `service-account.json` and `session.json` are git-ignored, so a pull
> never overwrites them.

---

## Step 2 — install the dependencies

```powershell
npm install
npx playwright install chromium
```

The second command downloads a private copy of Chromium (~150 MB). It does not touch
the Chrome you browse with.

---

## Step 3 — Google service account

The robot needs its own Google identity to read the sheet and write to Drive.

1. Go to <https://console.cloud.google.com> and pick (or create) a project.
2. **APIs & Services → Library** → enable **Google Sheets API**, then **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → Service account** →
   name it `tender-robot` → **Create and continue** → **Done**.
4. Click the new service account → **Keys** tab → **Add key → Create new key → JSON** →
   it downloads a file.
5. Move that file into `C:\Users\Codev\Tender-scraper\robot\` and rename it to
   exactly **`service-account.json`**.
6. Open it in Notepad and copy the `"client_email"` value — it looks like
   `tender-robot@your-project.iam.gserviceaccount.com`.
7. Open your **Tender sheets** spreadsheet → **Share** → paste that email → **Editor** → Send.
8. In Google Drive, create a folder called `Tender Packs` → right-click → **Share** →
   same email → **Editor**. Open the folder and copy the ID out of the URL:
   `drive.google.com/drive/folders/`**`1AbC...xyz`** ← that part.

> Create the Drive folder in the **same Google account** whose Drive credential
> Workflow 2 already uses. Then Workflow 2 reads the packs with no public sharing.

Sanity check the file landed in the right place:

```powershell
dir service-account.json
```

---

## Step 4 — create your `.env`

```powershell
copy .env.example .env
notepad .env
```

Fill it in and save:

```ini
VP_USER=your-vendorpanel-login-email
VP_PASS=your-vendorpanel-password
SHEET_ID=1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY
TRIAGE_TAB=Claude v3
DRIVE_FOLDER_ID=paste-the-folder-id-from-step-3.8
GOOGLE_SA_JSON_PATH=./service-account.json
HEADLESS=false
MAX_PER_RUN=5
DRY_RUN=false
```

No quotes around the values, no spaces around the `=`.

---

## Step 5 — give it something to do

In the `Claude v3` tab, pick a **VendorPanel** row, set `HumanApproval` to
`Approved`, and leave `DocumentLink` **empty**. That combination is what the robot
looks for.

---

## Step 6 — first run (safe, writes nothing)

```powershell
npm run dry
```

A browser window opens and drives itself. Nothing is uploaded and nothing is written
to the sheet — this run exists purely so we can see what the page does.

Watch the terminal. A good run reads roughly:

```
1 approved tender(s) waiting for documents.
Logging into VendorPanel…
   ✓ email entered
   → clicked Next
   ✓ password entered
   ✅ logged in
• Provision of Cleaning Services to Qld Police Service Oxley…
   opening tender page…
   → found 1 match(es): title/aria contains download — clicking first
   ⬇ downloaded VP517599_TenderPack.zip
```

**Send me that terminal output.** The line starting `→ found N match(es)` tells me
which selector hit the download icon, and I'll pin it to the exact element so it
stops guessing. If it says `⚠ no download control found`, send me the PNG it wrote
into `robot\debug\` instead.

---

## Step 7 — once it works

```powershell
npm run watch    # visible browser, real uploads and sheet writes
npm start        # headless — use this for scheduled runs
```

Then schedule it (Task Scheduler steps are in `README.md`). Set `HEADLESS=true` in
`.env` first so no window pops up.

---

## If PowerShell blocks `npm`

If you see *"running scripts is disabled on this system"*:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Answer `Y`. This affects your user account only.

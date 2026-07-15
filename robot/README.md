# Step 2 — GitHub Actions browser robot (free, works with ANY n8n)

This folder is a **free browser robot** that logs into VendorPanel, downloads a
tender document pack, and hands it off to your existing n8n workflow.

**Why this instead of Step 1 (self-hosted n8n + Puppeteer)?**
It doesn't touch your n8n server at all — so it works whether your n8n is
**n8n Cloud** or **self-hosted**. GitHub runs the browser for you, free
(~2,000 minutes/month). Perfect while you're still figuring out where your
n8n is hosted.

> **First, find out where your n8n lives.** Open n8n and go to
> **Settings → Community Nodes**. If that menu exists you're *self-hosted*
> (Step 1 is possible). If it's missing, you're on *n8n Cloud* — use this
> Step 2 robot. Either way, this robot works.

---

## What's in this folder

| File | What it does |
|------|--------------|
| `download.js` | The Playwright script: login → open tender → register interest → download → POST to n8n |
| `package.json` | Declares the Playwright dependency |
| `../.github/workflows/vendorpanel.yml` | The GitHub Actions job that runs the script for free |

---

## Setup — do this once

### Step A — Add your secrets to GitHub
In this repo: **Settings → Secrets and variables → Actions → New repository secret.**
Add each of these (values are **encrypted** and never appear in the code):

| Secret name | Value |
|-------------|-------|
| `VP_EMAIL` | Your VendorPanel login email |
| `VP_PASSWORD` | Your VendorPanel password |
| `VP_LOGIN_URL` | The exact URL of the VendorPanel login page |
| `N8N_WEBHOOK_URL` | The Webhook node URL from your n8n workflow (optional — leave out to just keep the file as a download) |

> ⚠️ Never put these in the sheet, the code, or a committed file. GitHub Secrets is the only correct place.

### Step B — Find the real selectors
The script has **placeholder** CSS selectors marked `<-- confirm real selector`.
You must replace them with the real ones (this takes ~10 minutes, once):

1. Log into VendorPanel manually in Chrome.
2. Right-click the **email field** → **Inspect** → note its `id` (e.g. `#Email`).
3. Do the same for: password field, login button, "register interest" button,
   and the "download pack" link.
4. Edit `download.js` and swap each placeholder for the real selector:
   - `page.fill('#Email', ...)`         → your real email field
   - `page.fill('#Password', ...)`      → your real password field
   - `page.click('button[type="submit"]')` → your real login button
   - `page.$('#registerInterestButton')` → your real register-interest button
   - `page.click('a.download-pack')`    → your real download link

### Step C — Test it
1. Go to the **Actions** tab in this repo.
2. Pick **"VendorPanel download robot"** → **Run workflow**.
3. Paste a real tender URL into the `tender_url` box → **Run**.
4. Watch the live log. If it fails, open the run's **Artifacts** →
   `vendorpanel-output` → `failure.png` to see exactly where it stopped
   (captcha, MFA, or a wrong selector).

---

## How to trigger it in production

- **On a schedule:** uncomment the `schedule:` block in
  `../.github/workflows/vendorpanel.yml` (default: every 6 hours).
- **From n8n (recommended):** add an **HTTP Request** node in your discovery
  workflow that calls the GitHub API to launch this robot for a specific tender:

  ```
  POST https://api.github.com/repos/Abteeeen/tender-scraper/dispatches
  Headers:
    Authorization: Bearer <a GitHub personal access token with 'repo' scope>
    Accept: application/vnd.github+json
  Body (JSON):
    { "event_type": "download-tender",
      "client_payload": { "tender_url": "{{ $json.tenderUrl }}" } }
  ```

  The robot runs, downloads the pack, and POSTs it back to your
  `N8N_WEBHOOK_URL` so Workflow 2 (the AI summary chain) resumes.

---

## Optional: Google Drive instead of / as well as the webhook
Right now the file is (a) POSTed to your n8n webhook and (b) saved as a GitHub
artifact. If you'd rather upload to Google Drive, the cleanest free route is to
let **n8n** do the Drive upload (it already has your Google credentials) once it
receives the file on the webhook — no extra Google setup needed in GitHub.

---

## Honest limitations (same for every free option)
- **Captcha or MFA** on VendorPanel will stop the bot. The `failure.png`
  artifact tells you that's what happened — then a human steps in. Add a Slack/
  email alert on the n8n side for this.
- **Selectors change** when VendorPanel updates their site. They're all in one
  place (`download.js`) so a fix is quick.
- **Terms of use:** confirm automated download is acceptable to VendorPanel —
  that's a business decision for you/your client, not a technical one.

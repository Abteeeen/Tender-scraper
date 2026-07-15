# Tender fetch robot (GitHub Actions)

A free browser robot that removes the manual document step from your pipeline.

- **Job A — VendorPanel auto-download:** finds rows you marked `Approved` (with an
  empty `DocumentLink`) in the **Claude v3** sheet, logs into VendorPanel, downloads
  the tender pack, uploads it to Google Drive, and writes the Drive link back into
  `DocumentLink`. Your **Workflow 2** then runs automatically.
- **Job B — QTenders discovery:** renders the QTenders JavaScript site, keyword-filters
  the opportunities, and POSTs them to an n8n Webhook so they flow through your normal
  normalize → keyword → LLM chain.

You still **approve** tenders by hand — only the tedious download is automated.

---

## 1. Google service account

1. Google Cloud Console → create/select a project.
2. Enable **Google Sheets API** and **Google Drive API**.
3. Create a **Service Account** → **Keys** → **Add key → JSON** → download it.
4. Copy the service-account email (`…@…iam.gserviceaccount.com`).
5. Share the **Tender sheets** spreadsheet with that email (**Editor**).
6. Create a Drive folder for packs, share it with that email (**Editor**), copy its
   folder ID from the URL (`https://drive.google.com/drive/folders/<THIS_ID>`).

> **Tip:** put that Drive folder in the **same Google account** as your Workflow 2
> "U Agent" Drive credential. Then Workflow 2 can read the packs with no public
> sharing, and you can delete the `permissions.create` block in `fetch-tenders.mjs`.

## 2. GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `VENDORPANEL_USER` | your VendorPanel login email |
| `VENDORPANEL_PASS` | your VendorPanel password |
| `GOOGLE_SA_JSON` | paste the entire service-account JSON |
| `SHEET_ID` | `1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY` |
| `DRIVE_FOLDER_ID` | the folder from step 1.6 |
| `N8N_WEBHOOK_URL` | *(Job B only)* your n8n Webhook URL — see §4 |

## 3. Run it

- Automatic: every 15 minutes.
- Manual: **Actions** tab → **Tender fetch robot** → **Run workflow**.
- Watch the logs to confirm what it did. The site selectors are best-effort and
  will likely need **one round of tuning** — search the script for `// TUNE`.

## 4. QTenders → n8n webhook (Job B)

Job B pushes tenders into n8n instead of pulling. In n8n:

1. Add a **Webhook** node (method **POST**) to a workflow. Copy its **Production URL**
   into the `N8N_WEBHOOK_URL` secret.
2. Wire the Webhook into the same chain your other sources use:
   `Webhook → (Keyword filter) → Dedupe (new only) → Basic LLM Chain → …`
   The robot already sends items in your normalized shape
   (`title, link, guid, source, text, search_blob`), so no reshaping is needed.

## 5. Safety / limits

- The robot logs into **your** VendorPanel account to fetch tenders you're entitled
  to. Confirm that automated access is acceptable for your account before enabling it.
- If VendorPanel challenges the login (captcha / MFA), the robot skips that tender and
  leaves `DocumentLink` empty — your existing Slack "document needed" message is the
  fallback, so nothing is lost.
- Login pages and DOMs change; expect occasional selector maintenance (`// TUNE`).

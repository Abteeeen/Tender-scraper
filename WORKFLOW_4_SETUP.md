# Workflow 4 — VendorPanel auto-download on approval

**File:** `n8n_Workflow_4_VendorPanel_Download.json` (12 nodes)

Replaces the local robot. Runs entirely inside n8n, so no PC has to stay switched on.

```
Every 10 min → read sheet → find rows where HumanApproval = Approved
                            and DocumentLink is empty and Source = VendorPanel
   ↓
Puppeteer: log into VendorPanel, open the tender, find the pack's download URL
   ↓
HTTP Request: fetch the file using the session cookies
   ↓
Google Drive: upload  →  write the link into DocumentLink  →  Slack
   ↓
Workflow 2 picks it up on its next 5-minute poll
```

### One design decision worth knowing

Puppeteer does **not** download the file. It logs in, finds the download URL and
hands back that URL **plus the session cookies**. The plain HTTP Request node then
fetches the bytes.

Browser downloads inside n8n are awkward — the file lands in the container's
filesystem rather than in the item pipeline. Returning a URL and cookies keeps the
binary in n8n's normal flow, which is why the Drive upload just works.

---

## Setup

### 1. Install the Puppeteer community node

**Settings → Community nodes → Install** → enter:

```
n8n-nodes-puppeteer
```

Tick the box acknowledging the risks of community nodes → **Install**.

> **If your plan won't install it:** n8n Cloud only allows *verified* community
> nodes, and Puppeteer may not be on that list depending on your plan tier. If the
> install is refused, tell me — there's a fallback that uses only built-in nodes,
> and the local robot in `robot/` still works as a stopgap.

### 2. Add your VendorPanel credentials as environment variables

The script reads `$env.VP_USER` and `$env.VP_PASS` so your password never appears in
the workflow JSON, in Git, or in an execution log.

- **n8n Cloud:** Settings → **Variables** → add `VP_USER` and `VP_PASS`
- **Self-hosted:** add to your `.env` / docker-compose and restart:
  ```
  VP_USER=your-vendorpanel-email
  VP_PASS=your-vendorpanel-password
  N8N_BLOCK_ENV_ACCESS_IN_NODE=false
  ```

That last variable matters on self-hosted — n8n blocks `$env` inside Code nodes by
default, and the script will throw without it.

### 3. Connect Google (new account, so this is from scratch)

You need two credentials. Both use the same Google sign-in.

**In n8n:** Credentials → **New** → *Google Sheets OAuth2 API*

n8n shows you an **OAuth Redirect URL** — copy it, you need it in a moment.

**In Google Cloud Console** (<https://console.cloud.google.com>):
1. Create or select a project
2. **APIs & Services → Library** → enable **Google Sheets API** and **Google Drive API**
3. **APIs & Services → OAuth consent screen** → External → fill in app name and your
   email → **Add users** → add your own Google address as a test user
   *(skip this and you get `access_denied` at sign-in)*
4. **Credentials → Create credentials → OAuth client ID** → *Web application*
5. Under **Authorised redirect URIs**, paste the URL n8n gave you → **Create**
6. Copy the **Client ID** and **Client Secret**

**Back in n8n:** paste both → **Sign in with Google** → allow.

Then create a **Google Drive OAuth2 API** credential the same way — you can reuse
the same Client ID and Secret, just paste them again.

> The old account's error — *"refresh token is invalid"* — happens when the consent
> screen is left in **Testing** mode, where refresh tokens expire after 7 days.
> **Publish the consent screen** (OAuth consent screen → *Publish app*) and the
> tokens stop expiring. Do it now rather than in a week.

### 4. Point the Drive node at the right folder

Open **Upload to Drive**. The folder is deliberately left as `/ (Change me...)` so
you can't miss it. Create a **Tender Packs** folder in Drive and select it.

Use the **same Google account** for the Drive credential here and in Workflow 2 —
then Workflow 2 reads the packs with no sharing at all.

### 5. Set the Slack channel

Two Slack nodes are set to `#tenders`. Change if yours differs.

### 6. Import and test

Import the JSON, then re-select every credential — the imported IDs say
`REPLACE_ME` because credential IDs don't transfer between n8n accounts.

Then: approve one VendorPanel row in the sheet (leave `DocumentLink` empty) and hit
**Execute Workflow**.

---

## Reading the first run

Click the **VendorPanel Login + Find Pack** node's output. It tells you exactly what
happened:

| `how` | Meaning | What to do |
|---|---|---|
| `anchor href` | Found a direct link to the file | Working — nothing to do |
| `labelled anchor` | Found the download icon and its link | Working |
| `labelled element (no href — needs a click)` | Found the icon, but it triggers JavaScript rather than being a link | **Send me the `selectorHint` field** — it contains the element's HTML and I'll add a click-and-intercept step |
| `nothing matched` | Page didn't look as expected | Check `pageUrl` — if it's a login page, the credentials didn't take |
| `login failed` | Wrong username/password, or the login form changed | Check the env variables |

`selectorHint` exists precisely so the first failed run tells us how to fix it,
instead of guessing blind.

---

## What it does when it can't

If no download URL is found, the row is **not** silently dropped. It goes to
**Slack - Manual Download Needed** with the tender link and the reason, so a human
can fetch it by hand and paste the Drive link in. `DocumentLink` stays empty, so the
next run will retry it automatically — and Workflow 2's existing "document needed"
alert still fires. Nothing is lost.

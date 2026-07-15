/**
 * VendorPanel download robot (GitHub Actions edition)
 * ---------------------------------------------------
 * Runs a REAL headless Chrome via Playwright, so ASP.NET viewstate /
 * anti-forgery tokens are handled automatically (that's why plain HTTP
 * logins fail and this doesn't).
 *
 * Flow: login -> open tender -> register interest -> download pack ->
 *       send the file to your n8n webhook so Workflow 2 resumes.
 *
 * All secrets come from environment variables (GitHub Secrets).
 * NOTHING sensitive is hard-coded here.
 *
 * >>> The CSS selectors below are PLACEHOLDERS. <<<
 * Confirm each one against the real VendorPanel pages (see robot/README.md,
 * "Step B — Find the real selectors") before relying on this.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ---- Config from environment (set these as GitHub Secrets) ----
const EMAIL = process.env.VP_EMAIL;
const PASSWORD = process.env.VP_PASSWORD;
const LOGIN_URL = process.env.VP_LOGIN_URL || 'https://your-vendorpanel-login-url';
const TENDER_URL = process.env.TENDER_URL;            // the specific tender to fetch
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;  // where to hand off when done

// Fail fast with a clear message if something required is missing.
function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}
requireEnv('VP_EMAIL', EMAIL);
requireEnv('VP_PASSWORD', PASSWORD);
requireEnv('TENDER_URL', TENDER_URL);

const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // 1) LOGIN --------------------------------------------------------
    console.log('Logging in to VendorPanel...');
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
    await page.fill('#Email', EMAIL);          // <-- confirm real selector
    await page.fill('#Password', PASSWORD);    // <-- confirm real selector
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.click('button[type="submit"]'),     // <-- confirm real selector
    ]);
    console.log('Login submitted.');

    // 2) OPEN THE TENDER ---------------------------------------------
    console.log(`Opening tender: ${TENDER_URL}`);
    await page.goto(TENDER_URL, { waitUntil: 'networkidle' });

    // 3) REGISTER INTEREST (ASP.NET postback) ------------------------
    const registerBtn = await page.$('#registerInterestButton'); // <-- confirm selector
    if (registerBtn) {
      console.log('Registering interest...');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle' }),
        registerBtn.click(),
      ]);
    } else {
      console.log('No register-interest button found (already registered?). Continuing.');
    }

    // 4) DOWNLOAD THE DOCUMENT PACK ----------------------------------
    console.log('Downloading document pack...');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('a.download-pack'),           // <-- confirm real selector
    ]);
    const suggested = download.suggestedFilename() || 'tender-pack.zip';
    const filePath = path.join(DOWNLOAD_DIR, suggested);
    await download.saveAs(filePath);
    console.log(`Saved: ${filePath}`);

    // 5) HAND OFF TO n8n ---------------------------------------------
    if (N8N_WEBHOOK_URL) {
      console.log('Sending file to n8n webhook...');
      const buffer = fs.readFileSync(filePath);
      const res = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Filename': suggested,
          'X-Tender-Url': TENDER_URL,
        },
        body: buffer,
      });
      console.log(`n8n responded: ${res.status}`);
      if (!res.ok) {
        throw new Error(`n8n webhook returned ${res.status}`);
      }
    } else {
      console.log('N8N_WEBHOOK_URL not set — file kept as an Actions artifact only.');
    }

    console.log('Done.');
  } catch (err) {
    // Capture a screenshot so you can see WHERE it broke (captcha, MFA,
    // changed selector...). Uploaded as an artifact by the workflow.
    try {
      await page.screenshot({ path: path.join(DOWNLOAD_DIR, 'failure.png'), fullPage: true });
    } catch (_) { /* ignore */ }
    console.error('Robot failed:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();

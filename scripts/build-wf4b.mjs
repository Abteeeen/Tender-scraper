import fs from 'node:fs';

const SHEET_ID = '1YrekkkB-YjNAhWA1A-VYMxCcEl8A-UB5d627_zx7fEY';
const TAB = 'Claude v3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let col = 0;
const at = (row = 0) => [240 + col++ * 230, 300 + row * 200];
const cred = (t, n) => ({ [t]: { id: 'REPLACE_ME', name: n } });

const nodes = [];
const conn = {};
const link = (from, to, out = 0) => {
  conn[from] = conn[from] || { main: [] };
  while (conn[from].main.length <= out) conn[from].main.push([]);
  conn[from].main[out].push({ node: to, type: 'main', index: 0 });
};

// Shared helper source, inlined into each Code node that needs it.
const HELPERS = `
// --- tiny helpers -----------------------------------------------------------
// Merge Set-Cookie headers into a cookie jar we carry by hand. n8n's HTTP node
// has no cookie jar of its own, so we do this explicitly at every hop.
function mergeCookies(jar, setCookie) {
  const out = { ...(jar || {}) };
  const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  for (const raw of list) {
    const first = String(raw).split(';')[0];
    const eq = first.indexOf('=');
    if (eq < 1) continue;
    const name = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (!name) continue;
    if (val === '' || /expires=Thu, 01 Jan 1970/i.test(raw)) delete out[name];
    else out[name] = val;
  }
  return out;
}
const jarToHeader = (jar) => Object.entries(jar || {}).map(([k, v]) => k + '=' + v).join('; ');

// n8n returns the response payload under .body OR .data depending on how it
// parsed the content-type, and sometimes as a Buffer. Read it one way.
function bodyOf(res) {
  const raw = res?.body ?? res?.data ?? '';
  if (typeof raw === 'string') return raw;
  if (raw && raw.type === 'Buffer' && Array.isArray(raw.data)) return Buffer.from(raw.data).toString('utf8');
  return raw ? JSON.stringify(raw) : '';
}

// Pull a hidden input's value out of raw HTML.
function hidden(html, name) {
  const re = new RegExp('<input[^>]*name="' + name + '"[^>]*>', 'i');
  const tag = (html || '').match(re);
  if (!tag) return '';
  const v = tag[0].match(/value="([^"]*)"/i);
  return v ? v[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
}
`;

// ────────────────────────────────────────────────────────── 1 webhook
// A real push trigger. Google Apps Script calls this the instant someone types
// "Approved" in the sheet — no polling, no 10-minute wait.
nodes.push({
  parameters: {
    httpMethod: 'POST',
    path: 'vendorpanel-approved',
    responseMode: 'onReceived',
    responseData: 'allEntries',
    options: {},
  },
  id: 'b-hook', name: 'On Approval (Webhook)',
  type: 'n8n-nodes-base.webhook', typeVersion: 2, position: at(),
  webhookId: 'vendorpanel-approved',
});

// ────────────────────────────────────────────────────────── 2 validate
nodes.push({
  parameters: {
    jsCode: `// Apps Script posts one approved row. Validate it before we spend a login on it.
const b = $json.body || $json;

const tender = {
  rowId: String(b.rowId || '').trim(),
  title: String(b.title || '').trim(),
  ref:   String(b.ref || '').trim(),
  link:  String(b.link || '').trim(),
  source: String(b.source || '').trim(),
};

if (!/^https?:\\/\\//i.test(tender.link)) {
  throw new Error('Webhook payload has no usable Link: ' + JSON.stringify(b).slice(0, 300));
}
if (!/vendorpanel/i.test(tender.source)) {
  // Not a VendorPanel tender — nothing for this workflow to fetch.
  return [];
}

return [{ json: { tenders: [tender], count: 1 } }];`,
  },
  id: 'b-valid', name: 'Validate Payload',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 4 GET login page
nodes.push({
  parameters: {
    url: 'https://www.vendorpanel.com.au/',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'User-Agent', value: UA }] },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: true } },
      timeout: 45000,
    },
  },
  id: 'b-getlogin', name: 'GET Login Page',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
});

// ────────────────────────────────────────────────────────── 5 parse form
nodes.push({
  parameters: {
    jsCode: `${HELPERS}
const res  = $json;
const html = bodyOf(res);
const jar  = mergeCookies({}, res.headers?.['set-cookie']);

const form = {
  __RequestVerificationToken: hidden(html, '__RequestVerificationToken'),
  ReturnUrl:                  hidden(html, 'ReturnUrl'),
  ClientId:                   hidden(html, 'ClientId') || 'vp.client',
  SiteFlag:                   hidden(html, 'SiteFlag') || 'VendorPanel',
  UsernameHasBeenChecked:     'False',
  OneTimePasswordRequired:    'False',
  MFAEnrollmentRequired:      'False',
  PasswordVerified:           'False',
  ExternalLoginScheme:        '',
  ExtenalLoginDisplayName:    '',
  RememberLogin:              'false',
};

if (!form.__RequestVerificationToken) {
  // Say what actually came back, so one failed run is enough to diagnose it.
  const ct  = res.headers?.['content-type'] || '(no content-type)';
  const len = html.length;
  const hasForm = /id="loginForm"/i.test(html);
  const anyToken = /__RequestVerificationToken/i.test(html);
  throw new Error(
    'No __RequestVerificationToken found. ' +
    'status=' + (res.statusCode ?? '?') +
    ' contentType=' + ct +
    ' bodyLength=' + len +
    ' loginFormPresent=' + hasForm +
    ' tokenStringAnywhere=' + anyToken +
    ' bodyType=' + (typeof res.body) +
    ' || first300=' + JSON.stringify(String(html).slice(0, 300))
  );
}

return [{ json: {
  tenders: $('Validate Payload').first().json.tenders,
  form,
  cookieHeader: jarToHeader(jar),
  jar,
} }];`,
  },
  id: 'b-parse1', name: 'Parse Login Form',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 6 POST username
nodes.push({
  parameters: {
    method: 'POST',
    url: 'https://login.vendorpanel.com.au/account/Login',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
        { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
        { name: 'Origin', value: 'https://login.vendorpanel.com.au' },
        { name: 'Referer', value: 'https://login.vendorpanel.com.au/Account/Login' },
      ],
    },
    sendBody: true,
    contentType: 'form-urlencoded',
    bodyParameters: {
      parameters: [
        { name: 'UserName', value: '={{ $env.VP_USER }}' },
        { name: '__RequestVerificationToken', value: '={{ $json.form.__RequestVerificationToken }}' },
        { name: 'ReturnUrl', value: '={{ $json.form.ReturnUrl }}' },
        { name: 'ClientId', value: '={{ $json.form.ClientId }}' },
        { name: 'SiteFlag', value: '={{ $json.form.SiteFlag }}' },
        { name: 'UsernameHasBeenChecked', value: 'False' },
        { name: 'OneTimePasswordRequired', value: 'False' },
        { name: 'MFAEnrollmentRequired', value: 'False' },
        { name: 'PasswordVerified', value: 'False' },
        { name: 'ExternalLoginScheme', value: '' },
        { name: 'ExtenalLoginDisplayName', value: '' },
        { name: 'button', value: 'Next' },
      ],
    },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: true } },
      timeout: 45000,
    },
  },
  id: 'b-post1', name: 'POST Username',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
});

// ────────────────────────────────────────────────────────── 7 parse pw form
nodes.push({
  parameters: {
    jsCode: `${HELPERS}
const prev = $('Parse Login Form').first().json;
const res  = $json;
const html = bodyOf(res);
const jar  = mergeCookies(prev.jar, res.headers?.['set-cookie']);

// The page we get back should now be asking for a password.
const wantsPassword = /type="password"/i.test(html);
const mfa = /OneTimePassword|MFA|verification code|authenticator/i.test(html) &&
            !/name="MFAEnrollmentRequired" value="False"/i.test(html);

const form = {
  __RequestVerificationToken: hidden(html, '__RequestVerificationToken') || prev.form.__RequestVerificationToken,
  ReturnUrl:  hidden(html, 'ReturnUrl') || prev.form.ReturnUrl,
  ClientId:   hidden(html, 'ClientId') || prev.form.ClientId,
  SiteFlag:   hidden(html, 'SiteFlag') || prev.form.SiteFlag,
  UsernameHasBeenChecked: hidden(html, 'UsernameHasBeenChecked') || 'True',
  OneTimePasswordRequired: hidden(html, 'OneTimePasswordRequired') || 'False',
  MFAEnrollmentRequired:   hidden(html, 'MFAEnrollmentRequired') || 'False',
  PasswordVerified:        'False',
};

return [{ json: {
  tenders: prev.tenders,
  form,
  jar,
  cookieHeader: jarToHeader(jar),
  wantsPassword,
  mfa,
  // kept for debugging a failed run without dumping the whole page
  snippet: html.replace(/<script[\\s\\S]*?<\\/script>/gi, '').slice(0, 600),
} }];`,
  },
  id: 'b-parse2', name: 'Parse Password Form',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 8 POST password
nodes.push({
  parameters: {
    method: 'POST',
    url: 'https://login.vendorpanel.com.au/account/Login',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'User-Agent', value: UA },
        { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
        { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
        { name: 'Origin', value: 'https://login.vendorpanel.com.au' },
        { name: 'Referer', value: 'https://login.vendorpanel.com.au/Account/Login' },
      ],
    },
    sendBody: true,
    contentType: 'form-urlencoded',
    bodyParameters: {
      parameters: [
        { name: 'UserName', value: '={{ $env.VP_USER }}' },
        { name: 'Password', value: '={{ $env.VP_PASS }}' },
        { name: '__RequestVerificationToken', value: '={{ $json.form.__RequestVerificationToken }}' },
        { name: 'ReturnUrl', value: '={{ $json.form.ReturnUrl }}' },
        { name: 'ClientId', value: '={{ $json.form.ClientId }}' },
        { name: 'SiteFlag', value: '={{ $json.form.SiteFlag }}' },
        { name: 'UsernameHasBeenChecked', value: 'True' },
        { name: 'OneTimePasswordRequired', value: '={{ $json.form.OneTimePasswordRequired }}' },
        { name: 'MFAEnrollmentRequired', value: '={{ $json.form.MFAEnrollmentRequired }}' },
        { name: 'PasswordVerified', value: 'False' },
        { name: 'RememberLogin', value: 'true' },
        { name: 'button', value: 'Next' },
      ],
    },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: false } },
      timeout: 45000,
    },
  },
  id: 'b-post2', name: 'POST Password',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
});


nodes.push({
  parameters: { jsCode: `${HELPERS}
// One hop of the OIDC redirect chain. n8n follows redirects itself but reports
// only the final response's headers, so the auth cookie set on an intermediate
// 302 is lost. We follow the chain by hand, keeping every cookie.
const prev = $('Parse Password Form').first().json;
const res  = $json;
const jar  = mergeCookies(prev.jar, res.headers?.['set-cookie']);

const loc = res.headers?.location || res.headers?.Location || '';
const absolute = (u) => {
  if (!u) return '';
  if (/^https?:\\/\\//i.test(u)) return u;
  if (u.startsWith('/')) return 'https://login.vendorpanel.com.au' + u;
  return 'https://login.vendorpanel.com.au/' + u;
};

// When there's nothing left to follow, load the site root — harmless, and it
// is where the final session cookie gets issued anyway.
const nextUrl = absolute(loc) || 'https://www.vendorpanel.com.au/';

return [{ json: {
  tenders: prev.tenders,
  jar,
  cookieHeader: jarToHeader(jar),
  nextUrl,
  hadLocation: Boolean(loc),
  status: res.statusCode,
} }];` },
  id: 'b-hopA', name: 'Merge Cookies A',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(0),
});

nodes.push({
  parameters: {
    url: '={{ $json.nextUrl }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: UA },
      { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
    ] },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: false } },
      timeout: 45000,
    },
  },
  id: 'b-follow1', name: 'Follow Redirect 1',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(0),
  onError: 'continueRegularOutput',
});

nodes.push({
  parameters: { jsCode: `${HELPERS}
// One hop of the OIDC redirect chain. n8n follows redirects itself but reports
// only the final response's headers, so the auth cookie set on an intermediate
// 302 is lost. We follow the chain by hand, keeping every cookie.
const prev = $('Merge Cookies A').first().json;
const res  = $json;
const jar  = mergeCookies(prev.jar, res.headers?.['set-cookie']);

const loc = res.headers?.location || res.headers?.Location || '';
const absolute = (u) => {
  if (!u) return '';
  if (/^https?:\\/\\//i.test(u)) return u;
  if (u.startsWith('/')) return 'https://www.vendorpanel.com.au' + u;
  return 'https://www.vendorpanel.com.au/' + u;
};

// When there's nothing left to follow, load the site root — harmless, and it
// is where the final session cookie gets issued anyway.
const nextUrl = absolute(loc) || 'https://www.vendorpanel.com.au/';

return [{ json: {
  tenders: prev.tenders,
  jar,
  cookieHeader: jarToHeader(jar),
  nextUrl,
  hadLocation: Boolean(loc),
  status: res.statusCode,
} }];` },
  id: 'b-hopB', name: 'Merge Cookies B',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(0),
});

nodes.push({
  parameters: {
    url: '={{ $json.nextUrl }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: UA },
      { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
    ] },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: false } },
      timeout: 45000,
    },
  },
  id: 'b-follow2', name: 'Follow Redirect 2',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(0),
  onError: 'continueRegularOutput',
});

// ────────────────────────────────────────────────────────── 9 confirm session
nodes.push({
  parameters: {
    jsCode: `${HELPERS}
const prev = $('Merge Cookies B').first().json;
const res  = $json;
const html = bodyOf(res);
const jar  = mergeCookies(prev.jar, res.headers?.['set-cookie']);

// Signed in when we hold an identity/session cookie and are no longer being
// shown a password box.
const names = Object.keys(jar);

// Be strict about what counts as "signed in". Antiforgery, load-balancer
// affinity and RememberMe cookies all appear BEFORE authentication succeeds —
// counting them was giving a false pass and sending us to the tender page
// logged out.
// ASP.NET_SessionId and __AntiXsrfToken are issued to ANONYMOUS visitors too,
// so they prove nothing. Only an identity cookie means we are signed in.
const AUTH_COOKIE = /^(idsrv|\\.AspNetCore\\.Identity\\.Application|\\.AspNetCore\\.Cookies|\\.ASPXAUTH)/i;
const NOT_AUTH    = /antiforgery|arraffinity|rememberme|__requestverification|__antixsrf|asp\\.net_sessionid|consent/i;
const authCookies = names.filter(n => AUTH_COOKIE.test(n) && !NOT_AUTH.test(n));
const hasAuth = authCookies.length > 0;
const stillAsking = /type="password"/i.test(html);
const badCreds = /invalid|incorrect|not recognised|not recognized/i.test(html) && stillAsking;

const ok = hasAuth && !stillAsking;

return [{ json: {
  tenders: prev.tenders,
  jar,
  cookieHeader: jarToHeader(jar),
  ok,
  cookieNames: names,
  authCookies,
  pwStatus: $('POST Password').first().json.statusCode,
  pwHadLocation: Boolean($('POST Password').first().json.headers?.location),
  pwSnippet: bodyOf($('POST Password').first().json)
      .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ')
      .slice(0, 800),
  reason: ok ? '' : (badCreds ? 'credentials rejected'
        : stillAsking ? 'still on the password step (MFA, or a field the form now wants)'
        : 'no session cookie came back'),
  snippet: html.replace(/<script[\\s\\S]*?<\\/script>/gi, '').slice(0, 600),
} }];`,
  },
  id: 'b-session', name: 'Confirm Session',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 10 gate
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      conditions: [{
        id: 'logged-in',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
        leftValue: '={{ $json.ok }}', rightValue: '',
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'b-gate1', name: 'Logged In?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(),
});

// ────────────────────────────────────────── 10b establish member context
// Landing straight on the download modal makes VendorPanel throw a server
// error: the member-context cookies (emcc/emcctmp) are still all-zeros. A real
// browser visits the members' tender list first, which sets them. Do the same.
nodes.push({
  parameters: {
    url: 'https://www.vendorpanel.com.au/Members/?do=Tenders:AllTenders',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: UA },
      { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
      { name: 'Referer', value: 'https://www.vendorpanel.com.au/' },
    ] },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: true } },
      timeout: 60000,
    },
  },
  id: 'b-members', name: 'GET Members Tender List',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    jsCode: `${HELPERS}
const prev = $('Confirm Session').first().json;
const res  = $json;
const jar  = mergeCookies(prev.jar, res.headers?.['set-cookie']);

// emcc is the member context. All-zeros means none was established.
const emcc = jar.emcc || '';
const haveContext = Boolean(emcc) && !/^0+$/.test(emcc);

return [{ json: {
  tenders: prev.tenders,
  jar,
  cookieHeader: jarToHeader(jar),
  emcc,
  haveContext,
  membersStatus: res.statusCode,
} }];`,
  },
  id: 'b-memctx', name: 'Merge Member Context',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 11 fan out
nodes.push({
  parameters: {
    jsCode: `// One item per tender, each carrying the session cookie.
//
// The download endpoint keys off VendorPanel's opportunityId, which is already
// embedded in the Link the sheet stores:
//   tsi.axd?id=<guid32>s<opportunityId>s<hash>s<n>
// e.g. ...0195s517599s1be3... -> 517599, matching "VP517599" in the UI.
const s = $json;

const opportunityIdOf = (t) => {
  // 1. straight out of the link
  const m = String(t.link || '').match(/[?&]id=[0-9a-f]{32}s(\\d+)s/i);
  if (m) return m[1];
  // 2. or from a reference like VP517599
  const r = String(t.ref || '').match(/VP\\s*(\\d{4,})/i);
  if (r) return r[1];
  return '';
};

return (s.tenders || []).map((t) => {
  const opportunityId = opportunityIdOf(t);
  return { json: {
    ...t,
    cookieHeader: s.cookieHeader,
    opportunityId,
    modalUrl: opportunityId
      ? 'https://www.vendorpanel.com.au/VendorDownloadOpportunityPackage.aspx?opportunityId=' + opportunityId
      : '',
  } };
});`,
  },
  id: 'b-fan', name: 'One Item Per Tender',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 12 modal
nodes.push({
  parameters: {
    url: '={{ $json.modalUrl }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: UA },
      { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
      { name: 'Referer', value: 'https://www.vendorpanel.com.au/Members/?do=Tenders:AllTenders' },
      { name: 'X-Requested-With', value: 'XMLHttpRequest' },
    ] },
    options: {
      response: { response: { fullResponse: true, neverError: true } },
      redirect: { redirect: { followRedirects: true } },
      timeout: 60000,
    },
  },
  id: 'b-modal', name: 'GET Download Modal',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  onError: 'continueRegularOutput',
});

// ────────────────────────────────────────────────────────── 13 postback
nodes.push({
  parameters: {
    jsCode: `${HELPERS}
// The modal is a WebForms page. Clicking "Download" posts the whole form back.
// Rather than hard-code __VIEWSTATE / control names (which change between
// releases), read every field off the page and post them all back verbatim.
const out = [];
const jobs = $('One Item Per Tender').all();
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const job = jobs[i]?.json || {};
  const res = items[i].json;
  const html = bodyOf(res);

  if (!job.opportunityId) {
    out.push({ json: { ...job, ok: false, reason: 'could not work out the opportunityId from the Link' } });
    continue;
  }

  const fields = {};
  for (const m of html.matchAll(/<input\\b([^>]*)>/gi)) {
    const a = m[1];
    const name = (a.match(/name="([^"]*)"/i) || [])[1];
    if (!name) continue;
    const type = ((a.match(/type="([^"]*)"/i) || [])[1] || 'text').toLowerCase();
    const value = (a.match(/value="([^"]*)"/i) || [])[1] || '';
    const decode = (x) => x.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
                           .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                           .replace(/&#32;/g, ' ');
    if (type === 'checkbox' || type === 'radio') {
      if (/\\bchecked\\b/i.test(a)) fields[name] = decode(value);
    } else if (type === 'submit' || type === 'button' || type === 'image') {
      // only the Download button should be submitted, not Cancel/Close
      if (/download/i.test(value) || /download/i.test(name)) fields[name] = decode(value);
    } else {
      fields[name] = decode(value);
    }
  }

  const hasState = Boolean(fields.__VIEWSTATE || fields.__EVENTVALIDATION);
  const clicked = Object.keys(fields).filter((k) => /download/i.test(k) || /download/i.test(fields[k]));

  if (!hasState) {
    out.push({ json: { ...job, ok: false,
      reason: /An error has occurred|Oops/i.test(html)
        ? 'VendorPanel returned its server-error page for this request'
        : 'the download modal did not come back as a form',
      serverError: (html.match(/reference\s+([A-Z0-9-]+)/i) || [])[1] || '',
      emcc: $('Merge Member Context').first().json.emcc,
      httpStatus: res.statusCode,
      htmlLength: html.length,
      pageTitle: (html.match(/<title>([\\s\\S]*?)<\\/title>/i) || [])[1]?.replace(/\\s+/g, ' ').trim() || '',
      fieldNames: Object.keys(fields).slice(0, 30),
    } });
    continue;
  }

  const rawBody = Object.entries(fields)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  out.push({ json: { ...job, ok: true, rawBody, fieldCount: Object.keys(fields).length, clicked } });
}
return out;`,
  },
  id: 'b-postback', name: 'Build Postback',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 14 gate
nodes.push({
  parameters: {
    conditions: {
      options: { caseSensitive: true, version: 2 },
      conditions: [{
        id: 'ready',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
        leftValue: '={{ $json.ok }}', rightValue: '',
      }],
      combinator: 'and',
    },
    options: {},
  },
  id: 'b-gate2', name: 'Pack URL Found?',
  type: 'n8n-nodes-base.if', typeVersion: 2.2, position: at(),
});

// ────────────────────────────────────────────────────────── 15 download
// Posting the form returns 302 -> FileDownloader -> 302 -> an Azure blob URL
// carrying its own SAS token. Letting n8n follow that chain lands us on the
// zip itself, so this single node produces the binary.
nodes.push({
  parameters: {
    method: 'POST',
    url: '={{ $json.modalUrl }}',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'User-Agent', value: UA },
      { name: 'Cookie', value: '={{ $json.cookieHeader }}' },
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
      { name: 'Origin', value: 'https://www.vendorpanel.com.au' },
      { name: 'Referer', value: '={{ $json.modalUrl }}' },
    ] },
    sendBody: true,
    contentType: 'raw',
    rawContentType: 'application/x-www-form-urlencoded',
    body: '={{ $json.rawBody }}',
    options: {
      response: { response: { responseFormat: 'file', outputPropertyName: 'data' } },
      redirect: { redirect: { followRedirects: true, maxRedirects: 10 } },
      timeout: 300000,
    },
  },
  id: 'b-dl', name: 'Download Pack',
  type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: at(),
  onError: 'continueRegularOutput',
});

// ────────────────────────────────────────────────────────── 16 name file
nodes.push({
  parameters: {
    jsCode: `const out = [];
const jobs = $('Pack URL Found?').all();
const items = $input.all();

for (let i = 0; i < items.length; i++) {
  const job = jobs[i]?.json || {};
  const bin = items[i].binary?.data;

  const base = String(job.ref || job.rowId || job.title || 'tender')
    .slice(0, 60).replace(/[\\\\/:*?"<>|]/g, '_').trim();

  let ext = bin?.fileExtension || '';
  if (!ext) {
    const mime = bin?.mimeType || '';
    ext = /zip/i.test(mime) ? 'zip' : /pdf/i.test(mime) ? 'pdf'
        : /word|document/i.test(mime) ? 'docx' : 'bin';
  }

  out.push({ json: { ...job, fileName: base + '_pack.' + ext }, binary: items[i].binary });
}
return out;`,
  },
  id: 'b-name', name: 'Name the File',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 17 drive
nodes.push({
  parameters: {
    name: '={{ $json.fileName }}',
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: 'root', mode: 'list', cachedResultName: '/ ← CHANGE ME to Tender Packs' },
    options: {},
  },
  id: 'b-drive', name: 'Upload to Drive',
  type: 'n8n-nodes-base.googleDrive', typeVersion: 3, position: at(),
  credentials: cred('googleDriveOAuth2Api', 'Google Drive account'),
});

// ────────────────────────────────────────────────────────── 18 link
nodes.push({
  parameters: {
    jsCode: `const out = [];
const jobs = $('Name the File').all();
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const up = items[i].json;
  const job = jobs[i]?.json || {};
  const id = up.id || up.fileId;
  out.push({ json: {
    RowID: job.rowId,
    DocumentLink: id ? 'https://drive.google.com/file/d/' + id + '/view' : (up.webViewLink || ''),
    title: job.title,
  } });
}
return out;`,
  },
  id: 'b-mklink', name: 'Build Drive Link',
  type: 'n8n-nodes-base.code', typeVersion: 2, position: at(),
});

// ────────────────────────────────────────────────────────── 19 write sheet
nodes.push({
  parameters: {
    operation: 'appendOrUpdate',
    documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: TAB, mode: 'name' },
    columns: {
      mappingMode: 'defineBelow',
      value: { RowID: '={{ $json.RowID }}', DocumentLink: '={{ $json.DocumentLink }}' },
      matchingColumns: ['RowID'],
    },
    options: {},
  },
  id: 'b-write', name: 'Write DocumentLink',
  type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: at(),
  credentials: cred('googleSheetsOAuth2Api', 'Google Sheets account'),
});

// ────────────────────────────────────────────────────────── 20-22 alerts
nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=📦 *Tender pack retrieved*\n\n*{{ $json.title }}*\n{{ $json.DocumentLink }}\n\n_Deep analysis runs within 5 minutes._',
    otherOptions: {},
  },
  id: 'b-ok', name: 'Slack - Pack Ready',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: at(1),
  credentials: cred('slackApi', 'Slack account'), onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=⚠️ *VendorPanel login failed*\n\nReason: {{ $json.reason }}\nCookies seen: {{ $json.cookieNames }}\n\n_Nothing was downloaded this run._',
    otherOptions: {},
  },
  id: 'b-failLogin', name: 'Slack - Login Failed',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [240 + 9 * 230, 300 + 2 * 200],
  credentials: cred('slackApi', 'Slack account'), onError: 'continueRegularOutput',
});

nodes.push({
  parameters: {
    select: 'channel',
    channelId: { __rl: true, value: '#tenders', mode: 'name' },
    text: '=⚠️ *Could not auto-download this pack*\n\n*{{ $json.title }}*\n{{ $json.link }}\n\nReason: {{ $json.reason }}\n\n_Fetch it by hand and paste the Drive link into DocumentLink._',
    otherOptions: {},
  },
  id: 'b-failPack', name: 'Slack - Manual Download Needed',
  type: 'n8n-nodes-base.slack', typeVersion: 2.2, position: [240 + 13 * 230, 300 + 2 * 200],
  credentials: cred('slackApi', 'Slack account'), onError: 'continueRegularOutput',
});

// ────────────────────────────────────────────────────────── wiring
link('On Approval (Webhook)', 'Validate Payload');
link('Validate Payload', 'GET Login Page');
link('GET Login Page', 'Parse Login Form');
link('Parse Login Form', 'POST Username');
link('POST Username', 'Parse Password Form');
link('Parse Password Form', 'POST Password');
link('POST Password', 'Merge Cookies A');
link('Merge Cookies A', 'Follow Redirect 1');
link('Follow Redirect 1', 'Merge Cookies B');
link('Merge Cookies B', 'Follow Redirect 2');
link('Follow Redirect 2', 'Confirm Session');
link('Confirm Session', 'Logged In?');
link('Logged In?', 'GET Members Tender List', 0);
link('GET Members Tender List', 'Merge Member Context');
link('Merge Member Context', 'One Item Per Tender');
link('Logged In?', 'Slack - Login Failed', 1);
link('One Item Per Tender', 'GET Download Modal');
link('GET Download Modal', 'Build Postback');
link('Build Postback', 'Pack URL Found?');
link('Pack URL Found?', 'Download Pack', 0);
link('Pack URL Found?', 'Slack - Manual Download Needed', 1);
link('Download Pack', 'Name the File');
link('Name the File', 'Upload to Drive');
link('Upload to Drive', 'Build Drive Link');
link('Build Drive Link', 'Write DocumentLink');
link('Write DocumentLink', 'Slack - Pack Ready');

const wf = {
  name: 'Workflow 4 — VendorPanel Download (triggered on approval)',
  nodes, connections: conn,
  settings: { executionOrder: 'v1' },
  pinData: {},
};

fs.writeFileSync('/home/user/Tender-scraper/n8n_Workflow_4_VendorPanel_OnApproval.json', JSON.stringify(wf, null, 2));
console.log('wrote', nodes.length, 'nodes');

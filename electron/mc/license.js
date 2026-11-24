// Sign-in gate. The launcher works for every account of the site (a subscription is NOT needed; Premium only adds perks):
//   login(user, password)  site account sign-in (/api/auth/login) → ask /api/launcher/license for a license
//   refresh()              renew the license in the background (also notices revoked/expired keys)
//   isValid()              synchronous check used by ipc.js before anything else is allowed
// A license is a short-lived token signed by the site with an Ed25519 key. The public key is
// built into the launcher (electron/licensePublicKey.js), so it can be checked offline and a
// fake server can't forge one. It is bound to this computer (device id) and to the account.
// Honest limit: this is a client-side gate in an app the user owns — it stops casual sharing
// of the installer, it can't stop someone who patches the launcher itself.
const { app, safeStorage } = require('electron');
const { siteFetch } = require('./siteFetch');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');
const publicKeyPem = require('../licensePublicKey');
const { SITE_URL } = require('../licenseConfig');
const store = require('../store');

// A development server may sign licenses with its own key: honoured only when running from source (`npm start`), never in an installed build.
const publicKey = crypto.createPublicKey((!app.isPackaged && process.env.ETERNAL_LICENSE_PUBLIC_KEY) || publicKeyPem);
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000; // renew about once a day
const CLOCK_SLACK_MS = 2 * 60 * 60 * 1000; // a PC clock a few minutes behind the site must not lock anyone out

// Developer escape hatch: only in `npm run dev` (never in an installed build).
const devBypass = () => !app.isPackaged && process.env.ETERNAL_NO_LICENSE === '1';

// A developer's test server (ETERNAL_LICENSE_URL) does not know the real site's login: its 401 must never wipe the remembered login.
const siteOverridden = () => !app.isPackaged && !!process.env.ETERNAL_LICENSE_URL;

function siteUrl() {
  const raw = (!app.isPackaged && process.env.ETERNAL_LICENSE_URL) || SITE_URL;
  const u = new URL(raw);
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Адрес сайта должен быть https');
  return u;
}

// --- device id: stable per Windows install, not secret ---
let deviceIdCache = null;
function deviceId() {
  if (deviceIdCache) return deviceIdCache;
  let seed = '';
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 4000, windowsHide: true });
      seed = (/MachineGuid\s+REG_SZ\s+(\S+)/i.exec(r.stdout || '') || [])[1] || '';
    } catch { /* fall back below */ }
  }
  if (!seed) {
    // No machine id available: a random one kept in the config (copying the config copies it, but the stored login is DPAPI-bound anyway).
    seed = store.get('deviceSeed');
    if (!seed) { seed = crypto.randomBytes(16).toString('hex'); store.set('deviceSeed', seed); }
    seed += os.hostname();
  }
  deviceIdCache = crypto.createHash('sha256').update(`eternal-launcher-device\n${seed}`).digest('hex').slice(0, 32);
  return deviceIdCache;
}

// --- token check ---
function parseToken(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payloadB64, sig, extra] = token.split('.');
  if (!payloadB64 || !sig || extra !== undefined) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(`eternal-launcher-license\n${payloadB64}`), publicKey, Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (p.v !== 1 || typeof p.u !== 'string' || typeof p.d !== 'string' || !Number.isFinite(p.exp) || !Number.isFinite(p.iat)) return null;
    return p;
  } catch { return null; }
}

// The clock the check runs on can't go back past the last moment we saw: winding Windows back
// to extend an expired license doesn't work.
function effectiveNow() {
  const now = Date.now();
  const seen = Number(store.get('licenseSeen')) || 0;
  const t = Math.max(now, seen);
  if (t - seen > 60 * 1000) store.set('licenseSeen', t);
  return t;
}

function current() {
  const lic = store.get('license');
  if (!lic || !lic.token) return { valid: false, reason: 'none' };
  const p = parseToken(lic.token);
  if (!p) return { valid: false, reason: 'invalid' };
  if (p.d !== deviceId()) return { valid: false, reason: 'device' };
  const now = effectiveNow();
  if (p.iat - CLOCK_SLACK_MS > now) return { valid: false, reason: 'clock' };
  if (p.exp <= now) return { valid: false, reason: 'expired', username: p.u };
  return { valid: true, username: p.u, expiresAt: p.exp, subscriptionEnds: p.subEnd || null, payload: p };
}

function isValid() {
  return devBypass() || current().valid;
}

function status() {
  if (devBypass()) return { valid: true, username: 'dev', dev: true };
  const c = current();
  const { payload, ...rest } = c; // eslint-disable-line no-unused-vars
  return { ...rest, needsLogin: !store.get('licenseAuth') };
}

// --- remembered site login (DPAPI-encrypted by Windows; only this Windows user can read it) ---
function saveAuth(jwt) {
  try {
    if (safeStorage.isEncryptionAvailable()) { store.set('licenseAuth', safeStorage.encryptString(jwt).toString('base64')); return; }
  } catch { /* fall through */ }
  store.delete('licenseAuth');
}
function loadAuth() {
  const enc = store.get('licenseAuth');
  if (!enc) return null;
  try { return safeStorage.decryptString(Buffer.from(enc, 'base64')); } catch { store.delete('licenseAuth'); return null; }
}

const hasSiteAuth = () => !!loadAuth();
// The site token for requests the main process makes to the site itself (never given to the window; see mavenMirror.js).
const siteBearer = () => loadAuth();

async function api(pathname, { method = 'GET', body, bearer } = {}) {
  // The site token goes in this request: it may only ever be sent to the site itself (never to an absolute or "//host" address).
  const base = siteUrl();
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) throw new Error('Недопустимый адрес запроса');
  const url = new URL(pathname, base);
  if (url.origin !== base.origin) throw new Error('Недопустимый адрес запроса');
  const res = await siteFetch(url, () => ({
    method,
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
    headers: {
      'User-Agent': `EternalLauncher/${app.getVersion()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }));
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, data: data && typeof data === 'object' ? data : {} };
}

function storeLicense(token, username) {
  const p = parseToken(token);
  if (!p || p.d !== deviceId() || p.u !== String(username || '').toLowerCase()) throw new Error('Сервер вернул некорректную лицензию.');
  store.set('license', { token });
  store.set('licenseSeen', Math.max(Date.now(), Number(store.get('licenseSeen')) || 0));
}

async function requestLicense(jwt) {
  const r = await api('/api/launcher/license', { method: 'POST', bearer: jwt, body: { deviceId: deviceId() } });
  return r;
}

const MESSAGES = {
  no_subscription: 'Этот сервер ещё просит подписку. Обновите лаунчер или напишите в поддержку.', // only an old server answers this way
  too_many_devices: null, // the server's own text names the limit
};
function failure(r) {
  const code = r.data.code || null;
  return { ok: false, code, status: r.status, error: MESSAGES[code] || r.data.error || `Сервер ответил ${r.status}` };
}

async function login(username, password) {
  username = String(username || '').trim();
  if (!username || typeof password !== 'string' || !password) return { ok: false, error: 'Введите логин и пароль от сайта.' };
  if (username.length > 64 || password.length > 128) return { ok: false, error: 'Неверный логин или пароль.' };
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    if (!r.ok || typeof r.data.token !== 'string') return { ok: false, status: r.status, error: r.data.error || `Сервер ответил ${r.status}` };
    const lic = await requestLicense(r.data.token);
    if (!lic.ok || typeof lic.data.token !== 'string') return failure(lic);
    storeLicense(lic.data.token, r.data.username || username);
    saveAuth(r.data.token);
    return { ok: true, ...status() };
  } catch (err) {
    return { ok: false, error: networkMessage(err) };
  }
}

// ---- Sign in through Telegram (the site's bot) ----
// For accounts made through Telegram, which may have no password at all. Three steps, each its own call so the window can show progress:
//   tgStart()        asks the site for a one-time code and the bot link (t.me/<bot>?start=<code>)
//   tgStatus(code)   what the bot says so far: pending -> asked ("is it you?") -> confirmed | denied | unknown (no account on this Telegram)
//   tgFinish(code)   the confirmed code is exchanged for the site session (once, and only from the address that asked for the code),
//                    then the license is requested exactly as after a password login
// The code never leaves this process except to the site; the window only gets the code and the link (checked against the bot-link shape).
const TG_CODE_RE = /^[0-9a-f]{32}$/;
const TG_LINK_RE = /^https:\/\/t\.me\/[A-Za-z0-9_]{5,32}\?start=[0-9a-f]{32}$/;
const TG_MESSAGES = {
  telegram_off: 'Вход через Telegram сейчас недоступен. Войдите логином и паролем.',
  telegram_expired: 'Время подтверждения вышло. Нажмите «Войти через Telegram» ещё раз.',
  telegram_required: 'Вход ещё не подтверждён в Telegram.',
  telegram_ip: 'Подтверждение пришло с другого интернет-адреса (VPN или прокси переключились?). Начните вход заново.',
};
const tgFailure = (r) => ({
  ok: false, code: r.data.code || null, status: r.status, error: TG_MESSAGES[r.data.code] || r.data.error || `Сервер ответил ${r.status}`,
});

async function tgStart() {
  try {
    const r = await api('/api/auth/tg/start', { method: 'POST', body: { purpose: 'login' } });
    if (!r.ok) return tgFailure(r);
    const d = r.data;
    if (typeof d.code !== 'string' || !TG_CODE_RE.test(d.code) || typeof d.link !== 'string' || !TG_LINK_RE.test(d.link)) {
      return { ok: false, error: 'Сайт вернул неверную ссылку на Telegram.' };
    }
    return { ok: true, code: d.code, link: d.link, expiresInSec: Number(d.expiresInSec) > 0 ? Number(d.expiresInSec) : 600 };
  } catch (err) {
    return { ok: false, error: networkMessage(err) };
  }
}

async function tgStatus(code) {
  if (!TG_CODE_RE.test(String(code))) return { ok: false, error: 'Некорректный код входа.' };
  try {
    const r = await api(`/api/auth/tg/status?code=${code}`);
    if (!r.ok) return tgFailure(r);
    return { ok: true, status: String(r.data.status || ''), tgName: typeof r.data.tgName === 'string' ? r.data.tgName.slice(0, 64) : null };
  } catch (err) {
    return { ok: false, error: networkMessage(err) };
  }
}

async function tgFinish(code) {
  if (!TG_CODE_RE.test(String(code))) return { ok: false, error: 'Некорректный код входа.' };
  try {
    const r = await api('/api/auth/tg/login', { method: 'POST', body: { code } });
    if (!r.ok || typeof r.data.token !== 'string') return tgFailure(r);
    const lic = await requestLicense(r.data.token);
    if (!lic.ok || typeof lic.data.token !== 'string') return failure(lic);
    storeLicense(lic.data.token, r.data.username);
    saveAuth(r.data.token);
    return { ok: true, ...status() };
  } catch (err) {
    return { ok: false, error: networkMessage(err) };
  }
}

function networkMessage(err) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'Сайт не отвечает. Проверьте интернет и попробуйте ещё раз.';
  if (err && (err.cause || err.chromium)) {
    // The reason is named: "check the internet" alone tells a player whose DNS / provider / antivirus blocks the site nothing.
    const nodeCode = err.cause ? String(err.cause.code || err.cause.name || '').toUpperCase() : '';
    const browserCode = ((/net::(ERR_[A-Z0-9_]+)/.exec(String(err.chromium || '')) || [])[1] || '').toUpperCase();
    const code = browserCode || nodeCode;
    let hint = 'Проверьте интернет и попробуйте ещё раз.';
    if (/ENOTFOUND|EAI_AGAIN|NAME_NOT_RESOLVED/.test(code)) hint = 'Компьютер не находит адрес сайта (DNS). Смените DNS на 1.1.1.1 / 8.8.8.8 или включите VPN на весь компьютер (не расширение браузера).';
    else if (/CERT|SSL|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/.test(code)) hint = 'Не проходит защищённое соединение. Проверьте дату и время в Windows; если стоит антивирус с проверкой HTTPS — отключите её для лаунчера.';
    else if (/TIMEOUT|TIMEDOUT|TIMED_OUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|SOCKET|CONNECTION_|PROXY|TUNNEL|INTERNET_DISCONNECTED/.test(code)) hint = 'Соединение с сайтом обрывается: его может блокировать провайдер, фаервол или антивирус. Включите VPN на весь компьютер (расширение браузера лаунчеру не помогает) или добавьте лаунчер в исключения.';
    const shown = [...new Set([browserCode, nodeCode].filter(Boolean))].join(' / ');
    return `Не удалось связаться с сайтом. ${hint}${shown ? ` (${shown})` : ''}`;
  }
  return err && err.message ? err.message : 'Ошибка связи с сайтом.';
}

let refreshing = null;
// Renews the license. Offline / site down: keeps the current one until it expires.
// Revoked key / banned account / lost device slot: the license is dropped right away.
function refresh({ force = false } = {}) {
  if (devBypass()) return Promise.resolve({ ok: true, ...status() });
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const jwt = loadAuth();
      if (!jwt) return { ok: false, error: 'Нужно войти заново.', ...status() };
      const cur = current();
      if (!force && cur.valid && Date.now() - cur.payload.iat < REFRESH_AFTER_MS) return { ok: true, ...status() };
      const r = await requestLicense(jwt);
      if (r.ok && typeof r.data.token === 'string') {
        storeLicense(r.data.token, cur.username || r.data.username);
        return { ok: true, ...status() };
      }
      if (r.status === 401) { if (!siteOverridden()) store.delete('licenseAuth'); return { ok: false, error: 'Сессия на сайте истекла — войдите заново.', ...status() }; }
      // Only our own backend's verdict (JSON with an error text) takes the license away: a 403 page from a proxy/WAF
      // or a hiccup in front of the site must not lock out a paying user.
      if ([402, 403, 409].includes(r.status) && (r.data.code || r.data.error)) { store.delete('license'); return { ...failure(r), ...status() }; }
      return { ok: false, error: r.data.error || `Сервер ответил ${r.status}`, ...status() }; // 429/5xx: try later, keep what we have
    } catch (err) {
      return { ok: false, offline: true, error: networkMessage(err), ...status() };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// A call to the site as the signed-in account (skins and the like). Needs the remembered site login.
async function siteRequest(pathname, { method = 'GET', body } = {}) {
  const jwt = loadAuth();
  if (!jwt) throw new Error('Войдите в аккаунт сайта: Настройки → Аккаунт Eternal → Выйти, затем войдите снова.');
  const r = await api(pathname, { method, body, bearer: jwt });
  if (r.status === 401) {
    if (!siteOverridden()) store.delete('licenseAuth');
    throw new Error('Сессия на сайте истекла: выйдите и войдите снова (Настройки → Аккаунт Eternal).');
  }
  return r;
}

function logout() {
  store.delete('license');
  store.delete('licenseAuth');
  return { ok: true, ...status() };
}

module.exports = {
  isValid, status, login, tgStart, tgStatus, tgFinish, refresh, logout, siteRequest, siteUrl, hasSiteAuth, siteBearer,
};

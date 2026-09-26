import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const base = path.dirname(fileURLToPath(import.meta.url));
const records = path.join(base, 'propositions.json');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const publicOrigin = process.env.PUBLIC_ORIGIN || null;
const secureCookie = publicOrigin?.startsWith('https://') || process.env.COOKIE_SECURE === '1';

// Le mot de passe n'est pas écrit en clair dans le code. Pour le changer,
// configurez ADMIN_PASSWORD et retirez la valeur par défaut ci-dessous.
const passwordSalt = 'c2b63ba4cb4d499b6832716f420f5350';
const passwordKey = Buffer.from('c3f7bebaa8f34f6f996ebf0051907d00a13240eda9db7285b288a9a4634d80b27e2ecc15aa8b0962057ecc7167082823202bc3a1705d2ebd97ad1937df82cb80', 'hex');
const scrypt = promisify(crypto.scrypt);
const sessions = new Map();
const failedLogins = new Map();
const submissions = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const SESSION_AGE = 8 * 60 * 60 * 1000;

let items = [];
try {
  const saved = JSON.parse(await fs.readFile(records, 'utf8'));
  if (!Array.isArray(saved) || !saved.every(item =>
    Number.isSafeInteger(item.id) && item.id > 0 &&
    typeof item.title === 'string' && typeof item.body === 'string'
  )) throw new Error('Le fichier propositions.json est invalide.');
  items = saved;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let nextId = Math.max(0, ...items.map(item => item.id)) + 1;
let writeQueue = Promise.resolve();

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/assets/site.css': ['assets/site.css', 'text/css; charset=utf-8'],
  '/assets/site.js': ['assets/site.js', 'text/javascript; charset=utf-8'],
  '/assets/affiche.png': ['assets/affiche.png', 'image/png'],
  '/assets/portrait.jpg': ['assets/portrait.jpg', 'image/jpeg'],
  '/assets/chat.jpg': ['assets/chat.jpg', 'image/jpeg']
};

const securityHeaders = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

function send(res, status, data, extra = {}) {
  res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
}

function problem(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function limit(map, key, max, windowMs, record = true) {
  const now = Date.now();
  const previous = map.get(key);
  const state = previous && previous.until > now ? previous : { count: 0, until: now + windowMs };
  if (state.count >= max) return Math.ceil((state.until - now) / 1000);
  if (record) { state.count++; map.set(key, state); }
  // Évite que la mémoire grossisse sans limite sur un serveur longtemps ouvert.
  if (map.size > 10000) for (const [ip, value] of map) if (value.until <= now) map.delete(ip);
  return 0;
}

function isAdmin(req) {
  const token = (req.headers.cookie || '').match(/(?:^|;\s*)zel_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return false;
  const until = sessions.get(token);
  if (!until) return false;
  if (until <= Date.now()) { sessions.delete(token); return false; }
  return true;
}

function checkOrigin(req) {
  const expected = publicOrigin || `http://${req.headers.host}`;
  if (!req.headers.origin || req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') {
    throw problem(403, 'Requête refusée : origine non reconnue.');
  }
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
    throw problem(415, 'Format attendu : application/json.');
  }
  if (Number(req.headers['content-length']) > 4096) throw problem(413, 'Message trop long.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw problem(413, 'Message trop long.');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch {
    throw problem(400, 'JSON invalide.');
  }
}

function validProposal(value) {
  return typeof value.title === 'string' && value.title.trim().length >= 3 && value.title.length <= 90 &&
    typeof value.body === 'string' && value.body.trim().length >= 3 && value.body.length <= 500;
}

function save(change) {
  const operation = writeQueue.catch(() => {}).then(async () => {
    const next = items.map(item => ({ ...item }));
    const result = change(next);
    const temporary = records + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(temporary, records);
    items = next;
    return result;
  });
  writeQueue = operation;
  return operation;
}

const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local.invalid').pathname;
    const file = staticFiles[pathname];
    if (req.method === 'GET' && file) {
      const bytes = await fs.readFile(path.join(base, file[0]));
      res.writeHead(200, { ...securityHeaders, 'content-type': file[1], 'cache-control': file[0] === 'index.html' ? 'no-store' : 'public, max-age=3600' });
      return res.end(bytes);
    }

    if (!pathname.startsWith('/api/')) return send(res, 404, { error: 'Introuvable.' });
    if (req.method !== 'GET') checkOrigin(req);
    const ip = req.socket.remoteAddress || 'unknown'; // Ne jamais faire confiance à X-Forwarded-For ici.

    if (pathname === '/api/login' && req.method === 'POST') {
      const retry = limit(failedLogins, ip, 5, LOGIN_WINDOW, false);
      if (retry) return send(res, 429, { error: 'Trop d’essais. Réessayez dans quelques minutes.' }, { 'retry-after': String(retry) });
      const data = await readBody(req);
      const password = typeof data.password === 'string' && data.password.length <= 256 ? data.password : '';
      const candidate = await scrypt(password, passwordSalt, 64);
      // Si ADMIN_PASSWORD est fourni, il remplace le mot de passe initial.
      const expected = process.env.ADMIN_PASSWORD
        ? await scrypt(process.env.ADMIN_PASSWORD, passwordSalt, 64)
        : passwordKey;
      if (!crypto.timingSafeEqual(candidate, expected)) {
        limit(failedLogins, ip, 5, LOGIN_WINDOW);
        return send(res, 401, { error: 'Mot de passe incorrect.' });
      }
      failedLogins.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + SESSION_AGE);
      const cookie = `zel_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie ? '; Secure' : ''}`;
      return send(res, 200, { ok: true }, { 'set-cookie': cookie });
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      const token = (req.headers.cookie || '').match(/(?:^|;\s*)zel_admin=([a-f0-9]{64})(?:;|$)/)?.[1];
      if (token) sessions.delete(token);
      return send(res, 200, { ok: true }, { 'set-cookie': `zel_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie ? '; Secure' : ''}` });
    }

    if (pathname === '/api/proposals' && req.method === 'GET') {
      return send(res, 200, { items: [...items].reverse().slice(0, 200), admin: isAdmin(req) });
    }

    if (pathname === '/api/proposals' && req.method === 'POST') {
      const retry = limit(submissions, ip, 10, 10 * 60 * 1000, false);
      if (retry) return send(res, 429, { error: 'Trop de propositions. Réessayez plus tard.' }, { 'retry-after': String(retry) });
      const data = await readBody(req);
      if (!validProposal(data)) return send(res, 400, { error: 'Indiquez un titre et un texte de 3 caractères minimum.' });
      await save(next => next.push({ id: nextId++, title: data.title.trim(), body: data.body.trim() }));
      limit(submissions, ip, 10, 10 * 60 * 1000);
      return send(res, 201, { ok: true });
    }

    const match = pathname.match(/^\/api\/proposals\/(\d+)$/);
    if (match && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!isAdmin(req)) return send(res, 403, { error: 'Accès réservé à la modération.' });
      const id = Number(match[1]);
      if (!Number.isSafeInteger(id)) return send(res, 400, { error: 'Identifiant invalide.' });
      if (!items.some(item => item.id === id)) return send(res, 404, { error: 'Proposition introuvable.' });
      if (req.method === 'DELETE') {
        await save(next => next.splice(next.findIndex(item => item.id === id), 1));
        return send(res, 200, { ok: true });
      }
      const data = await readBody(req);
      if (!validProposal(data)) return send(res, 400, { error: 'Indiquez un titre et un texte de 3 caractères minimum.' });
      await save(next => {
        const item = next.find(item => item.id === id);
        item.title = data.title.trim();
        item.body = data.body.trim();
      });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Introuvable.' });
  } catch (error) {
    if (!error.status) console.error(error);
    return send(res, error.status || 500, { error: error.status ? error.message : 'Une erreur est survenue. Réessayez.' });
  }
});

server.listen(port, host, () => console.log(`Zeloryon : http://${host}:${port}`));

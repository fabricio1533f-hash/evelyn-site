// SyncPay backend for the customized checkout.
// Node 18+ (Node 22 recommended). No external npm dependencies are required.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.SYNCPAY_BASE_URL || 'https://api.syncpayments.com.br';
const CLIENT_ID = process.env.SYNCPAY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SYNCPAY_CLIENT_SECRET || '';
const WEBHOOK_SECRET = process.env.SYNCPAY_WEBHOOK_SECRET || '';
const WEBHOOK_SECRET_OLD = process.env.SYNCPAY_WEBHOOK_SECRET_ANTERIOR || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const SITE_DIR = __dirname;
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');

const PLANS = {
  '30-dias': { amount: 11.90, label: '30 DIAS' },
  '3-meses': { amount: 18.90, label: '3 MESES' },
  '1-ano': { amount: 49.90, label: '1 ANO' },
};

let tokenCache = { token: '', expiresAt: 0 };

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function ensureDataFile() {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '{}');
}

function readOrders() {
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8') || '{}'); }
  catch { return {}; }
}

function writeOrders(orders) {
  ensureDataFile();
  const tmp = `${ORDERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_FILE);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function readBody(req, maxBytes = 100_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function getAccessToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('SyncPay credentials are not configured on the server.');
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 30_000) return tokenCache.token;

  const response = await fetch(`${BASE_URL}/api/partner/v1/auth-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`SyncPay auth failed (${response.status}): ${JSON.stringify(data)}`);
  }
  tokenCache = {
    token: data.access_token,
    expiresAt: data.expires_at ? Date.parse(data.expires_at) : now + (Number(data.expires_in || 3600) * 1000),
  };
  return tokenCache.token;
}

function validCpf(value) {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(cpf[10]);
}

function normalizeCustomer(input) {
  return {
    name: String(input?.name || '').trim().slice(0, 120),
    email: String(input?.email || '').trim().toLowerCase().slice(0, 180),
    cpf: String(input?.cpf || '').replace(/\D/g, '').slice(0, 11),
    phone: String(input?.phone || '').replace(/\D/g, '').slice(0, 20),
  };
}

function safeEqualHex(expected, actual) {
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(actual, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function verifyWebhook(signature, rawBody) {
  const secrets = [WEBHOOK_SECRET, WEBHOOK_SECRET_OLD].filter(Boolean);
  if (!signature || secrets.length === 0) return false;
  const parts = Object.fromEntries(String(signature).split(',').map(p => {
    const [k, ...rest] = p.split('=');
    return [k?.trim(), rest.join('=').trim()];
  }));
  const timestamp = Number(parts.t || 0);
  const received = parts.v1 || '';
  if (!timestamp || !received) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;
  return secrets.some(secret => {
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return safeEqualHex(expected, received);
  });
}

async function createPix(body) {
  const plan = PLANS[body.plan];
  if (!plan) throw Object.assign(new Error('Plano inválido.'), { status: 400 });

  // The server is authoritative for the price; do not trust the amount sent by the browser.
  const customer = normalizeCustomer(body.customer);
  if (customer.name.length < 2) throw Object.assign(new Error('Informe seu nome.'), { status: 422 });
  if (!/^\S+@\S+\.\S+$/.test(customer.email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 422 });
  if (!validCpf(customer.cpf)) throw Object.assign(new Error('Informe um CPF válido.'), { status: 422 });
  if (customer.phone.length < 10) throw Object.assign(new Error('Informe um telefone válido.'), { status: 422 });

  const token = await getAccessToken();
  const description = `Evelyn - ${plan.label}`;
  // Payment status is received through the signed global `transaction` webhook.
  // Do not put webhook credentials or secrets in the browser.
  const payload = {
    amount: plan.amount,
    description,
    client: customer,
  };

  const response = await fetch(`${BASE_URL}/api/partner/v1/cash-in`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    tokenCache = { token: '', expiresAt: 0 };
  }
  if (!response.ok || !data.identifier || !data.pix_code) {
    throw Object.assign(new Error(`SyncPay cash-in failed (${response.status}): ${JSON.stringify(data)}`), { status: response.status || 502 });
  }

  const orders = readOrders();
  orders[data.identifier] = {
    identifier: data.identifier,
    plan: body.plan,
    amount: plan.amount,
    status: 'pending',
    customer: { name: customer.name, email: customer.email, phone: customer.phone },
    createdAt: new Date().toISOString(),
  };
  writeOrders(orders);

  return { identifier: data.identifier, pix_code: data.pix_code, amount: plan.amount, label: plan.label };
}

function handleWebhook(rawBody, req) {
  if (!verifyWebhook(req.headers['x-syncpay-signature'], rawBody)) {
    return { status: 401, body: { error: 'invalid_signature' } };
  }
  let event;
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: { error: 'invalid_json' } }; }

  const tx = event.transaction || {};
  const identifier = tx.reference_id || event.identifier || event.id;
  if (identifier) {
    const orders = readOrders();
    if (orders[identifier]) {
      orders[identifier].status = tx.status || orders[identifier].status;
      orders[identifier].updatedAt = new Date().toISOString();
      if (tx.paid_at) orders[identifier].paidAt = tx.paid_at;
      writeOrders(orders);
    }
  }
  return { status: 200, body: { received: true } };
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? path.join(SITE_DIR, 'index.htm') : path.join(SITE_DIR, pathname.replace(/^\//, ''));
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(SITE_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return sendJson(res, 404, { error: 'not_found' });
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.htm': 'text/html; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/create-pix') {
      const body = JSON.parse(await readBody(req));
      const result = await createPix(body);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/status/')) {
      const identifier = decodeURIComponent(url.pathname.slice('/api/status/'.length));
      const order = readOrders()[identifier];
      if (!order) return sendJson(res, 404, { error: 'order_not_found' });
      return sendJson(res, 200, { identifier, status: order.status, paidAt: order.paidAt || null });
    }

    if (req.method === 'POST' && url.pathname === '/webhooks/syncpay') {
      const raw = await readBody(req);
      const result = handleWebhook(raw, req);
      return sendJson(res, result.status, result.body);
    }

    if (req.method === 'GET') return serveStatic(req, res, url.pathname);
    return sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    console.error(error);
    return sendJson(res, error.status || 500, { error: error.message || 'internal_error' });
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Evelyn checkout running on http://localhost:${PORT}`);
  if (!CLIENT_ID || !CLIENT_SECRET) console.warn('SyncPay credentials are not configured. Create a .env file from .env.example.');
  if (!PUBLIC_BASE_URL) console.warn('PUBLIC_BASE_URL is not set. Webhook callbacks cannot reach this server until you configure a public HTTPS URL.');
});

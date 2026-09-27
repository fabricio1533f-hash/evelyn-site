

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

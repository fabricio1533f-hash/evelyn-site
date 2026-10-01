// Evelyn Checkout - PIX
// Node 18+ / Node 22 recomendado

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);

const OMEGAPAY_PUBLIC_KEY =
  process.env.OMEGAPAY_PUBLIC_KEY || '';

const OMEGAPAY_PRIVATE_KEY =
  process.env.OMEGAPAY_PRIVATE_KEY || '';

const OMEGAPAY_BASE_URL =
  process.env.OMEGAPAY_BASE_URL ||
  'https://app.omegapayments.com.br';

const WEBHOOK_SECRET =
  process.env.SYNCPAY_WEBHOOK_SECRET || '';

const WEBHOOK_SECRET_OLD =
  process.env.SYNCPAY_WEBHOOK_SECRET_ANTERIOR || '';

const SITE_DIR = __dirname;

const ORDERS_FILE =
  path.join(__dirname, 'data', 'orders.json');

const VISITS_FILE =
  path.join(__dirname, 'data', 'visits.json');

function ensureVisitsFile() {
  fs.mkdirSync(
    path.dirname(VISITS_FILE),
    { recursive: true }
  );

  if (!fs.existsSync(VISITS_FILE)) {
    fs.writeFileSync(
      VISITS_FILE,
      '[]'
    );
  }
}

function readVisits() {
  ensureVisitsFile();

  try {
    return JSON.parse(
      fs.readFileSync(
        VISITS_FILE,
        'utf8'
      ) || '[]'
    );
  } catch {
    return [];
  }
}

function writeVisits(visits) {
  ensureVisitsFile();

  const tmp =
    `${VISITS_FILE}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      visits,
      null,
      2
    )
  );

  fs.renameSync(
    tmp,
    VISITS_FILE
  );
}

function visitDevice(ua) {
  if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) {
    return 'Tablet';
  }

  if (/mobile|iphone|ipod|android/i.test(ua)) {
    return 'Celular';
  }

  return 'PC';
}

function visitBrowser(ua) {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/opr\//i.test(ua)) return 'Opera';
  if (/chrome\//i.test(ua)) return 'Chrome';
  if (/firefox\//i.test(ua)) return 'Firefox';
  if (/safari\//i.test(ua)) return 'Safari';

  return 'Outro';
}

function recordVisit(req, pathname) {
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/webhooks/')
  ) {
    return;
  }

  const ua =
    req.headers['user-agent'] || '';
    
const visits =
  readVisits();

const now = Date.now();
const device = visitDevice(ua);
const browser = visitBrowser(ua);

const duplicate = visits.some(v =>
  v.path === pathname &&
  v.device === device &&
  v.browser === browser &&
  now - new Date(v.at).getTime() < 10000
);

if (duplicate) {
  return;
}
  visits.push({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    path: pathname,
    device: device,
    browser: browser,
    country:
      req.headers['cf-ipcountry'] ||
      req.headers['x-country-code'] ||
      null
  });

visits.push({
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  path: pathname,
  device: visitDevice(ua),
  browser: visitBrowser(ua),
  country:
    req.headers['cf-ipcountry'] ||
    req.headers['x-country-code'] ||
    null
});
  writeVisits(visits);
}

const VISIT_RESET_FILE = path.join(
  __dirname,
  'data',
  'visit-reset.json'
);

function getVisitResetState() {
  try {
    if (!fs.existsSync(VISIT_RESET_FILE)) {
      const state = {
        startedAt: new Date().toISOString()
      };

      fs.writeFileSync(
        VISIT_RESET_FILE,
        JSON.stringify(state, null, 2),
        'utf8'
      );

      return state;
    }

    return JSON.parse(
      fs.readFileSync(
        VISIT_RESET_FILE,
        'utf8'
      )
    );
  } catch {
    return {
      startedAt: new Date().toISOString()
    };
  }
}

function resetVisitsIfNeeded() {
  const state = getVisitResetState();

  const startedAt =
    new Date(state.startedAt).getTime();

  const now = Date.now();

  const twentyFourHours =
    24 * 60 * 60 * 1000;

  if (
    now - startedAt >=
    twentyFourHours
  ) {
    writeVisits([]);

    const newState = {
      startedAt: new Date().toISOString()
    };

    fs.writeFileSync(
      VISIT_RESET_FILE,
      JSON.stringify(newState, null, 2),
      'utf8'
    );
  }
}

function visitStats() {
  resetVisitsIfNeeded();

  const visits =
    readVisits();

  const fiveMin =
    Date.now() -
    5 * 60 * 1000;

  return {
    today: visits.length,

    visitorsNow:
      visits.filter(
        v =>
          new Date(v.at).getTime() >=
          fiveMin
      ).length,

    devices: {
      Celular:
        visits.filter(
          v => v.device === 'Celular'
        ).length,

      PC:
        visits.filter(
          v => v.device === 'PC'
        ).length,

      Tablet:
        visits.filter(
          v => v.device === 'Tablet'
        ).length
    },

    recent:
      visits
        .slice()
        .reverse()
  };
}
const PLANS = {
  '30-dias': {
    amount: 20.90,
    label: 'Assinar agora'
  },

  '3-meses': {
    amount: 39.90,
    label: '3 meses (5% off)'
  },

  '1-ano': {
    amount: 69.90,
    label: '6 meses (10% off)'
  }
};


function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, 'utf8');

  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/
    );

    if (!m) continue;

    let value = m[2].trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = value;
    }
  }
}


function ensureDataFile() {
  fs.mkdirSync(
    path.dirname(ORDERS_FILE),
    { recursive: true }
  );

  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(
      ORDERS_FILE,
      '{}'
    );
  }
}


function readOrders() {
  ensureDataFile();

  try {
    return JSON.parse(
      fs.readFileSync(
        ORDERS_FILE,
        'utf8'
      ) || '{}'
    );
  } catch {
    return {};
  }
}


function writeOrders(orders) {
  ensureDataFile();

  const tmp =
    `${ORDERS_FILE}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      orders,
      null,
      2
    )
  );

  fs.renameSync(
    tmp,
    ORDERS_FILE
  );
}


function sendJson(
  res,
  status,
  body
) {
  const payload =
    JSON.stringify(body);

  res.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store',

      'Access-Control-Allow-Origin':
        '*'
    }
  );

  res.end(payload);
}


function readBody(
  req,
  maxBytes = 100000
) {
  return new Promise(
    (resolve, reject) => {
      let body = '';

      req.on(
        'data',
        chunk => {
          body += chunk;

          if (
            Buffer.byteLength(body) >
            maxBytes
          ) {
            req.destroy();

            reject(
              new Error(
                'Payload too large'
              )
            );
          }
        }
      );

      req.on(
        'end',
        () => resolve(body)
      );

      req.on(
        'error',
        reject
      );
    }
  );
}


function safeEqualHex(
  expected,
  actual
) {
  try {
    const a =
      Buffer.from(
        expected,
        'utf8'
      );

    const b =
      Buffer.from(
        actual,
        'utf8'
      );

    return (
      a.length === b.length &&
      crypto.timingSafeEqual(
        a,
        b
      )
    );
  } catch {
    return false;
  }
}


function verifyWebhook(
  signature,
  rawBody
) {
  const secrets = [
    WEBHOOK_SECRET,
    WEBHOOK_SECRET_OLD
  ].filter(Boolean);

  if (
    !signature ||
    secrets.length === 0
  ) {
    return false;
  }

  const parts =
    Object.fromEntries(
      String(signature)
        .split(',')
        .map(p => {
          const [
            k,
            ...rest
          ] = p.split('=');

          return [
            k?.trim(),
            rest.join('=').trim()
          ];
        })
    );

  const timestamp =
    Number(parts.t || 0);

  const received =
    parts.v1 || '';

  if (
    !timestamp ||
    !received
  ) {
    return false;
  }

  if (
    Math.abs(
      Math.floor(
        Date.now() / 1000
      ) - timestamp
    ) > 300
  ) {
    return false;
  }

  return secrets.some(
    secret => {
      const expected =
        crypto
          .createHmac(
            'sha256',
            secret
          )
          .update(
            `${timestamp}.${rawBody}`
          )
          .digest('hex');

      return safeEqualHex(
        expected,
        received
      );
    }
  );
}


async function createPix(body) {
  const plan = PLANS[body.plan];

  if (!plan) {
    throw Object.assign(
      new Error('Plano inválido.'),
      { status: 400 }
    );
  }

  if (!OMEGAPAY_PUBLIC_KEY || !OMEGAPAY_PRIVATE_KEY) {
    throw Object.assign(
      new Error(
        'OmegaPay credentials are not configured on the server.'
      ),
      { status: 500 }
    );
  }

  /*
   * DADOS FIXOS DO RESPONSÁVEL PELA COBRANÇA.
   *
   * O comprador NÃO precisa preencher nome,
   * e-mail, CPF ou telefone no checkout.
   */
  const customer = {
    name: 'ISAAC TOMAZ SANTOS',
    email: 'dachinachina4@gmail.com',
    phone: '81992361455',
    document: '33519940876'
  };

  const identifier =
    `evelyn_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const payload = {
    identifier,

    amount:
      Number(plan.amount),

    client: {
      name:
        customer.name,

      email:
        customer.email,

      phone:
        customer.phone,

      document:
        customer.document
    },

    products: [
      {
        id:
          String(body.plan),

        name:
          `Assinatura Evelyn - ${plan.label}`,

        quantity:
          1,

        price:
          Number(plan.amount),

        physical:
          false
      }
    ],

    metadata: {
      provider:
        'Evelyn Checkout',

      orderId:
        identifier
    }
  };

  console.log(
    'Criando PIX OmegaPay:',
    {
      identifier,
      plan: body.plan,
      amount: plan.amount
    }
  );

  const response =
    await fetch(
      `${OMEGAPAY_BASE_URL}/api/v1/gateway/pix/receive`,
      {
        method:
          'POST',

        headers: {
          'Content-Type':
            'application/json',

          'Accept':
            'application/json',

          'x-public-key':
            OMEGAPAY_PUBLIC_KEY,

          'x-secret-key':
            OMEGAPAY_PRIVATE_KEY
        },

        body:
          JSON.stringify(payload)
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (
    !response.ok ||
    !data.transactionId ||
    !data.pix?.code
  ) {
    console.error(
      'OmegaPay PIX error:',
      {
        status:
          response.status,

        response:
          data
      }
    );

    throw Object.assign(
      new Error(
        data.message ||
        data.errorDescription ||
        data.errorCode ||
        `OmegaPay PIX failed (${response.status})`
      ),
      {
        status:
          response.status || 502
      }
    );
  }

  const orders =
    readOrders();

  orders[identifier] = {
    identifier,

    transactionId:
      data.transactionId,

    plan:
      body.plan,

    amount:
      plan.amount,

    status:
      data.transactionStatus ||
      'PENDING',

    customer: {
      name:
        customer.name,

      email:
        customer.email,

      phone:
        customer.phone
    },

    pix: {
      expiresAt:
        data.pix.expiresAt ||
        null
    },

    webhookToken:
      data.webhookToken ||
      null,

    createdAt:
      new Date().toISOString()
  };

  writeOrders(
    orders
  );

  return {
    ok:
      true,

    identifier,

    transactionId:
      data.transactionId,

    pix_code:
      data.pix.code,

    pix_image:
      data.pix.image ||
      '',

    expiresAt:
      data.pix.expiresAt ||
      null,

    amount:
      plan.amount,

    label:
      plan.label,

    status:
      data.status,

    transactionStatus:
      data.transactionStatus ||
      null
  };
}


function handleWebhook(
  rawBody,
  req
) {
  if (
    !verifyWebhook(
      req.headers[
        'x-syncpay-signature'
      ],
      rawBody
    )
  ) {
    return {
      status:
        401,

      body: {
        error:
          'invalid_signature'
      }
    };
  }

  let event;

  try {
    event =
      JSON.parse(
        rawBody
      );
  } catch {
    return {
      status:
        400,

      body: {
        error:
          'invalid_json'
      }
    };
  }

  const tx =
    event.transaction || {};

  const identifier =
    tx.reference_id ||
    event.identifier ||
    event.id;

  if (identifier) {
    const orders =
      readOrders();

    if (orders[identifier]) {
      orders[identifier].status =
        tx.status ||
        orders[identifier].status;

      orders[identifier].updatedAt =
        new Date().toISOString();

      if (tx.paid_at) {
        orders[identifier].paidAt =
          tx.paid_at;
      }

      writeOrders(
        orders
      );
    }
  }

  return {
    status:
      200,

    body: {
      received:
        true
    }
  };
}


function serveStatic(
  req,
  res,
  pathname
) {
  let filePath =
    pathname === '/'
      ? path.join(
          SITE_DIR,
          'index.htm'
        )
      : path.join(
          SITE_DIR,
          pathname.replace(
            /^\//,
            ''
          )
        );

  filePath =
    path.normalize(
      filePath
    );

  if (
    !filePath.startsWith(
      SITE_DIR
    )
  ) {
    return sendJson(
      res,
      403,
      {
        error:
          'forbidden'
      }
    );
  }

  if (
    !fs.existsSync(
      filePath
    ) ||
    !fs.statSync(
      filePath
    ).isFile()
  ) {
    return sendJson(
      res,
      404,
      {
        error:
          'not_found'
      }
    );
  }

  const ext =
    path.extname(
      filePath
    ).toLowerCase();

  const types = {
    '.htm':
      'text/html; charset=utf-8',

    '.html':
      'text/html; charset=utf-8',

    '.css':
      'text/css; charset=utf-8',

    '.js':
      'application/javascript; charset=utf-8',

    '.json':
      'application/json; charset=utf-8',

    '.jpg':
      'image/jpeg',

    '.jpeg':
      'image/jpeg',

    '.png':
      'image/png',

    '.webp':
      'image/webp',

    '.mp4':
      'video/mp4',

    '.svg':
      'image/svg+xml',

    '.ico':
      'image/x-icon'
  };

  res.writeHead(
    200,
    {
      'Content-Type':
        types[ext] ||
        'application/octet-stream'
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(res);
}



function sendAdminPage(res) {
  const html = '<!DOCTYPE html>' +
  '<html lang="pt-BR"><head><meta charset="UTF-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Painel de Visitas</title>' +
  '<style>' +
  'body{font-family:Arial;background:#f6f7fb;padding:30px;color:#172033}' +
  '.grid{display:flex;gap:15px;flex-wrap:wrap}' +
  '.card{background:white;padding:25px;border-radius:15px;min-width:170px;box-shadow:0 4px 15px #ddd}' +
  '.label{color:#687386}.value{font-size:32px;font-weight:bold}' +
  '.box{background:white;padding:25px;margin-top:25px;border-radius:15px;overflow:auto}' +
  'table{width:100%;border-collapse:collapse}th,td{padding:12px;border-bottom:1px solid #eee;text-align:left}' +
  '</style></head><body>' +
  '<h1>📊 Painel de Visitas</h1>' +
  '<div class="grid">' +
  '<div class="card"><div class="label">Visitantes hoje</div><div class="value" id="today">0</div></div>' +
  '<div class="card"><div class="label">Últimos 5 minutos</div><div class="value" id="now">0</div></div>' +
  '<div class="card"><div class="label">Celular</div><div class="value" id="mobile">0</div></div>' +
  '<div class="card"><div class="label">PC</div><div class="value" id="pc">0</div></div>' +
  '<div class="card"><div class="label">Tablet</div><div class="value" id="tablet">0</div></div>' +
  '</div>' +
  '<div class="box"><h2>Acessos recentes</h2>' +
  '<table><thead><tr><th>Horário</th><th>Dispositivo</th><th>Navegador</th><th>País</th><th>Página</th></tr></thead>' +
  '<tbody id="rows"><tr><td colspan="5">Carregando...</td></tr></tbody></table></div>' +
  '<script>' +
  'async function carregar(){' +
  'try{' +
  'const r=await fetch("/api/visitas",{cache:"no-store"});' +
  'const d=await r.json();' +
  'document.getElementById("today").textContent=d.today||0;' +
  'document.getElementById("now").textContent=d.visitorsNow||0;' +
  'document.getElementById("mobile").textContent=d.devices?.Celular||0;' +
  'document.getElementById("pc").textContent=d.devices?.PC||0;' +
  'document.getElementById("tablet").textContent=d.devices?.Tablet||0;' +
  'const lista=d.recent||[];' +
  'document.getElementById("rows").innerHTML=lista.length?lista.map(v=>"<tr><td>"+new Date(v.at).toLocaleString("pt-BR")+"</td><td>"+(v.device||"-")+"</td><td>"+(v.browser||"-")+"</td><td>"+(v.country||"-")+"</td><td>"+(v.path||"-")+"</td></tr>").join(""):"<tr><td colspan=\"5\">Nenhum acesso ainda.</td></tr>";' +
  '}catch(e){console.log(e)}}' +
 'carregar();setInterval(carregar,30000);' +
'<\\/script></body></html>';
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(html);
}



const server = http.createServer(
    async (
      req,
      res
    ) => {
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/admin') {
  return serveStatic(req, res, '/admin.html');
}


      try {
        const url =
          new URL(
            req.url,
            `http://${req.headers.host || 'localhost'}`
          );

        if (
          req.method ===
          'OPTIONS'
        ) {
          res.writeHead(
            204,
            {
              'Access-Control-Allow-Origin':
                '*',

              'Access-Control-Allow-Headers':
                'Content-Type',

              'Access-Control-Allow-Methods':
                'GET,POST,OPTIONS'
            }
          );

          return res.end();
        }

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/api/create-pix'
        ) {
          const body =
            JSON.parse(
              await readBody(
                req
              )
            );

          const result =
            await createPix(
              body
            );

          return sendJson(
            res,
            200,
            result
          );
        }

        if (
          req.method ===
            'GET' &&
          url.pathname.startsWith(
            '/api/status/'
          )
        ) {
          const identifier =
            decodeURIComponent(
              url.pathname.slice(
                '/api/status/'.length
              )
            );

          const order =
            readOrders()[
              identifier
            ];

          if (!order) {
            return sendJson(
              res,
              404,
              {
                error:
                  'order_not_found'
              }
            );
          }

          return sendJson(
            res,
            200,
            {
              identifier,

              status:
                order.status,

              paidAt:
                order.paidAt ||
                null
            }
          );
        }

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/webhooks/syncpay'
        ) {
          const raw =
            await readBody(
              req
            );

          const result =
            handleWebhook(
              raw,
              req
            );

          return sendJson(
            res,
            result.status,
            result.body
          );
        }

        if (
          req.method === 'GET' &&
          url.pathname === '/api/visitas'
        ) {
          return sendJson(
            res,
            200,
            visitStats()
          );
        }

        if (
          req.method ===
          'GET'
        ) {
          const accept = req.headers.accept || '';

if (accept.includes('text/html')) {
  recordVisit(req, url.pathname);
}

          return serveStatic(
            req,
            res,
            url.pathname
          );
        }

        return sendJson(
          res,
          405,
          {
            error:
              'method_not_allowed'
          }
        );

      } catch (error) {
        console.error(
          error
        );

        return sendJson(
          res,
          error.status || 500,
          {
            error:
              error.message ||
              'internal_error'
          }
        );
      }
    }
  );


ensureDataFile();
ensureVisitsFile();

server.listen(
  PORT,
  () => {
    console.log(
      `Evelyn checkout running on http://localhost:${PORT}`
    );

    if (
      !OMEGAPAY_PUBLIC_KEY ||
      !OMEGAPAY_PRIVATE_KEY
    ) {
      console.warn(
        'OmegaPay credentials are not configured.'
      );
    }
  }
);

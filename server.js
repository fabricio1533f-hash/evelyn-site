// Evelyn Checkout - PIX
// Node 18+ / Node 22 recomendado

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT || 3000);

const SITE_DIR = __dirname;

// ============================================================
// ARQUIVOS DE DADOS
// ============================================================

const ORDERS_FILE =
  path.join(__dirname, 'data', 'orders.json');

const VISITS_FILE =
  path.join(__dirname, 'data', 'visits.json');

const VISIT_RESET_FILE =
  path.join(__dirname, 'data', 'visit-reset.json');

const GATEWAY_CONFIG_FILE =
  path.join(__dirname, 'data', 'gateway-config.json');

// ============================================================
// OMEGAPAY
// ============================================================

const OMEGAPAY_PUBLIC_KEY =
  process.env.OMEGAPAY_PUBLIC_KEY || '';

const OMEGAPAY_PRIVATE_KEY =
  process.env.OMEGAPAY_PRIVATE_KEY || '';

const OMEGAPAY_BASE_URL =
  process.env.OMEGAPAY_BASE_URL ||
  'https://app.omegapayments.com.br';

// ============================================================
// SYNCPAY
// As credenciais ficam no Render Environment.
// Nunca vão para o navegador/painel.
// ============================================================

const SYNCPAY_BASE_URL =
  process.env.SYNCPAY_BASE_URL ||
  'https://api.syncpayments.com.br';

const SYNCPAY_CLIENT_ID =
  process.env.SYNCPAY_CLIENT_ID || '';

const SYNCPAY_CLIENT_SECRET =
  process.env.SYNCPAY_CLIENT_SECRET || '';

const SYNCPAY_WEBHOOK_SECRET =
  process.env.SYNCPAY_WEBHOOK_SECRET || '';

const SYNCPAY_WEBHOOK_SECRET_OLD =
  process.env.SYNCPAY_WEBHOOK_SECRET_ANTERIOR || '';

const PUBLIC_BASE_URL =
  (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

// ============================================================
// DADOS FIXOS DO RESPONSÁVEL
//
// O checkout NÃO pede nome, e-mail, CPF ou telefone.
// As duas gateways usarão estes mesmos dados.
// ============================================================

const FIXED_CUSTOMER = {
  name: 'ISAAC TOMAZ SANTOS',
  email: 'dachinachina4@gmail.com',
  phone: '81992361455',
  document: '33519940876'
};

// ============================================================
// PLANOS
// Mantidos exatamente como estão no server.js atual.
// ============================================================

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

// ============================================================
// CONFIGURAÇÃO DAS GATEWAYS
//
// Esta configuração será controlada pelo painel.
// Não colocamos credenciais aqui.
//
// primaryGateway:
//   gateway usada normalmente.
//
// fallbackEnabled:
//   permite usar a segunda gateway quando configurado.
//
// fallbackGateway:
//   gateway escolhida como reserva.
//
// Valores permitidos:
//   'omegapay'
//   'syncpay'
// ============================================================

const DEFAULT_GATEWAY_CONFIG = {
  primaryGateway: 'omegapay',
  fallbackEnabled: false,
  fallbackGateway: 'syncpay'
};

// ============================================================
// CACHE DE TOKEN DA SYNCPAY
// ============================================================

let syncPayTokenCache = {
  token: '',
  expiresAt: 0
};
// ============================================================
// CARREGAMENTO SIMPLES DO .ENV
// ============================================================

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = value;
    }
  }
}

// ============================================================
// ORDERS.JSON
// ============================================================

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
// ============================================================
// CONFIGURAÇÃO DAS GATEWAYS
// ============================================================

function ensureGatewayConfigFile() {
  fs.mkdirSync(
    path.dirname(GATEWAY_CONFIG_FILE),
    { recursive: true }
  );

  if (!fs.existsSync(GATEWAY_CONFIG_FILE)) {
    fs.writeFileSync(
      GATEWAY_CONFIG_FILE,
      JSON.stringify(
        DEFAULT_GATEWAY_CONFIG,
        null,
        2
      )
    );
  }
}

function readGatewayConfig() {
  ensureGatewayConfigFile();

  try {
    const saved =
      JSON.parse(
        fs.readFileSync(
          GATEWAY_CONFIG_FILE,
          'utf8'
        ) || '{}'
      );

    return {
      ...DEFAULT_GATEWAY_CONFIG,
      ...saved
    };
  } catch {
    return {
      ...DEFAULT_GATEWAY_CONFIG
    };
  }
}

function writeGatewayConfig(config) {
  ensureGatewayConfigFile();

  const safeConfig = {
    primaryGateway:
      config.primaryGateway === 'syncpay'
        ? 'syncpay'
        : 'omegapay',

    fallbackEnabled:
      config.fallbackEnabled === true,

    fallbackGateway:
      config.fallbackGateway === 'omegapay'
        ? 'omegapay'
        : 'syncpay'
  };

  // Impede escolher a mesma gateway
  // como principal e fallback.
  if (
    safeConfig.primaryGateway ===
    safeConfig.fallbackGateway
  ) {
    safeConfig.fallbackGateway =
      safeConfig.primaryGateway === 'omegapay'
        ? 'syncpay'
        : 'omegapay';
  }

  const tmp =
    `${GATEWAY_CONFIG_FILE}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(
      safeConfig,
      null,
      2
    )
  );

  fs.renameSync(
    tmp,
    GATEWAY_CONFIG_FILE
  );

  return safeConfig;
}

// ============================================================
// VISITAS
// ============================================================

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

// ============================================================
// VISITANTE — DISPOSITIVO
// ============================================================

function visitDevice(ua) {
  if (
    /tablet|ipad|android(?!.*mobile)/i.test(ua)
  ) {
    return 'Tablet';
  }

  if (
    /mobile|iphone|ipod|android/i.test(ua)
  ) {
    return 'Celular';
  }

  return 'PC';
}

// ============================================================
// VISITANTE — NAVEGADOR
// ============================================================

function visitBrowser(ua) {
  if (/edg\//i.test(ua)) {
    return 'Edge';
  }

  if (/opr\//i.test(ua)) {
    return 'Opera';
  }

  if (/chrome\//i.test(ua)) {
    return 'Chrome';
  }

  if (/firefox\//i.test(ua)) {
    return 'Firefox';
  }

  if (/safari\//i.test(ua)) {
    return 'Safari';
  }

  return 'Outro';
}

// ============================================================
// REGISTRO DE VISITAS
// ============================================================

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

  const now =
    Date.now();

  const device =
    visitDevice(ua);

  const browser =
    visitBrowser(ua);

  const duplicate =
    visits.some(v =>
      v.path === pathname &&
      v.device === device &&
      v.browser === browser &&
      now -
        new Date(v.at).getTime() <
        10000
    );

  if (duplicate) {
    return;
  }

  visits.push({
    id:
      crypto.randomUUID(),

    at:
      new Date().toISOString(),

    path:
      pathname,

    device:
      device,

    browser:
      browser,

    country:
      req.headers['cf-ipcountry'] ||
      req.headers['x-country-code'] ||
      null
  });

  writeVisits(visits);
}

// ============================================================
// RESET DE VISITAS A CADA 24 HORAS
// ============================================================

function getVisitResetState() {
  try {
    if (!fs.existsSync(VISIT_RESET_FILE)) {
      const state = {
        startedAt:
          new Date().toISOString()
      };

      fs.writeFileSync(
        VISIT_RESET_FILE,
        JSON.stringify(
          state,
          null,
          2
        ),
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
      startedAt:
        new Date().toISOString()
    };
  }
}

function resetVisitsIfNeeded() {
  const state =
    getVisitResetState();

  const startedAt =
    new Date(
      state.startedAt
    ).getTime();

  const now =
    Date.now();

  const twentyFourHours =
    24 * 60 * 60 * 1000;

  if (
    now - startedAt >=
    twentyFourHours
  ) {
    writeVisits([]);

    const newState = {
      startedAt:
        new Date().toISOString()
    };

    fs.writeFileSync(
      VISIT_RESET_FILE,
      JSON.stringify(
        newState,
        null,
        2
      ),
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
    today:
      visits.length,

    visitorsNow:
      visits.filter(
        v =>
          new Date(v.at).getTime() >=
          fiveMin
      ).length,

    devices: {
      Celular:
        visits.filter(
          v =>
            v.device === 'Celular'
        ).length,

      PC:
        visits.filter(
          v =>
            v.device === 'PC'
        ).length,

      Tablet:
        visits.filter(
          v =>
            v.device === 'Tablet'
        ).length
    },

    recent:
      visits
        .slice()
        .reverse()
  };
}
// ============================================================
// UTILITÁRIO — COMPARAÇÃO SEGURA
// ============================================================

function safeEqualHex(expected, actual) {
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

// ============================================================
// SYNCPAY — TOKEN
// ============================================================

async function getSyncPayAccessToken() {
  if (
    !SYNCPAY_CLIENT_ID ||
    !SYNCPAY_CLIENT_SECRET
  ) {
    throw Object.assign(
      new Error(
        'SyncPay credentials are not configured on the server.'
      ),
      {
        status: 500
      }
    );
  }

  const now =
    Date.now();

  if (
    syncPayTokenCache.token &&
    syncPayTokenCache.expiresAt >
      now + 30000
  ) {
    return syncPayTokenCache.token;
  }

  const response =
    await fetch(
      `${SYNCPAY_BASE_URL}/api/partner/v1/auth-token`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          'Accept':
            'application/json'
        },

        body:
          JSON.stringify({
            client_id:
              SYNCPAY_CLIENT_ID,

            client_secret:
              SYNCPAY_CLIENT_SECRET
          })
      }
    );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw Object.assign(
      new Error(
        `SyncPay auth failed (${response.status}): ${JSON.stringify(data)}`
      ),
      {
        status:
          response.status || 502
      }
    );
  }

  syncPayTokenCache = {
    token:
      data.access_token,

    expiresAt:
      data.expires_at
        ? Date.parse(
            data.expires_at
          )
        : now +
          (
            Number(
              data.expires_in ||
              3600
            ) * 1000
          )
  };

  return syncPayTokenCache.token;
}

// ============================================================
// SYNCPAY — CRIAÇÃO DO PIX
//
// Usa os mesmos dados fixos da OmegaPay.
// O navegador não fornece dados pessoais.
// ============================================================

async function createSyncPayPix(body) {
  const plan =
    PLANS[body.plan];

  if (!plan) {
    throw Object.assign(
      new Error(
        'Plano inválido.'
      ),
      {
        status: 400
      }
    );
  }

  const token =
    await getSyncPayAccessToken();

  const description =
    `Evelyn - ${plan.label}`;

  const payload = {
    amount:
      Number(plan.amount),

    description,

    client: {
      name:
        FIXED_CUSTOMER.name,

      email:
        FIXED_CUSTOMER.email,

      cpf:
        FIXED_CUSTOMER.document,

      phone:
        FIXED_CUSTOMER.phone
    }
  };

  console.log(
    'Criando PIX SyncPay:',
    {
      plan:
        body.plan,

      amount:
        plan.amount
    }
  );

  let response =
    await fetch(
      `${SYNCPAY_BASE_URL}/api/partner/v1/cash-in`,
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${token}`,

          'Content-Type':
            'application/json',

          'Accept':
            'application/json'
        },

        body:
          JSON.stringify(payload)
      }
    );

  let data =
    await response
      .json()
      .catch(() => ({}));

  // Se o token expirou, limpa o cache.
  // O controlador poderá tentar novamente
  // com um novo token.
  if (
    response.status === 401
  ) {
    syncPayTokenCache = {
      token: '',
      expiresAt: 0
    };

    const retryToken =
      await getSyncPayAccessToken();

    response =
      await fetch(
        `${SYNCPAY_BASE_URL}/api/partner/v1/cash-in`,
        {
          method: 'POST',

          headers: {
            'Authorization':
              `Bearer ${retryToken}`,

            'Content-Type':
              'application/json',

            'Accept':
              'application/json'
          },

          body:
            JSON.stringify(payload)
        }
      );

    data =
      await response
        .json()
        .catch(() => ({}));
  }

  if (
    !response.ok ||
    !data.identifier ||
    !data.pix_code
  ) {
    console.error(
      'SyncPay PIX error:',
      {
        status:
          response.status,

        response:
          data
      }
    );

    throw Object.assign(
      new Error(
        `SyncPay cash-in failed (${response.status}): ${JSON.stringify(data)}`
      ),
      {
        status:
          response.status || 502
      }
    );
  }

  const orders =
    readOrders();

  orders[data.identifier] = {
    identifier:
      data.identifier,

    gateway:
      'syncpay',

    plan:
      body.plan,

    amount:
      plan.amount,

    status:
      data.status ||
      'pending',

    customer: {
      name:
        FIXED_CUSTOMER.name,

      email:
        FIXED_CUSTOMER.email,

      phone:
        FIXED_CUSTOMER.phone
    },

    createdAt:
      new Date().toISOString()
  };

  writeOrders(
    orders
  );

  return {
    ok:
      true,

    identifier:
      data.identifier,

    pix_code:
      data.pix_code,

    pix_image:
      data.pix_image ||
      '',

    amount:
      plan.amount,

    label:
      plan.label,

    status:
      data.status ||
      'pending',

    transactionStatus:
      data.status ||
      null,

    gateway:
      'syncpay'
  };
}

// ============================================================
// OMEGAPAY — CRIAÇÃO DO PIX
//
// Mantém o fluxo que já existe no seu server.js.
// Usa os mesmos dados fixos.
// ============================================================

async function createOmegaPayPix(body) {
  const plan =
    PLANS[body.plan];

  if (!plan) {
    throw Object.assign(
      new Error(
        'Plano inválido.'
      ),
      {
        status: 400
      }
    );
  }

  if (
    !OMEGAPAY_PUBLIC_KEY ||
    !OMEGAPAY_PRIVATE_KEY
  ) {
    throw Object.assign(
      new Error(
        'OmegaPay credentials are not configured on the server.'
      ),
      {
        status: 500
      }
    );
  }

  const identifier =
    `evelyn_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  const payload = {
    identifier,

    amount:
      Number(plan.amount),

    client: {
      name:
        FIXED_CUSTOMER.name,

      email:
        FIXED_CUSTOMER.email,

      phone:
        FIXED_CUSTOMER.phone,

      document:
        FIXED_CUSTOMER.document
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

      plan:
        body.plan,

      amount:
        plan.amount
    }
  );

  const response =
    await fetch(
      `${OMEGAPAY_BASE_URL}/api/v1/gateway/pix/receive`,
      {
        method: 'POST',

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

    gateway:
      'omegapay',

    plan:
      body.plan,

    amount:
      plan.amount,

    status:
      data.transactionStatus ||
      'PENDING',

    customer: {
      name:
        FIXED_CUSTOMER.name,

      email:
        FIXED_CUSTOMER.email,

      phone:
        FIXED_CUSTOMER.phone
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
      null,

    gateway:
      'omegapay'
  };
}
// ============================================================
// CONTROLE DE GATEWAY
// ============================================================

function getGatewayFunction(gateway) {
  if (gateway === 'syncpay') {
    return createSyncPayPix;
  }

  return createOmegaPayPix;
}

// ============================================================
// CRIAÇÃO DO PIX
//
// Fluxo:
//
// 1. Lê a configuração salva pelo painel.
// 2. Tenta a gateway principal.
// 3. Se o fallback estiver habilitado e a principal falhar,
//    tenta a gateway configurada como fallback.
// 4. Se o fallback estiver desligado, a falha da principal
//    é devolvida normalmente.
//
// A configuração é controlada pelo painel.
// ============================================================

async function createPix(body) {
  const plan =
    PLANS[body.plan];

  if (!plan) {
    throw Object.assign(
      new Error(
        'Plano inválido.'
      ),
      {
        status: 400
      }
    );
  }

  const config =
    readGatewayConfig();

  const primary =
    config.primaryGateway;

  const primaryFunction =
    getGatewayFunction(
      primary
    );

  try {
    return await primaryFunction(
      body
    );
  } catch (primaryError) {
    console.error(
      `Falha na gateway principal (${primary}):`,
      primaryError
    );

    if (
      !config.fallbackEnabled
    ) {
      throw primaryError;
    }

    const fallback =
      config.fallbackGateway;

    if (
      fallback === primary
    ) {
      throw primaryError;
    }

    const fallbackFunction =
      getGatewayFunction(
        fallback
      );

    try {
      console.warn(
        `Tentando fallback (${fallback})...`
      );

      const result =
        await fallbackFunction(
          body
        );

      return {
        ...result,

        fallbackUsed:
          true,

        primaryGateway:
          primary,

        gateway:
          fallback
      };
    } catch (fallbackError) {
      console.error(
        `Falha também no fallback (${fallback}):`,
        fallbackError
      );

      throw Object.assign(
        new Error(
          `Falha nas duas gateways. Principal: ${primary}. Fallback: ${fallback}.`
        ),
        {
          status:
            fallbackError.status ||
            primaryError.status ||
            502,

          cause:
            fallbackError
        }
      );
    }
  }
}

// ============================================================
// WEBHOOK SYNCPAY
// ============================================================

function verifySyncPayWebhook(
  signature,
  rawBody
) {
  const secrets = [
    SYNCPAY_WEBHOOK_SECRET,
    SYNCPAY_WEBHOOK_SECRET_OLD
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
        .map(part => {
          const [
            key,
            ...rest
          ] =
            part.split('=');

          return [
            key?.trim(),
            rest.join('=').trim()
          ];
        })
    );

  const timestamp =
    Number(
      parts.t ||
      0
    );

  const received =
    parts.v1 ||
    '';

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

// ============================================================
// PROCESSAMENTO DO WEBHOOK SYNCPAY
// ============================================================

function handleSyncPayWebhook(
  rawBody,
  req
) {
  if (
    !verifySyncPayWebhook(
      req.headers[
        'x-syncpay-signature'
      ],
      rawBody
    )
  ) {
    return {
      status: 401,

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
      status: 400,

      body: {
        error:
          'invalid_json'
      }
    };
  }

  const tx =
    event.transaction ||
    {};

  const identifier =
    tx.reference_id ||
    event.identifier ||
    event.id;

  if (
    identifier
  ) {
    const orders =
      readOrders();

    if (
      orders[identifier]
    ) {
      orders[identifier].status =
        tx.status ||
        orders[identifier].status;

      orders[identifier].updatedAt =
        new Date().toISOString();

      if (
        tx.paid_at
      ) {
        orders[identifier].paidAt =
          tx.paid_at;
      }

      writeOrders(
        orders
      );
    }
  }

  return {
    status: 200,

    body: {
      received:
        true
    }
  };
}
// ============================================================
// PAINEL ADMINISTRATIVO
// ============================================================

function sendAdminPage(res) {
  const config =
    readGatewayConfig();

  const omegaConfigured =
    Boolean(
      OMEGAPAY_PUBLIC_KEY &&
      OMEGAPAY_PRIVATE_KEY
    );

  const syncPayConfigured =
    Boolean(
      SYNCPAY_CLIENT_ID &&
      SYNCPAY_CLIENT_SECRET
    );

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>Painel Administrativo</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 30px;
      background: #f6f7fb;
      color: #172033;
      font-family: Arial, Helvetica, sans-serif;
    }

    .container {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
    }

    h1 {
      margin: 0 0 25px;
    }

    h2 {
      margin-top: 0;
    }

    .grid {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
    }

    .card {
      background: white;
      padding: 25px;
      border-radius: 15px;
      min-width: 170px;
      box-shadow: 0 4px 15px #ddd;
    }

    .label {
      color: #687386;
    }

    .value {
      font-size: 32px;
      font-weight: bold;
      margin-top: 6px;
    }

    .box {
      background: white;
      padding: 25px;
      margin-top: 25px;
      border-radius: 15px;
      box-shadow: 0 4px 15px #ddd;
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 12px;
      border-bottom: 1px solid #eee;
      text-align: left;
    }

    .gateway-grid {
      display: grid;
      grid-template-columns:
        repeat(
          auto-fit,
          minmax(280px, 1fr)
        );

      gap: 20px;
    }

    .gateway-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      padding: 20px;
    }

    .gateway-card h3 {
      margin: 0 0 15px;
    }

    .field {
      margin-bottom: 16px;
    }

    .field label {
      display: block;
      margin-bottom: 7px;
      font-size: 14px;
      font-weight: bold;
    }

    select {
      width: 100%;
      height: 42px;
      padding: 0 10px;
      border: 1px solid #d5d9e0;
      border-radius: 9px;
      background: #fff;
      font-size: 14px;
    }

    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      margin: 18px 0;
    }

    .switch-title {
      font-weight: bold;
      font-size: 14px;
    }

    .switch-description {
      margin-top: 4px;
      color: #687386;
      font-size: 12px;
      line-height: 1.4;
    }

    .switch {
      position: relative;
      width: 50px;
      height: 28px;
      flex: 0 0 auto;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      inset: 0;
      cursor: pointer;
      background: #ccc;
      border-radius: 999px;
      transition: 0.2s;
    }

    .slider::before {
      content: "";
      position: absolute;
      width: 22px;
      height: 22px;
      left: 3px;
      top: 3px;
      background: white;
      border-radius: 50%;
      transition: 0.2s;
      box-shadow: 0 2px 5px rgba(0,0,0,.2);
    }

    .switch input:checked + .slider {
      background: #111;
    }

    .switch input:checked + .slider::before {
      transform: translateX(22px);
    }

    .buttons {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 18px;
    }

    button {
      border: 0;
      border-radius: 9px;
      padding: 11px 17px;
      background: #111;
      color: white;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
    }

    button:hover {
      opacity: .9;
    }

    button.secondary {
      background: #e8e9ed;
      color: #172033;
    }

    .message {
      min-height: 20px;
      margin-top: 12px;
      font-size: 13px;
      font-weight: bold;
    }

    .gateway-status {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 15px;
      padding: 12px;
      background: #f6f7fb;
      border-radius: 9px;
    }

    .status-name {
      font-weight: bold;
    }

    .status-ok {
      color: #16803c;
      font-weight: bold;
    }

    .status-missing {
      color: #b42318;
      font-weight: bold;
    }

    .security-note {
      margin-top: 15px;
      color: #687386;
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 600px) {
      body {
        padding: 15px;
      }

      .box {
        padding: 18px;
      }

      th,
      td {
        white-space: nowrap;
      }
    }
  </style>
</head>

<body>

  <div class="container">

    <h1>📊 Painel Administrativo</h1>


    <!-- ====================================================== -->
    <!-- VISITAS - MANTIDO DO PAINEL ORIGINAL -->
    <!-- ====================================================== -->

    <div class="grid">

      <div class="card">
        <div class="label">
          Visitantes hoje
        </div>

        <div
          class="value"
          id="today"
        >
          0
        </div>
      </div>

      <div class="card">
        <div class="label">
          Últimos 5 minutos
        </div>

        <div
          class="value"
          id="now"
        >
          0
        </div>
      </div>

      <div class="card">
        <div class="label">
          Celular
        </div>

        <div
          class="value"
          id="mobile"
        >
          0
        </div>
      </div>

      <div class="card">
        <div class="label">
          PC
        </div>

        <div
          class="value"
          id="pc"
        >
          0
        </div>
      </div>

      <div class="card">
        <div class="label">
          Tablet
        </div>

        <div
          class="value"
          id="tablet"
        >
          0
        </div>
      </div>

    </div>


    <!-- ====================================================== -->
    <!-- CONTROLE DE GATEWAYS -->
    <!-- ====================================================== -->

    <div class="box">

      <h2>💳 Controle de Gateway</h2>

      <div class="gateway-grid">

        <div class="gateway-card">

          <h3>Gateway principal</h3>

          <div class="field">

            <label for="primaryGateway">
              Gateway usada normalmente
            </label>

            <select id="primaryGateway">

              <option value="omegapay">
                OmegaPay
              </option>

              <option value="syncpay">
                SyncPay
              </option>

            </select>

          </div>

          <div class="switch-row">

            <div>

              <div class="switch-title">
                Fallback automático
              </div>

              <div class="switch-description">
                Se ativado, tenta a gateway de
                fallback quando a principal falhar.
              </div>

            </div>

            <label class="switch">

              <input
                type="checkbox"
                id="fallbackEnabled"
              >

              <span class="slider"></span>

            </label>

          </div>

          <div class="field">

            <label for="fallbackGateway">
              Gateway de fallback
            </label>

            <select id="fallbackGateway">

              <option value="syncpay">
                SyncPay
              </option>

              <option value="omegapay">
                OmegaPay
              </option>

            </select>

          </div>

          <div class="buttons">

            <button
              type="button"
              onclick="saveGatewayConfig()"
            >
              Salvar configuração
            </button>

            <button
              type="button"
              class="secondary"
              onclick="loadGatewayConfig()"
            >
              Recarregar
            </button>

          </div>

          <div
            id="gatewayMessage"
            class="message"
          ></div>

        </div>


        <!-- ================================================== -->
        <!-- STATUS DAS CREDENCIAIS -->
        <!-- ================================================== -->

        <div class="gateway-card">

          <h3>Status das gateways</h3>

          <div class="gateway-status">

            <div class="status-row">

              <span class="status-name">
                OmegaPay
              </span>

              <span
                class="${
                  omegaConfigured
                    ? 'status-ok'
                    : 'status-missing'
                }"
              >
                ${
                  omegaConfigured
                    ? 'Configurada'
                    : 'Não configurada'
                }
              </span>

            </div>

            <div class="status-row">

              <span class="status-name">
                SyncPay
              </span>

              <span
                class="${
                  syncPayConfigured
                    ? 'status-ok'
                    : 'status-missing'
                }"
              >
                ${
                  syncPayConfigured
                    ? 'Configurada'
                    : 'Não configurada'
                }
              </span>

            </div>

          </div>

          <div class="security-note">
            As credenciais das gateways ficam somente
            nas variáveis de ambiente do servidor.
            Nenhuma chave ou segredo é exibido neste painel.
          </div>

        </div>

      </div>

    </div>


    <!-- ====================================================== -->
    <!-- ACESSOS RECENTES - MANTIDO DO PAINEL ORIGINAL -->
    <!-- ====================================================== -->

    <div class="box">

      <h2>Acessos recentes</h2>

      <table>

        <thead>

          <tr>
            <th>Horário</th>
            <th>Dispositivo</th>
            <th>Navegador</th>
            <th>País</th>
            <th>Página</th>
          </tr>

        </thead>

        <tbody id="rows">

          <tr>
            <td colspan="5">
              Carregando...
            </td>
          </tr>

        </tbody>

      </table>

    </div>

  </div>


  <script>

    // ========================================================
    // CARREGAR CONFIGURAÇÃO DAS GATEWAYS
    // ========================================================

    async function loadGatewayConfig() {

      const message =
        document.getElementById(
          'gatewayMessage'
        );

      message.textContent =
        'Carregando configuração...';

      try {

        const response =
          await fetch(
            '/api/gateway-config',
            {
              cache: 'no-store'
            }
          );

        const data =
          await response.json();

        if (!response.ok) {

          throw new Error(
            data.error ||
            'Erro ao carregar configuração.'
          );

        }

        document.getElementById(
          'primaryGateway'
        ).value =
          data.primaryGateway;

        document.getElementById(
          'fallbackEnabled'
        ).checked =
          Boolean(
            data.fallbackEnabled
          );

        document.getElementById(
          'fallbackGateway'
        ).value =
          data.fallbackGateway;

        message.textContent =
          '';

      } catch (error) {

        message.textContent =
          error.message ||
          'Erro ao carregar configuração.';

      }

    }


    // ========================================================
    // SALVAR CONFIGURAÇÃO DAS GATEWAYS
    // ========================================================

    async function saveGatewayConfig() {

      const message =
        document.getElementById(
          'gatewayMessage'
        );

      const primaryGateway =
        document.getElementById(
          'primaryGateway'
        ).value;

      const fallbackEnabled =
        document.getElementById(
          'fallbackEnabled'
        ).checked;

      const fallbackGateway =
        document.getElementById(
          'fallbackGateway'
        ).value;

      message.textContent =
        'Salvando...';

      try {

        const response =
          await fetch(
            '/api/gateway-config',
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'application/json'
              },

              body:
                JSON.stringify({
                  primaryGateway,
                  fallbackEnabled,
                  fallbackGateway
                })
            }
          );

        const data =
          await response.json();

        if (!response.ok) {

          throw new Error(
            data.error ||
            'Erro ao salvar configuração.'
          );

        }

        document.getElementById(
          'primaryGateway'
        ).value =
          data.primaryGateway;

        document.getElementById(
          'fallbackEnabled'
        ).checked =
          Boolean(
            data.fallbackEnabled
          );

        document.getElementById(
          'fallbackGateway'
        ).value =
          data.fallbackGateway;

        message.textContent =
          'Configuração salva com sucesso.';

      } catch (error) {

        message.textContent =
          error.message ||
          'Erro ao salvar configuração.';

      }

    }


    // ========================================================
    // CARREGAR VISITAS
    // ========================================================

    async function carregar() {

      try {

        const r =
          await fetch(
            '/api/visitas',
            {
              cache: 'no-store'
            }
          );

        const d =
          await r.json();

        document.getElementById(
          'today'
        ).textContent =
          d.today || 0;

        document.getElementById(
          'now'
        ).textContent =
          d.visitorsNow || 0;

        document.getElementById(
          'mobile'
        ).textContent =
          d.devices?.Celular || 0;

        document.getElementById(
          'pc'
        ).textContent =
          d.devices?.PC || 0;

        document.getElementById(
          'tablet'
        ).textContent =
          d.devices?.Tablet || 0;

        const lista =
          d.recent || [];

        document.getElementById(
          'rows'
        ).innerHTML =
          lista.length

            ? lista
                .map(
                  v =>
                    '<tr>' +
                    '<td>' +
                    new Date(
                      v.at
                    ).toLocaleString(
                      'pt-BR'
                    ) +
                    '</td>' +

                    '<td>' +
                    (v.device || '-') +
                    '</td>' +

                    '<td>' +
                    (v.browser || '-') +
                    '</td>' +

                    '<td>' +
                    (v.country || '-') +
                    '</td>' +

                    '<td>' +
                    (v.path || '-') +
                    '</td>' +

                    '</tr>'
                )
                .join('')

            : '<tr>' +
              '<td colspan="5">' +
              'Nenhum acesso ainda.' +
              '</td>' +
              '</tr>';

      } catch (error) {

        console.log(
          error
        );

      }

    }


    // ========================================================
    // INICIALIZAÇÃO
    // ========================================================

    loadGatewayConfig();

    carregar();

    setInterval(
      carregar,
      30000
    );

  </script>

</body>
</html>`;

  res.writeHead(
    200,
    {
      'Content-Type':
        'text/html; charset=utf-8',

      'Cache-Control':
        'no-store'
    }
  );

  res.end(
    html
  );
}
// ============================================================
// SERVIDOR HTTP + ROTAS
// ============================================================

const server = http.createServer(
  async (
    req,
    res
  ) => {

    // ========================================================
    // AUTENTICAÇÃO DO PAINEL
    // ========================================================

    function checkAdminAuth(
      req,
      res
    ) {
      const auth =
        req.headers.authorization ||
        '';

      const expected =
        'Basic ' +
        Buffer
          .from(
            'admin:LOKO1533'
          )
          .toString('base64');

      if (
        auth !== expected
      ) {
        res.writeHead(
          401,
          {
            'WWW-Authenticate':
              'Basic realm="Painel Administrativo"',

            'Content-Type':
              'text/plain; charset=utf-8',

            'Cache-Control':
              'no-store'
          }
        );

        res.end(
          'Acesso negado'
        );

        return false;
      }

      return true;
    }


    try {

      const url =
        new URL(
          req.url,
          `http://${req.headers.host || 'localhost'}`
        );


      // ======================================================
      // OPTIONS / CORS
      // ======================================================

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
              'Content-Type, Authorization',

            'Access-Control-Allow-Methods':
              'GET, POST, OPTIONS'
          }
        );

        return res.end();
      }


      // ======================================================
      // PAINEL ADMINISTRATIVO
      // ======================================================

      if (
        req.method === 'GET' &&
        url.pathname === '/admin'
      ) {

        if (
          !checkAdminAuth(
            req,
            res
          )
        ) {
          return;
        }

        return sendAdminPage(
          res
        );
      }


      // ======================================================
      // CONFIGURAÇÃO DE GATEWAY - GET
      // ======================================================

      if (
        req.method === 'GET' &&
        url.pathname ===
          '/api/gateway-config'
      ) {

        if (
          !checkAdminAuth(
            req,
            res
          )
        ) {
          return;
        }

        return sendJson(
          res,
          200,
          readGatewayConfig()
        );
      }


      // ======================================================
      // CONFIGURAÇÃO DE GATEWAY - POST
      // ======================================================

      if (
        req.method === 'POST' &&
        url.pathname ===
          '/api/gateway-config'
      ) {

        if (
          !checkAdminAuth(
            req,
            res
          )
        ) {
          return;
        }

        const raw =
          await readBody(
            req
          );

        let body;

        try {

          body =
            JSON.parse(
              raw
            );

        } catch {

          return sendJson(
            res,
            400,
            {
              error:
                'invalid_json'
            }
          );

        }

        const primaryGateway =
          body.primaryGateway ===
            'syncpay'
            ? 'syncpay'
            : 'omegapay';

        let fallbackGateway =
          body.fallbackGateway ===
            'omegapay'
            ? 'omegapay'
            : 'syncpay';

        const fallbackEnabled =
          Boolean(
            body.fallbackEnabled
          );


        // Nunca permite que a gateway
        // principal e o fallback sejam iguais.

        if (
          primaryGateway ===
          fallbackGateway
        ) {
          fallbackGateway =
            primaryGateway ===
              'omegapay'
              ? 'syncpay'
              : 'omegapay';
        }


        const config = {
          primaryGateway,

          fallbackEnabled,

          fallbackGateway
        };


        writeGatewayConfig(
          config
        );


        return sendJson(
          res,
          200,
          config
        );
      }


      // ======================================================
      // CRIAÇÃO DO PIX
      // ======================================================

      if (
        req.method === 'POST' &&
        url.pathname ===
          '/api/create-pix'
      ) {

        const raw =
          await readBody(
            req
          );

        let body;

        try {

          body =
            JSON.parse(
              raw
            );

        } catch {

          return sendJson(
            res,
            400,
            {
              error:
                'invalid_json'
            }
          );

        }

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


      // ======================================================
      // STATUS DO PEDIDO
      // ======================================================

      if (
        req.method === 'GET' &&
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

        if (
          !order
        ) {

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


      // ======================================================
      // WEBHOOK SYNCPAY
      // ======================================================

      if (
        req.method === 'POST' &&
        url.pathname ===
          '/webhooks/syncpay'
      ) {

        const raw =
          await readBody(
            req
          );

        const result =
          handleSyncPayWebhook(
            raw,
            req
          );

        return sendJson(
          res,
          result.status,
          result.body
        );
      }


      // ======================================================
      // VISITAS
      // ======================================================

      if (
        req.method === 'GET' &&
        url.pathname ===
          '/api/visitas'
      ) {

        if (
          !checkAdminAuth(
            req,
            res
          )
        ) {
          return;
        }

        return sendJson(
          res,
          200,
          visitStats()
        );
      }


      // ======================================================
      // ARQUIVOS DO SITE
      // ======================================================

      if (
        req.method === 'GET'
      ) {

        const accept =
          req.headers.accept ||
          '';

        if (
          accept.includes(
            'text/html'
          )
        ) {
          recordVisit(
            req,
            url.pathname
          );
        }

        return serveStatic(
          req,
          res,
          url.pathname
        );
      }


      // ======================================================
      // MÉTODO NÃO PERMITIDO
      // ======================================================

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
        error.status ||
          500,
        {
          error:
            error.message ||
            'internal_error'
        }
      );
    }
  }
);


// ============================================================
// INICIALIZAÇÃO DOS ARQUIVOS
// ============================================================

ensureDataFile();

ensureVisitsFile();

ensureGatewayConfigFile();


// ============================================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================================

server.listen(
  PORT,
  '0.0.0.0',
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


    if (
      !SYNCPAY_CLIENT_ID ||
      !SYNCPAY_CLIENT_SECRET
    ) {
      console.warn(
        'SyncPay credentials are not configured.'
      );
    }

  }
);

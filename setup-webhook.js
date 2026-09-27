const fs = require('node:fs');
const path = require('node:path');

loadDotEnv(path.join(__dirname, '.env'));

const BASE_URL = process.env.SYNCPAY_BASE_URL || 'https://api.syncpayments.com.br';
const CLIENT_ID = process.env.SYNCPAY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SYNCPAY_CLIENT_SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function fail(message) { console.error(`\nERRO: ${message}\n`); process.exit(1); }

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) fail('configure SYNCPAY_CLIENT_ID e SYNCPAY_CLIENT_SECRET no .env');
  if (!PUBLIC_BASE_URL || !PUBLIC_BASE_URL.startsWith('https://')) fail('PUBLIC_BASE_URL precisa ser uma URL HTTPS pública, por exemplo https://seu-dominio.com');

  const auth = await fetch(`${BASE_URL}/api/partner/v1/auth-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  });
  const authData = await auth.json().catch(() => ({}));
  if (!auth.ok || !authData.access_token) fail(`falha de autenticação (${auth.status}): ${JSON.stringify(authData)}`);

  const webhookUrl = `${PUBLIC_BASE_URL}/webhooks/syncpay`;
  const response = await fetch(`${BASE_URL}/api/partner/v1/webhooks`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authData.access_token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      title: 'Evelyn - Transações',
      url: webhookUrl,
      event: 'transaction',
      trigger_all_products: true
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) fail(`falha ao criar webhook (${response.status}): ${JSON.stringify(data)}`);

  console.log('\nWebhook criado com sucesso.');
  console.log(`ID: ${data.id}`);
  console.log(`URL: ${data.url}`);
  console.log(`Segredo: ${data.token}`);
  console.log('\nCopie o segredo para SYNCPAY_WEBHOOK_SECRET no .env e reinicie o servidor.');
}

main().catch(err => fail(err.message));

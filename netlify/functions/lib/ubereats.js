// ============================================================
// core/ubereats.js — Conexión con la API de Uber Eats (Marketplace)
// Doc: https://developer.uber.com/docs/eats/guides/order-integration
// ============================================================
//
// Autenticación: OAuth 2.0 client_credentials.
//   POST https://auth.uber.com/oauth/v2/token
//   scope: eats.order
//
// Firma de webhooks: header X-Uber-Signature = HMAC-SHA256(body, client_secret)
// en hexadecimal en minúsculas.

const crypto = require("crypto");

const AUTH_URL = "https://auth.uber.com/oauth/v2/token";
const API_BASE = "https://api.uber.com/v1/eats";

// Cache simple del token en memoria (dura lo que viva la función).
let _token = null;
let _tokenExp = 0;

async function getAccessToken() {
  const now = Date.now();
  if (_token && now < _tokenExp - 60000) return _token; // margen de 1 min

  const clientId = process.env.UBEREATS_CLIENT_ID;
  const clientSecret = process.env.UBEREATS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan UBEREATS_CLIENT_ID / UBEREATS_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "eats.order",
  });

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Uber auth ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  _token = data.access_token;
  _tokenExp = now + (data.expires_in || 2592000) * 1000;
  return _token;
}

// Verifica la firma del webhook. Devuelve true/false.
function verificarFirma(rawBody, firmaHeader) {
  const clientSecret = process.env.UBEREATS_CLIENT_SECRET;
  if (!clientSecret || !firmaHeader) return false;
  const esperado = crypto
    .createHmac("sha256", clientSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  // Comparación segura contra timing attacks.
  try {
    return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(firmaHeader.toLowerCase()));
  } catch {
    return false;
  }
}

// Trae el detalle de la orden usando el resource_href del webhook.
async function getOrder(resourceHref) {
  const token = await getAccessToken();
  const res = await fetch(resourceHref, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Uber getOrder ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// Acepta la orden en Uber. reason opcional.
async function aceptarOrden(orderId) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/orders/${orderId}/accept_pos_order`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "Aceptada automáticamente por LaTech OMS" }),
  });
  return res.ok;
}

// Rechaza la orden en Uber (p. ej. por falta de stock).
async function rechazarOrden(orderId, motivo) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/orders/${orderId}/deny_pos_order`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: {
        explanation: motivo || "Sin stock disponible",
        code: "STORE_CLOSED", // [CONFIRMAR] código de motivo válido de Uber
      },
    }),
  });
  return res.ok;
}

module.exports = {
  getAccessToken,
  verificarFirma,
  getOrder,
  aceptarOrden,
  rechazarOrden,
};

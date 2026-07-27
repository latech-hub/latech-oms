// ============================================================
// _lib/ubereats.js — Integración con Uber Eats (Cloudflare Pages, ESM)
// Scopes: eats.pos_provisioning, eats.order, eats.store
// Firma de webhook con Web Crypto (HMAC-SHA256). Sin dependencias de Node.
// ============================================================

export function createUber(env) {
  const ENV = (env.UBER_ENV || "sandbox").toLowerCase();
  const AUTH_URL = "https://auth.uber.com/oauth/v2/token"; // mismo para sandbox y prod
  const API = ENV === "production" ? "https://api.uber.com" : "https://test-api.uber.com";
  // El token de aplicación (client_credentials) SOLO admite scopes de ese
  // grant type: eats.order y eats.store. El scope eats.pos_provisioning usa
  // grant type authorization_code (token de usuario) y va en un flujo aparte.
  const SCOPES = "eats.order eats.store";

  function creds() {
    if (ENV === "production") {
      return { id: env.UBEREATS_CLIENT_ID, secret: env.UBEREATS_CLIENT_SECRET };
    }
    return { id: env.UBEREATS_TEST_CLIENT_ID, secret: env.UBEREATS_TEST_CLIENT_SECRET };
  }

  let _token = null;
  let _exp = 0;

  async function getAccessToken() {
    const now = Date.now();
    if (_token && now < _exp - 60000) return _token;
    const { id, secret } = creds();
    if (!id || !secret) throw new Error(`Faltan credenciales Uber para entorno "${ENV}".`);

    const body = new URLSearchParams({
      client_id: id,
      client_secret: secret,
      grant_type: "client_credentials",
      scope: SCOPES,
    });
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`Uber auth ${res.status}: ${await res.text()}`);
    const data = await res.json();
    _token = data.access_token;
    _exp = now + (data.expires_in || 2592000) * 1000;
    return _token;
  }

  // HMAC-SHA256 en hex minúsculas con Web Crypto (nativo en Cloudflare).
  async function hmacHex(key, message) {
    const enc = new TextEncoder();
    const ck = await crypto.subtle.importKey(
      "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", ck, enc.encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Verifica la firma X-Uber-Signature (async).
  async function verificarFirma(rawBody, firmaHeader) {
    const { secret } = creds();
    if (!secret || !firmaHeader) return false;
    const esperado = await hmacHex(secret, rawBody);
    const recibido = String(firmaHeader).toLowerCase();
    // Comparación de longitud constante simple.
    if (esperado.length !== recibido.length) return false;
    let diff = 0;
    for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
    return diff === 0;
  }

  async function api(method, path, jsonBody) {
    const token = await getAccessToken();
    const opts = { method, headers: { authorization: `Bearer ${token}` } };
    if (jsonBody !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(jsonBody);
    }
    const res = await fetch(`${API}${path}`, opts);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { ok: res.ok, status: res.status, json, text };
  }

  // ---- eats.order ----
  async function getOrder(resourceHref) {
    const token = await getAccessToken();
    const res = await fetch(resourceHref, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Uber getOrder ${res.status}: ${await res.text()}`);
    return res.json();
  }
  async function aceptarOrden(orderId) {
    return (await api("POST", `/v1/eats/orders/${orderId}/accept_pos_order`, {
      reason: "Aceptada automáticamente por LaTech OMS",
    })).ok;
  }
  async function rechazarOrden(orderId, motivo) {
    return (await api("POST", `/v1/eats/orders/${orderId}/deny_pos_order`, {
      reason: { explanation: motivo || "No se puede inyectar la orden en el POS" },
    })).ok;
  }
  async function cancelarOrden(orderId, motivo) {
    return (await api("POST", `/v1/eats/orders/${orderId}/cancel`, {
      reason: motivo || "Cancelada por el comercio",
    })).ok; // [CONFIRMAR ruta]
  }
  async function resolverFulfillment(orderId, payload) {
    return (await api("POST", `/v1/eats/orders/${orderId}/fulfillment_issues/resolve`, payload || {})).ok; // [CONFIRMAR]
  }
  async function marcarListo(orderId) {
    return (await api("POST", `/v1/eats/orders/${orderId}/restaurant/ready`, {})).ok; // [CONFIRMAR]
  }

  // ---- eats.pos_provisioning ----
  async function activarIntegracion(storeId, config = {}) {
    return api("POST", `/v1/eats/stores/${storeId}/pos_data`, {
      integrator_store_id: config.partnerStoreId || storeId,
      integrator_brand_id: config.brandId,
      pos_integration_enabled: true,
      ...(config.extra || {}),
    });
  }
  async function getIntegracion(storeId) {
    return api("GET", `/v1/eats/stores/${storeId}/pos_data`);
  }
  async function actualizarIntegracion(storeId, cambios) {
    return api("PATCH", `/v1/eats/stores/${storeId}/pos_data`, cambios || {});
  }
  async function quitarIntegracion(storeId) {
    return api("DELETE", `/v1/eats/stores/${storeId}/pos_data`);
  }

  // ---- eats.store ----
  async function getStores() {
    return api("GET", `/v1/eats/stores`);
  }
  async function getEstadoTienda(storeId) {
    return api("GET", `/v1/eats/stores/${storeId}/status`);
  }
  async function setEstadoTienda(storeId, status, reason) {
    return api("POST", `/v1/eats/stores/${storeId}/status`, { status, reason });
  }
  async function updatePrepTime(storeId, minutos) {
    return api("POST", `/v1/eats/stores/${storeId}/prep_time`, { prep_time_minutes: minutos }); // [CONFIRMAR]
  }

  return {
    ENV, API, AUTH_URL,
    getAccessToken, verificarFirma,
    getOrder, aceptarOrden, rechazarOrden, cancelarOrden, resolverFulfillment, marcarListo,
    activarIntegracion, getIntegracion, actualizarIntegracion, quitarIntegracion,
    getStores, getEstadoTienda, setEstadoTienda, updatePrepTime,
  };
}

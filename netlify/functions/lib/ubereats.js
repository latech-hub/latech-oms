// ============================================================
// core/ubereats.js — Integración con la API de Uber Eats (Marketplace)
// Cubre los 3 scopes que Uber confirmó para La Tech:
//   eats.pos_provisioning, eats.order, eats.store
// Doc: https://developer.uber.com/docs/eats/guides/order-integration
// ============================================================
//
// Entorno conmutable con la variable UBER_ENV:
//   "sandbox" (por defecto)  -> test-api.uber.com / sandbox-auth.uber.com
//   "production"             -> api.uber.com / auth.uber.com
//
// Node 18+ (Netlify) trae fetch y crypto global — sin dependencias externas.

const crypto = require("crypto");

const ENV = (process.env.UBER_ENV || "sandbox").toLowerCase();
const AUTH_URL =
  ENV === "production"
    ? "https://auth.uber.com/oauth/v2/token"
    : "https://sandbox-auth.uber.com/oauth/v2/token";
const API =
  ENV === "production" ? "https://api.uber.com" : "https://test-api.uber.com";

const SCOPES = "eats.pos_provisioning eats.order eats.store";

// ------------------------------------------------------------
// Autenticación OAuth 2.0 (client_credentials). Cachea el token.
// ------------------------------------------------------------
let _token = null;
let _tokenExp = 0;

async function getAccessToken() {
  const now = Date.now();
  if (_token && now < _tokenExp - 60000) return _token;

  const clientId = process.env.UBEREATS_CLIENT_ID;
  const clientSecret = process.env.UBEREATS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Faltan UBEREATS_CLIENT_ID / UBEREATS_CLIENT_SECRET.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
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
  _tokenExp = now + (data.expires_in || 2592000) * 1000;
  return _token;
}

// Helper para llamar a la API con el token bearer.
async function api(method, path, jsonBody) {
  const token = await getAccessToken();
  const opts = {
    method,
    headers: { authorization: `Bearer ${token}` },
  };
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

// ------------------------------------------------------------
// Seguridad: verifica la firma X-Uber-Signature del webhook.
// ------------------------------------------------------------
function verificarFirma(rawBody, firmaHeader) {
  const clientSecret = process.env.UBEREATS_CLIENT_SECRET;
  if (!clientSecret || !firmaHeader) return false;
  const esperado = crypto
    .createHmac("sha256", clientSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(esperado),
      Buffer.from(String(firmaHeader).toLowerCase())
    );
  } catch {
    return false;
  }
}

// ============================================================
// SCOPE eats.order — Órdenes
// ============================================================

// Trae el detalle de la orden usando el resource_href del webhook.
async function getOrder(resourceHref) {
  const token = await getAccessToken();
  const res = await fetch(resourceHref, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Uber getOrder ${res.status}: ${await res.text()}`);
  return res.json();
}

// Aceptar orden.
async function aceptarOrden(orderId) {
  const r = await api("POST", `/v1/eats/orders/${orderId}/accept_pos_order`, {
    reason: "Aceptada automáticamente por LaTech OMS",
  });
  return r.ok;
}

// Rechazar orden con motivo.
async function rechazarOrden(orderId, motivo) {
  const r = await api("POST", `/v1/eats/orders/${orderId}/deny_pos_order`, {
    reason: { explanation: motivo || "No se puede inyectar la orden en el POS" },
  });
  return r.ok;
}

// Cancelar orden. [CONFIRMAR ruta exacta de cancelación en la referencia]
async function cancelarOrden(orderId, motivo) {
  const r = await api("POST", `/v1/eats/orders/${orderId}/cancel`, {
    reason: motivo || "Cancelada por el comercio",
  });
  return r.ok;
}

// Resolver problemas de cumplimiento (sustitución/quita de ítems sin stock).
// [CONFIRMAR ruta exacta: "Resolve Order Fulfillment"]
async function resolverFulfillment(orderId, payload) {
  const r = await api(
    "POST",
    `/v1/eats/orders/${orderId}/fulfillment_issues/resolve`,
    payload || {}
  );
  return r.ok;
}

// Marcar orden como lista. [CONFIRMAR: la doc básica indica que NO existe este
// endpoint en el flujo estándar; puede ser de una versión de API más nueva.]
async function marcarListo(orderId) {
  const r = await api("POST", `/v1/eats/orders/${orderId}/restaurant/ready`, {});
  return r.ok;
}

// ============================================================
// SCOPE eats.pos_provisioning — Configuración de la integración
// ============================================================

// Activar la integración de la app contra una tienda.
async function activarIntegracion(storeId, config) {
  const r = await api("POST", `/v1/eats/stores/${storeId}/pos_data`, {
    integrator_store_id: config?.partnerStoreId || storeId,
    integrator_brand_id: config?.brandId,
    pos_integration_enabled: true,
    ...config?.extra,
  });
  return r;
}

// Obtener la configuración de integración de la tienda.
async function getIntegracion(storeId) {
  return api("GET", `/v1/eats/stores/${storeId}/pos_data`);
}

// Actualizar la integración (p. ej. desactivar sin borrar).
async function actualizarIntegracion(storeId, cambios) {
  return api("PATCH", `/v1/eats/stores/${storeId}/pos_data`, cambios || {});
}

// Quitar/desprovisionar la integración de la tienda.
async function quitarIntegracion(storeId) {
  return api("DELETE", `/v1/eats/stores/${storeId}/pos_data`);
}

// ============================================================
// SCOPE eats.store — Tienda
// ============================================================

// Listar tiendas provisionadas a la app.
async function getStores() {
  return api("GET", `/v1/eats/stores`);
}

// Obtener el estado (online/offline) de la tienda.
async function getEstadoTienda(storeId) {
  return api("GET", `/v1/eats/stores/${storeId}/status`);
}

// Setear el estado de la tienda: "ONLINE" | "PAUSED".
async function setEstadoTienda(storeId, status, reason) {
  return api("POST", `/v1/eats/stores/${storeId}/status`, {
    status: status, // "ONLINE" | "PAUSED"
    reason: reason,
  });
}

// Actualizar el tiempo de preparación. [CONFIRMAR ruta exacta de "Update Prep Time"]
async function updatePrepTime(storeId, minutos) {
  return api("POST", `/v1/eats/stores/${storeId}/prep_time`, {
    prep_time_minutes: minutos,
  });
}

module.exports = {
  ENV, API, AUTH_URL,
  getAccessToken,
  verificarFirma,
  // órdenes
  getOrder, aceptarOrden, rechazarOrden, cancelarOrden, resolverFulfillment, marcarListo,
  // provisioning
  activarIntegracion, getIntegracion, actualizarIntegracion, quitarIntegracion,
  // tienda
  getStores, getEstadoTienda, setEstadoTienda, updatePrepTime,
};

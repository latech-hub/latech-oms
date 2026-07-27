// functions/diag/uber-usage.js — TEMPORAL. Genera uso (200) en scopes que el
// token de app SÍ acepta: eats.store.orders.read y eats.report (solo lectura),
// para que la telemetría de verificación de Uber los registre.
// URL: /diag/uber-usage   Quitar antes de prod.

const STORE_ID = "b2592fd4-7547-5484-b303-da171c44aa33";
const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
const API = "https://test-api.uber.com";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const env = context.env;
  const id = env.UBEREATS_TEST_CLIENT_ID || "";
  const secret = env.UBEREATS_TEST_CLIENT_SECRET || "";
  if (!id || !secret) return json({ error: "faltan credenciales de test" });

  async function token(scope) {
    const r = await fetch(AUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials", scope }),
    });
    const j = await r.json().catch(() => ({}));
    return j.access_token;
  }
  async function get(tok, path) {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j ?? (t || "").slice(0, 200) };
  }

  const out = {};

  // --- eats.store.orders.read ---
  const tOrders = await token("eats.store.orders.read");
  out.orders_read = tOrders
    ? { "GET /v1/eats/stores/{id}/created-orders": await get(tOrders, `/v1/eats/stores/${STORE_ID}/created-orders`) }
    : { error: "sin token orders.read" };

  // --- eats.report --- (probar rutas candidatas de "get report files")
  const tRep = await token("eats.report");
  if (tRep) {
    out.report = {};
    for (const p of [
      "/v1/eats/report",
      "/v1/eats/reports",
      "/v1/eats/report_files",
      `/v1/eats/stores/${STORE_ID}/report_files`,
      `/v1/eats/stores/${STORE_ID}/reports`,
    ]) {
      out.report[p] = await get(tRep, p);
    }
  } else {
    out.report = { error: "sin token report" };
  }

  return json(out);
}

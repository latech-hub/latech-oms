// functions/diag/uber-activar.js — TEMPORAL. Activa la integración POS.
// URL: /diag/uber-activar            -> solo diagnostica (no escribe)
//      /diag/uber-activar?confirm=si -> intenta ACTIVAR la integración POS
// Tienda: La Tech (Apoquindo). Quitar antes de prod.

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
  const confirm = new URL(context.request.url).searchParams.get("confirm") === "si";
  if (!id || !secret) return json({ error: "faltan credenciales de test" });

  const out = { store_id: STORE_ID, tokens: {}, pos_data: {} };

  async function token(scope) {
    const r = await fetch(AUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials", scope }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: Boolean(j.access_token), scope_otorgado: j.scope, error: j.access_token ? undefined : j, _tok: j.access_token };
  }

  // 1) ¿Qué scopes nos otorga el token de app?
  const full = "eats.order eats.store eats.pos_provisioning eats.store.orders.read eats.store.status.read eats.store.status.write";
  const tFull = await token(full);
  const tProv = await token("eats.pos_provisioning");
  out.tokens.full = { ok: tFull.ok, scope_otorgado: tFull.scope_otorgado, error: tFull.error };
  out.tokens.solo_pos_provisioning = { ok: tProv.ok, scope_otorgado: tProv.scope_otorgado, error: tProv.error };

  const tok = tFull._tok || tProv._tok;
  if (!tok) { out.nota = "No se pudo obtener token con esos scopes."; return json(out); }
  const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };

  async function probe(method, path, body) {
    try {
      const opt = { method, headers: H };
      if (body) opt.body = JSON.stringify(body);
      const r = await fetch(`${API}${path}`, opt);
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, body: j ?? (t || "").slice(0, 300) };
    } catch (e) { return { error: e.message }; }
  }

  // 2) GET pos_data (probar singular y plural).
  out.pos_data["GET /v1/eats/stores/{id}/pos_data (plural)"] = await probe("GET", `/v1/eats/stores/${STORE_ID}/pos_data`);
  out.pos_data["GET /v1/eats/store/{id}/pos_data (singular)"] = await probe("GET", `/v1/eats/store/${STORE_ID}/pos_data`);

  // 3) Si confirm=si: intentar ACTIVAR (probar métodos/rutas comunes).
  if (confirm) {
    const payload = { integrator_store_id: "CS43880", integration_enabled: true };
    out.activacion = {};
    out.activacion["PUT /v1/eats/stores/{id}/pos_data (plural)"] = await probe("PUT", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
    out.activacion["POST /v1/eats/stores/{id}/pos_data (plural)"] = await probe("POST", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
    out.activacion["PUT /v1/eats/store/{id}/pos_data (singular)"] = await probe("PUT", `/v1/eats/store/${STORE_ID}/pos_data`, payload);
    // Estado final
    out.pos_data_final = await probe("GET", `/v1/eats/stores/${STORE_ID}`);
  } else {
    out.nota = "Agrega ?confirm=si para intentar activar la integración POS.";
  }

  return json(out);
}

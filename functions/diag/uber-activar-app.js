// functions/diag/uber-activar-app.js — TEMPORAL. Intenta activar la
// integración POS usando el TOKEN DE APP (client_credentials, eats.store),
// que es el que el endpoint pos_data pide ("requires eats.store").
// URL: /diag/uber-activar-app            -> GET pos_data (ver estructura)
//      /diag/uber-activar-app?confirm=si -> intenta ACTIVAR
// Quitar antes de prod.

const STORE_ID = "b2592fd4-7547-5484-b303-da171c44aa33";
const PARTNER = "CS43880";
const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
const API = "https://test-api.uber.com";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const env = context.env;
  const confirm = new URL(context.request.url).searchParams.get("confirm") === "si";
  const body = new URLSearchParams({
    client_id: env.UBEREATS_TEST_CLIENT_ID, client_secret: env.UBEREATS_TEST_CLIENT_SECRET,
    grant_type: "client_credentials", scope: "eats.order eats.store",
  });
  const tokRes = await fetch(AUTH, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return json({ error: "sin token app", detalle: tok });
  const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };

  async function call(method, path, b) {
    const opt = { method, headers: H };
    if (b) opt.body = JSON.stringify(b);
    const r = await fetch(`${API}${path}`, opt);
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j ?? (t || "").slice(0, 300) };
  }

  const out = { token_scope: tok.scope };
  out["GET pos_data"] = await call("GET", `/v1/eats/stores/${STORE_ID}/pos_data`);

  if (confirm) {
    const payload = { integrator_store_id: PARTNER, integration_enabled: true, pos_integration_enabled: true };
    out["PUT pos_data"] = await call("PUT", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
    if (![200, 204].includes(out["PUT pos_data"].status)) {
      out["POST pos_data"] = await call("POST", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
    }
    out["estado_final (GET store)"] = await call("GET", `/v1/eats/stores/${STORE_ID}`);
  } else {
    out.nota = "Agrega ?confirm=si para intentar activar con el token de app.";
  }
  return json(out);
}

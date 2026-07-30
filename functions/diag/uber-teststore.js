// functions/diag/uber-teststore.js — TEMPORAL. Inspecciona la TIENDA DE PRUEBA
// recién creada por Uber (UUID 896c28ce-...). Usa el token de app (eats.store)
// para ver pos_data/estado/órdenes y confirmar si ya está integrada.
// URL: /diag/uber-teststore   Quitar antes de prod.

const STORE_ID = "896c28ce-be6c-4e66-a7fd-2fcdf35b7e35";
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

  const tokRes = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id, client_secret: secret,
      grant_type: "client_credentials", scope: "eats.order eats.store eats.store.orders.read",
    }),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return json({ error: "sin token app", detalle: tok });
  const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };

  async function get(path) {
    const r = await fetch(`${API}${path}`, { headers: H });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j ?? (t || "").slice(0, 400) };
  }

  const out = { store_id: STORE_ID, token_scope: tok.scope };
  out["GET store"] = await get(`/v1/eats/stores/${STORE_ID}`);
  out["GET pos_data"] = await get(`/v1/eats/stores/${STORE_ID}/pos_data`);
  out["GET status"] = await get(`/v1/eats/store/${STORE_ID}/status`);
  out["GET created-orders"] = await get(`/v1/eats/stores/${STORE_ID}/created-orders`);
  return json(out);
}

// functions/diag/uber-activar.js — TEMPORAL. Mapea qué scopes acepta el token
// de app (client_credentials) y ejercita lecturas para los válidos (genera uso).
// URL: /diag/uber-activar
// Quitar antes de prod.

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
    return { ok: Boolean(j.access_token), scope: j.scope, err: j.access_token ? undefined : j.error, _t: j.access_token };
  }

  const scopes = [
    "eats.order",
    "eats.store",
    "eats.store.status.read",
    "eats.store.status.write",
    "eats.store.orders.read",
    "eats.pos_provisioning",
    "eats.report",
    "eats.store.promotions.write",
    "eats.menu.read",
    "eats.menu.write",
  ];

  const out = { grant: "client_credentials", scopes: {} };
  for (const s of scopes) {
    const t = await token(s);
    out.scopes[s] = t.ok ? { valido: true, otorgado: t.scope } : { valido: false, error: t.err };
  }

  // Con el token válido (eats.order eats.store) ejercitar lecturas -> genera uso.
  const tok = (await token("eats.order eats.store"))._t;
  if (tok) {
    const H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
    async function get(path) {
      const r = await fetch(`${API}${path}`, { headers: H });
      return { status: r.status };
    }
    out.uso_generado = {
      "GET /v1/eats/stores": await get("/v1/eats/stores"),
      "GET /v1/eats/stores/{id}": await get(`/v1/eats/stores/${STORE_ID}`),
      "GET /v1/eats/store/{id}/status": await get(`/v1/eats/store/${STORE_ID}/status`),
    };
  }

  return json(out);
}

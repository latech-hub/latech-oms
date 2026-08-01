// functions/diag/store-status.js — TEMPORAL. Descubre qué scopes acepta el
// token client_credentials y genera uso de status (read/write) y Menú.
// URL: /diag/store-status[?write=si][&menu=si]   Quitar antes de prod.

const STORE_ID = "896c28ce-be6c-4e66-a7fd-2fcdf35b7e35";
const ITEM_ID = "external_item_1";
const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
const API = "https://test-api.uber.com";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

async function token(env, scope) {
  const params = {
    client_id: env.UBEREATS_TEST_CLIENT_ID, client_secret: env.UBEREATS_TEST_CLIENT_SECRET,
    grant_type: "client_credentials",
  };
  if (scope) params.scope = scope;
  const r = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return r.json().catch(() => ({}));
}

export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const doWrite = url.searchParams.get("write") === "si";
  const doMenu = url.searchParams.get("menu") === "si";

  const out = { store_id: STORE_ID, probe: {} };

  // Probar candidatos de scope para descubrir cuáles son válidos.
  const candidates = [
    "eats.order eats.store eats.store.orders.read eats.store.status.write eats.report",
    "eats.store eats.store.status.write",
    "eats.store.status.read",
    "eats.store.status.write",
    "eats.report",
    "eats.store.promotions.write",
    "eats.store",
  ];
  let best = null;
  for (const c of candidates) {
    const t = await token(env, c);
    if (t.access_token) {
      out.probe[c] = { ok: true, granted: t.scope };
      if (!best) best = t; // usar el primero (el más amplio) para las llamadas
    } else {
      out.probe[c] = { ok: false, error: t.error, desc: t.error_description };
    }
  }
  if (!best) return json({ ...out, error: "ningún scope válido" });

  out.token_scope = best.scope;
  const H = { Authorization: `Bearer ${best.access_token}`, "Content-Type": "application/json" };
  async function call(method, path, body) {
    const opt = { method, headers: H };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const r = await fetch(`${API}${path}`, opt);
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { path, status: r.status, body: j ?? (t || "").slice(0, 300) };
  }

  out.read = await call("GET", `/v1/eats/store/${STORE_ID}/status`);
  if (doWrite) out.write = await call("POST", `/v1/eats/store/${STORE_ID}/status`, { status: "ONLINE" });
  if (doMenu) {
    out.menu = await call("POST", `/v2/eats/stores/${STORE_ID}/menus/items/${ITEM_ID}`, {
      price_info: { price: 100 },
      suspension_info: { suspension: { suspend_until: 0 } },
    });
  }
  return json(out);
}

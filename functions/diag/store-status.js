// functions/diag/store-status.js — TEMPORAL. Genera uso de los scopes en hold:
//   eats.store.status.read / eats.store.status.write  (estado de tienda)
//   eats.store                                        (Update Item de menú)
// Pide un token con los scopes granulares para que Uber atribuya bien el uso.
// URL: /diag/store-status[?write=si][&menu=si]   Quitar antes de prod.

const STORE_ID = "896c28ce-be6c-4e66-a7fd-2fcdf35b7e35";
const ITEM_ID = "external_item_1";
const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
const API = "https://test-api.uber.com";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

async function token(env, scope) {
  const r = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.UBEREATS_TEST_CLIENT_ID, client_secret: env.UBEREATS_TEST_CLIENT_SECRET,
      grant_type: "client_credentials", scope,
    }),
  });
  return r.json().catch(() => ({}));
}

export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const doWrite = url.searchParams.get("write") === "si";
  const doMenu = url.searchParams.get("menu") === "si";

  const out = { store_id: STORE_ID };
  const scope = "eats.store eats.store.status.read eats.store.status.write";
  const tok = await token(env, scope);
  out.token_scope = tok.scope || null;
  if (!tok.access_token) return json({ ...out, error: "sin token", detalle: tok });
  const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };

  async function call(method, path, body) {
    const opt = { method, headers: H };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const r = await fetch(`${API}${path}`, opt);
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { path, status: r.status, body: j ?? (t || "").slice(0, 300) };
  }

  // READ status (eats.store.status.read)
  out.read = await call("GET", `/v1/eats/store/${STORE_ID}/status`);

  // WRITE status ONLINE (eats.store.status.write) - no destructivo
  if (doWrite) {
    out.write = await call("POST", `/v1/eats/store/${STORE_ID}/status`, { status: "ONLINE" });
  }

  // MENU: Update Item (eats.store). Probar variantes de ruta/payload.
  if (doMenu) {
    out.menu = {};
    const bodyItem = {
      price_info: { price: 100 },
      suspension_info: { suspension: { suspend_until: 0 } },
    };
    out.menu["POST /v2/eats/stores/{id}/menus/items/{item}"] =
      await call("POST", `/v2/eats/stores/${STORE_ID}/menus/items/${ITEM_ID}`, bodyItem);
  }
  return json(out);
}

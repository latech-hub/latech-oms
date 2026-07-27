// functions/diag/uber-stores.js — Probador de endpoints Uber (TEMPORAL).
// URL: /diag/uber-stores
// 1) Obtiene token de sandbox.
// 2) Lista tiendas (confirma la ruta correcta y si ya tenemos tiendas de prueba).
// 3) Si hay tienda, ejercita EN VIVO los endpoints de LECTURA (que generan uso
//    bajo los scopes de tienda sin requerir una orden real) y confirma
//    singular/plural de cada ruta.
// No expone el secret. Quitar antes de prod.

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const env = context.env;
  const id = env.UBEREATS_TEST_CLIENT_ID || "";
  const secret = env.UBEREATS_TEST_CLIENT_SECRET || "";
  const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
  const API = "https://test-api.uber.com";
  if (!id || !secret) return json({ error: "faltan credenciales de test" });

  const out = { scopes_probados: "eats.order eats.store", stores: {}, endpoints: {} };

  async function token(scope) {
    const r = await fetch(AUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials", scope }),
    });
    return r.json().catch(() => ({}));
  }
  const tok = await token("eats.order eats.store");
  out.token_ok = Boolean(tok.access_token);
  out.token_scope = tok.scope;
  if (!tok.access_token) { out.token_error = tok; return json(out); }
  const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };

  async function probe(method, path, body) {
    try {
      const opt = { method, headers: H };
      if (body) opt.body = JSON.stringify(body);
      const r = await fetch(`${API}${path}`, opt);
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, body: j ?? (t || "").slice(0, 250) };
    } catch (e) { return { error: e.message }; }
  }

  // 1) Listar tiendas — probar variantes de ruta.
  for (const p of ["/v1/eats/stores", "/v1/delivery/stores"]) {
    out.stores[p] = await probe("GET", p);
  }

  // Extraer un store_id de la primera respuesta 200 con lista.
  let storeId = null;
  for (const p of Object.keys(out.stores)) {
    const b = out.stores[p].body;
    const arr = Array.isArray(b) ? b : (b && (b.stores || b.data)) || [];
    if (out.stores[p].status === 200 && Array.isArray(arr) && arr.length) {
      storeId = arr[0].id || arr[0].store_id; break;
    }
  }
  out.store_id_detectado = storeId;

  // 2) Si hay tienda, ejercitar endpoints de LECTURA (generan uso, sin orden).
  if (storeId) {
    out.endpoints["GET /v1/eats/stores/{id}"] = await probe("GET", `/v1/eats/stores/${storeId}`);
    out.endpoints["GET /v1/eats/store/{id}/status (singular)"] = await probe("GET", `/v1/eats/store/${storeId}/status`);
    out.endpoints["GET /v1/eats/stores/{id}/status (plural)"] = await probe("GET", `/v1/eats/stores/${storeId}/status`);
    out.endpoints["GET /v1/eats/stores/{id}/created-orders"] = await probe("GET", `/v1/eats/stores/${storeId}/created-orders`);
    out.endpoints["GET /v1/eats/stores/{id}/menus"] = await probe("GET", `/v1/eats/stores/${storeId}/menus`);
  } else {
    out.nota = "No se detectaron tiendas de prueba: hay que pedir provisión de test store a Uber, o revisar el flujo de provisioning.";
  }

  return json(out);
}

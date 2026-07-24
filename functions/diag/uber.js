// functions/diag/uber.js — Diagnóstico TEMPORAL Uber (sandbox). URL: /diag/uber
// Prueba token OAuth + listar tiendas. No expone el token. Quitar antes de prod.

import { createUber } from "../_lib/ubereats.js";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const uber = createUber(context.env);
  const out = { env: uber.ENV, api: uber.API, auth_url: uber.AUTH_URL };
  try {
    let token = null;
    try {
      token = await uber.getAccessToken();
      out.token_ok = Boolean(token);
    } catch (e) {
      out.token_ok = false;
      out.token_error = e.message;
      return json(out);
    }
    const stores = await uber.getStores();
    out.get_stores_status = stores.status;
    const list = stores.json && (stores.json.stores || stores.json.data || stores.json);
    out.stores_count = Array.isArray(list) ? list.length : (list ? "n/a" : 0);
    out.stores_sample_keys =
      Array.isArray(list) && list.length && typeof list[0] === "object" ? Object.keys(list[0]) : null;
    if (!stores.ok) out.get_stores_error = (stores.text || "").slice(0, 300);
    return json(out);
  } catch (err) {
    out.error = err.message;
    return json(out);
  }
}

// ============================================================
// diag-uber.js — Diagnóstico TEMPORAL de la conexión con Uber (sandbox).
// Usa el módulo lib/ubereats (credenciales de test + auth.uber.com).
// No expone el token. Se elimina antes de producción.
// ============================================================

const uber = require("./lib/ubereats");

exports.handler = async () => {
  const out = { env: uber.ENV, api: uber.API, auth_url: uber.AUTH_URL };
  try {
    let token = null;
    try {
      token = await uber.getAccessToken();
      out.token_ok = Boolean(token);
    } catch (e) {
      out.token_ok = false;
      out.token_error = e.message;
      return { statusCode: 200, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(out, null, 2) };
    }

    // Listar tiendas provisionadas a la app (scope eats.store).
    const stores = await uber.getStores();
    out.get_stores_status = stores.status;
    const list = stores.json && (stores.json.stores || stores.json.data || stores.json);
    out.stores_count = Array.isArray(list) ? list.length : (list ? "n/a" : 0);
    out.stores_sample_keys =
      Array.isArray(list) && list.length && typeof list[0] === "object"
        ? Object.keys(list[0])
        : null;
    if (!stores.ok) out.get_stores_error = (stores.text || "").slice(0, 300);

    return { statusCode: 200, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(out, null, 2) };
  } catch (err) {
    out.error = err.message;
    return { statusCode: 500, body: JSON.stringify(out, null, 2) };
  }
};

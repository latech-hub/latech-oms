// functions/oauth/callback.js — Callback del flujo OAuth authorization_code
// (token de USUARIO) para obtener el scope eats.pos_provisioning y ACTIVAR la
// integración POS en la tienda. URL pública: /oauth/callback
// Flujo: Leonardo abre el link de autorización -> consiente -> Uber redirige
// aquí con ?code -> intercambiamos por token de usuario -> activamos POS.
// TEMPORAL para la validación; endurecer/quitar antes de prod.

// Tienda de PRUEBA provisionada por Uber (integrada con nuestra app).
const STORE_ID = "896c28ce-be6c-4e66-a7fd-2fcdf35b7e35";
const PARTNER_STORE_ID = "CS43880";
const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
const API = "https://test-api.uber.com";
const REDIRECT = "https://latech-oms.pages.dev/oauth/callback";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) return json({ paso: "autorizacion", error: err, descripcion: url.searchParams.get("error_description") });
  if (!code) return json({ error: "falta ?code (abre primero el link de autorización)" });

  // 1) Intercambiar code por token de usuario.
  const tokRes = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.UBEREATS_TEST_CLIENT_ID,
      client_secret: env.UBEREATS_TEST_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
    }),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return json({ paso: "token", status: tokRes.status, error: tok });

  const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };
  async function call(method, path, body) {
    const opt = { method, headers: H };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(`${API}${path}`, opt);
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, body: j ?? (t || "").slice(0, 300) };
  }

  const out = { token_ok: true, token_scope: tok.scope, activacion: {} };

  // 2) Ver estado actual de pos_data.
  out.activacion["GET pos_data"] = await call("GET", `/v1/eats/stores/${STORE_ID}/pos_data`);

  // 3) Escribir pos_data con el token de USUARIO (eats.pos_provisioning) para
  //    generar uso exitoso bajo ese scope. La tienda ya está integrada con
  //    nuestra app, así que reafirmamos la config (idempotente).
  const payload = { pos_integration_enabled: true, integration_enabled: true };
  out.activacion["POST pos_data"] = await call("POST", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
  if (![200, 204].includes(out.activacion["POST pos_data"].status)) {
    out.activacion["PUT pos_data"] = await call("PUT", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
    out.activacion["PATCH pos_data"] = await call("PATCH", `/v1/eats/stores/${STORE_ID}/pos_data`, payload);
  }

  // 4) Estado final de la tienda.
  out.estado_final = await call("GET", `/v1/eats/stores/${STORE_ID}`);
  return json(out);
}

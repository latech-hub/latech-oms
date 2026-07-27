// functions/diag/uber.js — Diagnóstico TEMPORAL Uber. URL: /diag/uber
// Prueba varias FORMAS de enviar las credenciales al endpoint de sandbox,
// para aislar si el problema es el formato de la petición. No expone el secret.
// Quitar antes de prod.

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

async function intento(url, headers, bodyObj) {
  const r = {};
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(bodyObj),
    });
    r.status = res.status;
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    r.token_ok = Boolean(j && j.access_token);
    if (!r.token_ok) r.respuesta = (t || "").slice(0, 250);
    if (j && j.scope) r.scope = j.scope;
  } catch (e) {
    r.error_red = e.message;
  }
  return r;
}

export async function onRequest(context) {
  const env = context.env;
  const id = env.UBEREATS_TEST_CLIENT_ID || "";
  const secret = env.UBEREATS_TEST_CLIENT_SECRET || "";
  const out = {
    client_id_len: id.length,
    client_id_prefix: id.slice(0, 6),
    client_id_suffix: id.slice(-4),
    secret_len: secret.length,
    // Detecta espacios/caracteres invisibles ocultos:
    secret_trim_len: secret.trim().length,
    secret_igual_trim: secret === secret.trim(),
    pruebas: {},
  };
  if (!id || !secret) { out.error = "faltan credenciales de test en env"; return json(out); }

  const URL_SB = "https://sandbox-login.uber.com/oauth/v2/token";
  const basic = "Basic " + btoa(`${id}:${secret}`);

  // 1) creds en el body + scope (método actual)
  out.pruebas["body_con_scope"] = await intento(URL_SB, {}, {
    client_id: id, client_secret: secret, grant_type: "client_credentials",
    scope: "eats.order eats.store",
  });
  // 2) creds en el body, SIN scope
  out.pruebas["body_sin_scope"] = await intento(URL_SB, {}, {
    client_id: id, client_secret: secret, grant_type: "client_credentials",
  });
  // 3) Basic auth header + scope en el body (id/secret NO en el body)
  out.pruebas["basic_auth"] = await intento(URL_SB, { Authorization: basic }, {
    grant_type: "client_credentials", scope: "eats.order eats.store",
  });

  return json(out);
}

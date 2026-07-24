// functions/diag/uber.js — Diagnóstico TEMPORAL Uber. URL: /diag/uber
// Verifica el client_id en uso y prueba varios hosts de auth con las
// credenciales de test. No expone el secret. Quitar antes de prod.

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
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
    pruebas: {},
  };
  if (!id || !secret) { out.error = "faltan credenciales de test en env"; return json(out); }

  const hosts = [
    "https://auth.uber.com/oauth/v2/token",
    "https://sandbox-auth.uber.com/oauth/v2/token",
    "https://login.uber.com/oauth/v2/token",
  ];
  for (const url of hosts) {
    const r = {};
    try {
      const body = new URLSearchParams({
        client_id: id, client_secret: secret,
        grant_type: "client_credentials",
        scope: "eats.pos_provisioning eats.order eats.store",
      });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
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
    out.pruebas[url] = r;
  }
  return json(out);
}

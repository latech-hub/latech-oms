// ============================================================
// diag-uber.js — Diagnóstico TEMPORAL de la conexión con Uber (sandbox).
// Prueba varios hosts de auth para descubrir cuál responde. Sin exponer token.
// Se elimina antes de producción.
// ============================================================

exports.handler = async () => {
  const clientId = process.env.UBEREATS_CLIENT_ID;
  const clientSecret = process.env.UBEREATS_CLIENT_SECRET;
  const out = { tiene_credenciales: Boolean(clientId && clientSecret) };
  if (!clientId || !clientSecret) {
    return { statusCode: 200, body: JSON.stringify(out, null, 2) };
  }

  const scopes = "eats.pos_provisioning eats.order eats.store";
  const authHosts = [
    "https://sandbox-auth.uber.com/oauth/v2/token",
    "https://auth.uber.com/oauth/v2/token",
    "https://login.uber.com/oauth/v2/token",
  ];

  out.pruebas = {};
  for (const url of authHosts) {
    const r = { };
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: scopes,
      });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      r.status = res.status;
      const t = await res.text();
      // Reportar si obtuvo token (sin exponerlo) o el error devuelto.
      let j = null; try { j = JSON.parse(t); } catch {}
      r.token_ok = Boolean(j && j.access_token);
      if (!r.token_ok) r.respuesta = (t || "").slice(0, 300);
      if (j && j.scope) r.scope_devuelto = j.scope;
    } catch (e) {
      r.error_red = e.message;
    }
    out.pruebas[url] = r;
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" },
    body: JSON.stringify(out, null, 2) };
};

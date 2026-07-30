// functions/diag/order-endpoints.js — TEMPORAL. Ejercita los endpoints de orden
// de Uber para (a) confirmar qué familia de rutas acepta nuestra app y (b)
// generar uso 200/204 para la verificación. Quitar antes de prod.
//
// Uso:
//   /diag/order-endpoints?id=<order_id>                     -> Get Order (ambas familias)
//   /diag/order-endpoints?id=<order_id>&action=ready        -> Mark Ready
//   /diag/order-endpoints?id=<order_id>&action=cancel       -> Cancel
//   /diag/order-endpoints?id=<order_id>&action=deny         -> Deny
//   /diag/order-endpoints?id=<order_id>&action=resolve      -> Resolve Fulfillment
//   &family=new  usa /v1/delivery/order/{id}/...   (API documentada v1.0.0)
//   &family=old  usa /v1/eats/orders/{id}/...      (rutas legacy que ya usamos)
//   sin family  -> prueba AMBAS y reporta el status de cada una.

const AUTH = "https://sandbox-login.uber.com/oauth/v2/token";
const API = "https://test-api.uber.com";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

// Rutas + body por acción y familia.
function rutas(id) {
  return {
    ready: {
      new: { path: `/v1/delivery/order/${id}/ready`, body: {} },
      old: { path: `/v1/eats/orders/${id}/restaurant/ready`, body: {} },
    },
    cancel: {
      new: { path: `/v1/delivery/order/${id}/cancel`, body: { cancellation_reason: { info: "prueba de integracion", type: "ITEM_ISSUE", client_error_code: "408" } } },
      old: { path: `/v1/eats/orders/${id}/cancel`, body: { reason: { info: "prueba de integracion", type: "ITEM_ISSUE" } } },
    },
    deny: {
      new: { path: `/v1/delivery/order/${id}/deny`, body: { deny_reason: { info: "prueba de integracion", type: "ITEM_ISSUE", client_error_code: "408" } } },
      old: { path: `/v1/eats/orders/${id}/deny_pos_order`, body: { reason: { info: "prueba de integracion", type: "ITEM_ISSUE" } } },
    },
    resolve: {
      new: { path: `/v1/delivery/order/${id}/resolve-fulfillment-issues`, body: { fulfillment_issues: [] } },
      old: { path: `/v1/eats/orders/${id}/fulfillment_issues/resolve`, body: { fulfillment_issues: [] } },
    },
  };
}

export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  const action = url.searchParams.get("action");
  const family = url.searchParams.get("family"); // new | old | (ambas)
  if (!id) return json({ error: "falta ?id=" });

  const tokRes = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.UBEREATS_TEST_CLIENT_ID, client_secret: env.UBEREATS_TEST_CLIENT_SECRET,
      grant_type: "client_credentials", scope: "eats.order eats.store",
    }),
  });
  const tok = await tokRes.json().catch(() => ({}));
  if (!tok.access_token) return json({ error: "sin token", detalle: tok });
  const H = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };

  async function call(method, path, body) {
    const opt = { method, headers: H };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const r = await fetch(`${API}${path}`, opt);
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { path, status: r.status, body: j ?? (t || "").slice(0, 300) };
  }

  const out = { id, token_scope: tok.scope };

  // Sin action -> solo Get Order por ambas familias (no destructivo).
  if (!action) {
    out.getOrder = {
      "GET /v1/delivery/order/{id}": await call("GET", `/v1/delivery/order/${id}`),
      "GET /v2/eats/order/{id}": await call("GET", `/v2/eats/order/${id}`),
    };
    out.nota = "agrega &action=ready|cancel|deny|resolve (y opcional &family=new|old)";
    return json(out);
  }

  const r = rutas(id)[action];
  if (!r) return json({ error: `action invalida: ${action}` });

  const fams = family ? [family] : ["new", "old"];
  out.action = action;
  out.resultados = {};
  for (const f of fams) {
    if (!r[f]) continue;
    out.resultados[f] = await call("POST", r[f].path, r[f].body);
  }
  return json(out);
}

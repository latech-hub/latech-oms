// functions/diag/relbase-inspect.js — Diagnóstico TEMPORAL.
// URL: /diag/relbase-inspect
// Lee listas de precios y las notas de venta recientes (con detalle) para
// identificar en qué campo del API va el "N° pedido" y la lista de precios.
// No expone tokens. Quitar antes de prod.

const BASE = "https://api.relbase.cl/api/v1";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const env = context.env;
  const headers = {
    company: env.RELBASE_COMPANY_TOKEN || "",
    authorization: env.RELBASE_USER_TOKEN || "",
    "Content-Type": "application/json",
  };
  if (!headers.company || !headers.authorization) return json({ error: "faltan tokens RelBase" });

  async function get(path) {
    const res = await fetch(`${BASE}${path}`, { headers });
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: res.status, json: j, text: t };
  }

  const out = {};

  // Listas de precios (para hallar la de "Uber").
  const lp = await get("/listaprecios");
  const listas = lp.json?.data?.price_lists || lp.json?.data?.pricelists || lp.json?.data || [];
  out.listas_precios = (Array.isArray(listas) ? listas : []).map((l) => ({ id: l.id, name: l.name }));

  // Notas de venta recientes (type_document 1001). Lista simple.
  const lista = await get("/dtes?type_document=1001");
  const dtes = lista.json?.data?.e_documents || lista.json?.data?.dtes || lista.json?.data || [];
  out.dtes_status = lista.status;
  out.dtes_muestra = (Array.isArray(dtes) ? dtes : []).slice(0, 5).map((d) => ({
    id: d.id, folio: d.folio, channel_id: d.channel_id,
    // posibles campos donde viviría el "N° pedido":
    label_value: d.label_value, num_order: d.num_order, n_order: d.n_order,
    order_number: d.order_number, comment: d.comment,
  }));

  // Detalle completo de la primera nota, para ver TODOS los campos disponibles.
  const first = (Array.isArray(dtes) ? dtes : [])[0];
  if (first && first.id) {
    const det = await get(`/dtes/${first.id}`);
    out.detalle_keys = det.json?.data ? Object.keys(det.json.data) : null;
    out.detalle = det.json?.data || det.text?.slice(0, 500);
  }

  return json(out);
}

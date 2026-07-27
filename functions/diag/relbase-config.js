// functions/diag/relbase-config.js — Diagnóstico TEMPORAL RelBase config.
// URL: /diag/relbase-config
// Recorre todas las páginas de canales y formas de pago y filtra los que
// contengan "uber". Trae tipos de documento, bodegas y algunos clientes
// para elegir un cliente por defecto de la nota de venta.
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
  if (!headers.company || !headers.authorization) {
    return json({ error: "faltan tokens RelBase en env" });
  }

  async function get(path) {
    const res = await fetch(`${BASE}${path}`, { headers });
    const t = await res.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: res.status, json: j, text: t };
  }

  // Recorre todas las páginas de un recurso y devuelve el arreglo interno.
  async function todos(path, key) {
    let page = 1, all = [], guard = 0;
    while (guard++ < 10) {
      const sep = path.includes("?") ? "&" : "?";
      const r = await get(`${path}${sep}page=${page}`);
      const d = r.json && r.json.data ? r.json.data : {};
      const arr = d[key] || [];
      all = all.concat(arr);
      const meta = r.json && r.json.meta ? r.json.meta : {};
      const total = meta.total_pages || 1;
      if (page >= total) break;
      page++;
    }
    return all;
  }

  const out = {};

  const docs = await get("/usuarios/documentos");
  out.type_documents = (docs.json?.data?.type_documents || []).map((d) => ({ id: d.id, name: d.name }));

  const bodegas = await get("/bodegas");
  out.bodegas = (bodegas.json?.data?.warehouses || []).map((b) => ({ id: b.id, name: b.name }));

  const canales = await todos("/canal_ventas", "channels");
  out.canales_uber = canales.filter((c) => /uber/i.test(c.name)).map((c) => ({ id: c.id, name: c.name, active: c.active }));
  out.canales_total = canales.length;

  const pagos = await todos("/forma_pagos", "type_payments");
  out.pagos_uber = pagos.filter((p) => /uber/i.test(p.name)).map((p) => ({ id: p.id, name: p.name }));
  out.pagos_total = pagos.length;

  // Primeros clientes para elegir uno por defecto (consumidor final).
  const clientes = await get("/clientes");
  const cl = clientes.json?.data?.customers || clientes.json?.data?.clients || [];
  out.clientes_muestra = cl.slice(0, 10).map((c) => ({
    id: c.id, name: c.name || c.business_name || c.razon_social, rut: c.rut,
  }));

  return json(out);
}

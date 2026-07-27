// functions/diag/relbase-config.js — Diagnóstico TEMPORAL RelBase config.
// URL: /diag/relbase-config
// Lee de la cuenta: tipos de documento que puede emitir el usuario (para
// hallar el id de "nota de venta"), canales de venta, bodegas y formas de
// pago. Con esos IDs se configura la creación de la nota de venta.
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
    try {
      const res = await fetch(`${BASE}${path}`, { headers });
      const t = await res.text();
      let j = null; try { j = JSON.parse(t); } catch {}
      return { status: res.status, data: j ?? t };
    } catch (e) {
      return { error: e.message };
    }
  }

  const out = {};
  out.documentos = await get("/usuarios/documentos");
  out.canal_ventas = await get("/canal_ventas");
  out.bodegas = await get("/bodegas");
  out.forma_pagos = await get("/forma_pagos");
  return json(out);
}

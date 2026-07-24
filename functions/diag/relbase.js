// functions/diag/relbase.js — Diagnóstico TEMPORAL RelBase. URL: /diag/relbase?sku=XXXX
// Busca un producto por SKU y muestra su stock (estructura). Quitar antes de prod.

import { createRelbase } from "../_lib/relbase.js";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const rb = createRelbase(context.env);
  const url = new URL(context.request.url);
  const sku = url.searchParams.get("sku") || "";
  try {
    const prod = sku ? await rb.buscarProductoPorSku(sku) : null;
    const out = {
      sku,
      encontrado: Boolean(prod),
      producto: prod
        ? { id: prod.id, code: prod.code, name: prod.name,
            variants: Array.isArray(prod.variants) ? prod.variants.length : 0 }
        : null,
    };
    if (prod) {
      const st = await rb.getStock(prod.id);
      out.stock = { total: st.total, bodegas: Array.isArray(st.bodegas) ? st.bodegas.length : 0 };
    }
    return json(out);
  } catch (e) {
    return json({ sku, error: e.message });
  }
}

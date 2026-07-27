// functions/diag/relbase-venta.js — Diagnóstico TEMPORAL: crea UNA nota de
// venta de prueba en RelBase para validar el payload. OJO: crea un documento
// REAL y descuenta stock REAL. Por eso SOLO actúa con ?confirm=si.
// URL: /diag/relbase-venta?sku=bm54&qty=1&price=1000&confirm=si
// Quitar antes de prod.

import { createRelbase } from "../_lib/relbase.js";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const rb = createRelbase(context.env);
  const url = new URL(context.request.url);
  const sku = url.searchParams.get("sku") || "";
  const qty = Number(url.searchParams.get("qty") || 1);
  const price = Number(url.searchParams.get("price") || 0);
  const confirm = url.searchParams.get("confirm") === "si";

  if (!sku) return json({ error: "falta ?sku=" });

  try {
    const prod = await rb.buscarProductoPorSku(sku);
    if (!prod) {
      // Debug: volcar lo que devuelve la búsqueda para entender la estructura.
      const res = await fetch(`https://api.relbase.cl/api/v1/productos?query=${encodeURIComponent(sku)}`, {
        headers: {
          company: context.env.RELBASE_COMPANY_TOKEN,
          authorization: context.env.RELBASE_USER_TOKEN,
          "Content-Type": "application/json",
        },
      });
      const raw = await res.json().catch(() => null);
      const arr = raw?.data?.products || raw?.data || [];
      const resumen = (Array.isArray(arr) ? arr : []).map((p) => ({
        id: p.id, code: p.code, name: p.name,
        variants: (p.variants || p.variations || []).map((v) => ({ id: v.id, code: v.code, name: v.name })),
      }));
      return json({ error: `producto no encontrado para SKU ${sku}`, status: res.status, encontrados: resumen.length, resumen });
    }
    const stock = await rb.getStock(prod.id);

    const preview = {
      sku,
      producto: { id: prod.id, code: prod.code, name: prod.name },
      stock: { total: stock.total, enBodega: stock.enBodega },
      config: rb.CFG,
      linea: { product_id: prod.id, quantity: qty, price },
    };

    if (!confirm) {
      return json({ modo: "preview (no se creó nada)", ...preview, nota: "agrega &confirm=si para crear la nota de venta REAL" });
    }

    const nota = await rb.crearNotaVenta({
      lineas: [{ product_id: prod.id, quantity: qty, price }],
      comentario: "PRUEBA LaTech OMS (anular)",
    });
    return json({ modo: "creada", ...preview, respuesta: nota });
  } catch (e) {
    return json({ error: e.message });
  }
}

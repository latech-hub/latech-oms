// functions/diag/procesar.js — TEMPORAL. Trae una orden de Uber por ID, muestra
// sus líneas y cómo resuelven contra RelBase. Con ?confirm=si, acepta la orden
// y crea la nota de venta (flujo completo). Genera uso de eats.order.
// URL: /diag/procesar?id=<order_id>[&confirm=si]   Quitar antes de prod.

import { createUber } from "../_lib/ubereats.js";
import { createRelbase } from "../_lib/relbase.js";
import { createOrders } from "../_lib/orders.js";

function json(o) {
  return new Response(JSON.stringify(o, null, 2), { headers: { "Content-Type": "application/json" } });
}

export async function onRequest(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");
  const confirm = url.searchParams.get("confirm") === "si";
  if (!id) return json({ error: "falta ?id=<order_id>" });

  const uber = createUber(env);
  const relbase = createRelbase(env);
  const orders = createOrders(env, uber, relbase);
  const API = "https://test-api.uber.com";
  const out = { id };

  // 1) Traer la orden (probar rutas v1/v2 del Get Order).
  let orden = null;
  for (const path of [`/v2/eats/order/${id}`, `/v1/eats/order/${id}`, `/v1/eats/orders/${id}`]) {
    try {
      orden = await uber.getOrder(`${API}${path}`);
      out.getOrder_path = path;
      break;
    } catch (e) {
      out[`getOrder ${path}`] = e.message;
    }
  }
  if (!orden) return json({ ...out, error: "no se pudo traer la orden" });

  out.orden_resumen = {
    id: orden.id, display_id: orden.display_id, current_state: orden.current_state,
    eater: orden.eater, items_raw: orden.cart?.items || orden.items,
  };

  // 2) Extraer líneas y resolver contra RelBase (producto + stock).
  out.lineas = orders.extraerLineas(orden);
  const { resueltas, faltantes } = await orders.resolverLineas(out.lineas);
  out.resueltas = resueltas;
  out.faltantes = faltantes;

  // 3) Si confirm: aceptar + crear nota de venta.
  if (confirm) {
    if (!resueltas.length || faltantes.length) {
      out.accion = "no se acepta: hay líneas sin resolver (revisa el SKU)";
    } else {
      out.aceptar_ok = await uber.aceptarOrden(id);
      try {
        const nota = await relbase.crearNotaVenta({
          lineas: resueltas,
          numeroPedido: `PRUEBA UBER ${orden.display_id || id.slice(0, 6)}`,
        });
        out.nota_venta = nota?.data ? { id: nota.data.id, folio: nota.data.folio } : nota;
      } catch (e) {
        out.nota_error = e.message;
      }
    }
  }
  return json(out);
}

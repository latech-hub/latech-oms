// ============================================================
// functions/webhook/ubereats.js — Receptor del webhook de Uber Eats
// Cloudflare Pages Function. URL pública: /webhook/ubereats
// ============================================================

import { createUber } from "../_lib/ubereats.js";
import { createRelbase } from "../_lib/relbase.js";
import { createOrders } from "../_lib/orders.js";

// Solo POST. Cloudflare responde 405 a otros métodos automáticamente.
export async function onRequestPost(context) {
  const env = context.env;
  const uber = createUber(env);

  const rawBody = await context.request.text();
  const firma = context.request.headers.get("x-uber-signature");

  // 1. Verificar que venga firmado por Uber.
  if (!(await uber.verificarFirma(rawBody, firma))) {
    return new Response("", { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch { return new Response("", { status: 400 }); }

  const tipo = payload.event_type;
  const href = payload.resource_href;

  // 2. Procesar según el evento. Aun si falla el procesamiento interno,
  //    respondemos 200 para que Uber no reintente en loop (el error queda en logs).
  try {
    const relbase = createRelbase(env);
    const orders = createOrders(env, uber, relbase);
    if (tipo === "orders.notification" || tipo === "orders.scheduled.notification") {
      const r = await orders.procesarOrdenUber(href);
      console.log("Orden procesada:", JSON.stringify(r));
    } else if (tipo === "orders.fulfillment_issues.resolved") {
      const r = await orders.procesarResolucionUber(href);
      console.log("Sustitución resuelta:", JSON.stringify(r));
    } else if (tipo === "orders.cancel" || tipo === "orders.failure") {
      console.log("Orden cancelada/fallida:", tipo, payload.meta?.resource_id);
    } else {
      console.log("Evento no manejado:", tipo);
    }
  } catch (err) {
    console.error("Error procesando webhook:", err && err.message);
  }

  // 3. Acuse de recibo a Uber.
  return new Response("", { status: 200 });
}

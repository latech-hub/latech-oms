// ============================================================
// ubereats-webhook.js — Receptor del webhook de Uber Eats
// URL pública: https://<tu-sitio>.netlify.app/.netlify/functions/ubereats-webhook
// ============================================================
//
// Uber envía notificaciones aquí. Debemos:
//   - Verificar la firma X-Uber-Signature.
//   - Responder 200 con cuerpo vacío RÁPIDO (para no gatillar reintentos).
//   - Procesar la orden (aceptar/rechazar + nota de venta).
//
// Eventos: orders.notification, orders.cancel,
//          orders.scheduled.notification, orders.fulfillment_issues.resolved

const uber = require("./lib/ubereats");
const { procesarOrdenUber, procesarResolucionUber } = require("./lib/orders");

exports.handler = async (event) => {
  // Solo POST.
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "" };
  }

  const rawBody = event.body || "";
  const firma = event.headers["x-uber-signature"] || event.headers["X-Uber-Signature"];

  // 1. Verificar que el mensaje venga de Uber.
  if (!uber.verificarFirma(rawBody, firma)) {
    console.warn("Firma de webhook inválida — se rechaza.");
    return { statusCode: 401, body: "" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "" };
  }

  const tipo = payload.event_type;
  const resourceHref = payload.resource_href;

  // 2. Procesar según el tipo de evento. No bloqueamos la respuesta 200:
  //    procesamos y luego respondemos. (Netlify espera a que termine el
  //    handler; el flujo Uber es corto. Si crece, mover a background function.)
  try {
    if (tipo === "orders.notification" || tipo === "orders.scheduled.notification") {
      const resultado = await procesarOrdenUber(resourceHref);
      console.log("Orden procesada:", JSON.stringify(resultado));
    } else if (tipo === "orders.fulfillment_issues.resolved") {
      // La persona resolvió la sustitución en el panel de Uber Orders.
      // Creamos la nota de venta con los productos definitivos.
      const resultado = await procesarResolucionUber(resourceHref);
      console.log("Sustitución resuelta:", JSON.stringify(resultado));
    } else if (tipo === "orders.cancel" || tipo === "orders.failure") {
      // Cancelación o fallo de la orden (p. ej. el cliente canceló durante la
      // resolución de sustitución). [CONFIRMAR] Si ya se creó nota de venta,
      // evaluar nota de crédito / reposición de stock en RelBase.
      console.log("Orden cancelada/fallida por Uber:", tipo, payload.meta?.resource_id);
    } else {
      console.log("Evento no manejado:", tipo);
    }
  } catch (err) {
    // Importante: aun si falla el procesamiento interno, respondemos 200
    // para que Uber no reintente en loop. El error queda en logs para revisar.
    console.error("Error procesando webhook:", err.message);
  }

  // 3. Acuse de recibo a Uber.
  return { statusCode: 200, body: "" };
};

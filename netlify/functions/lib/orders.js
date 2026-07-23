// ============================================================
// core/orders.js — Orquestación del flujo de una orden
// ============================================================
// Regla del negocio:
//   1. Revisar stock en RelBase (por SKU de cada línea).
//   2. Si HAY stock de todo: aceptar en Uber + crear nota de venta + descontar.
//   3. Si falta stock: rechazar en Uber (auto).
//
// Nota: la mayoría de las cancelaciones hoy son por quiebre de stock; esto
// las evita al validar contra RelBase antes de aceptar.

const relbase = require("./relbase");
const uber = require("./ubereats");

// Extrae líneas normalizadas desde el detalle de orden de Uber.
// Devuelve [{ sku, nombre, cantidad, precio }]
function extraerLineas(orden) {
  const items = orden?.cart?.items || orden?.items || [];
  return items.map((it) => ({
    // [CONFIRMAR] Uber entrega external_data / instance_id como referencia
    // del ítem del menú. El SKU real depende de cómo cargaste el menú.
    sku: it.external_data || it.id || it.instance_id,
    nombre: it.title || it.name,
    cantidad: it.quantity?.amount || it.quantity || 1,
    precio: (it.price?.unit_price?.amount ?? it.price ?? 0) / 100, // Uber usa centavos
  }));
}

// Procesa una orden de Uber de punta a punta.
async function procesarOrdenUber(resourceHref) {
  const orden = await uber.getOrder(resourceHref);
  const orderId = orden.id;
  const lineas = extraerLineas(orden);

  // 1. Revisar stock de cada línea en RelBase.
  const faltantes = [];
  for (const l of lineas) {
    if (!l.sku) {
      faltantes.push({ ...l, motivo: "sin SKU mapeado" });
      continue;
    }
    const prod = await relbase.buscarProductoPorSku(l.sku);
    const disponible = relbase.stockDeProducto(prod);
    if (disponible < l.cantidad) {
      faltantes.push({ ...l, disponible, motivo: "stock insuficiente" });
    }
  }

  // 2. Si falta stock de algo: NO rechazamos ni facturamos todavía.
  //    Se deja para SUSTITUCIÓN MANUAL en el panel de Uber Eats Orders
  //    (como hoy). Cuando la persona confirme el reemplazo, Uber envía el
  //    webhook orders.fulfillment_issues.resolved y ahí se crea la nota de
  //    venta con los productos finales (ver procesarResolucionUber).
  if (faltantes.length) {
    return { estado: "requiere_sustitucion_manual", orderId, faltantes };
  }

  // 3. Hay stock de todo: aceptar en Uber y crear la nota de venta en
  //    RelBase (descuenta stock).
  await uber.aceptarOrden(orderId);
  const nota = await relbase.crearNotaVenta({
    lineas,
    canalVentaId: process.env.RELBASE_CHANNEL_ID_UBER,
  });

  return { estado: "aceptada", orderId, notaVenta: nota?.data?.id || nota?.id };
}

// ------------------------------------------------------------
// Se llama cuando Uber avisa que una sustitución fue resuelta/confirmada
// (webhook orders.fulfillment_issues.resolved). Traemos la orden ACTUALIZADA
// y creamos la nota de venta con los productos definitivos.
// [CONFIRMAR en pruebas] que este webhook llega tras la sustitución manual.
// ------------------------------------------------------------
async function procesarResolucionUber(resourceHref) {
  const orden = await uber.getOrder(resourceHref);
  const lineas = extraerLineas(orden);
  const nota = await relbase.crearNotaVenta({
    lineas,
    canalVentaId: process.env.RELBASE_CHANNEL_ID_UBER,
  });
  return { estado: "aceptada_con_sustitucion", orderId: orden.id, notaVenta: nota?.data?.id || nota?.id };
}

module.exports = { procesarOrdenUber, procesarResolucionUber, extraerLineas };

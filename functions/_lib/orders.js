// ============================================================
// _lib/orders.js — Orquestación del flujo de una orden (Cloudflare, ESM)
// stock (RelBase) -> aceptar/derivar (Uber) -> nota de venta (RelBase)
// ============================================================

export function createOrders(env, uber, relbase) {
  // Extrae líneas normalizadas del detalle de orden de Uber.
  function extraerLineas(orden) {
    const items = (orden && (orden.cart?.items || orden.items)) || [];
    return items.map((it) => ({
      // [CONFIRMAR] cómo viene el SKU: external_data suele ser el id del comercio.
      sku: it.external_data || it.id || it.instance_id,
      nombre: it.title || it.name,
      cantidad: it.quantity?.amount || it.quantity || 1,
      precio: (it.price?.unit_price?.amount ?? it.price ?? 0) / 100, // Uber usa centavos
    }));
  }

  // Procesa una orden nueva de Uber.
  async function procesarOrdenUber(resourceHref) {
    const orden = await uber.getOrder(resourceHref);
    const orderId = orden.id;
    const lineas = extraerLineas(orden);

    // 1. Revisar stock en RelBase por SKU.
    const faltantes = [];
    for (const l of lineas) {
      if (!l.sku) { faltantes.push({ ...l, motivo: "sin SKU mapeado" }); continue; }
      const prod = await relbase.buscarProductoPorSku(l.sku);
      if (!prod) { faltantes.push({ ...l, motivo: "producto no encontrado" }); continue; }
      const { total } = await relbase.getStock(prod.id);
      if (total < l.cantidad) faltantes.push({ ...l, disponible: total, motivo: "stock insuficiente" });
    }

    // 2. Si falta stock: NO rechazar; dejar para sustitución manual en el panel
    //    de Uber Orders. La nota de venta se crea al resolverse (webhook).
    if (faltantes.length) {
      return { estado: "requiere_sustitucion_manual", orderId, faltantes };
    }

    // 3. Hay stock: aceptar + crear nota de venta (RelBase descuenta stock).
    await uber.aceptarOrden(orderId);
    const nota = await relbase.crearNotaVenta({
      lineas, canalVentaId: env.RELBASE_CHANNEL_ID_UBER,
    });
    return { estado: "aceptada", orderId, notaVenta: nota?.data?.id || nota?.id };
  }

  // Se llama tras resolverse una sustitución (orders.fulfillment_issues.resolved).
  async function procesarResolucionUber(resourceHref) {
    const orden = await uber.getOrder(resourceHref);
    const lineas = extraerLineas(orden);
    const nota = await relbase.crearNotaVenta({
      lineas, canalVentaId: env.RELBASE_CHANNEL_ID_UBER,
    });
    return { estado: "aceptada_con_sustitucion", orderId: orden.id, notaVenta: nota?.data?.id || nota?.id };
  }

  return { procesarOrdenUber, procesarResolucionUber, extraerLineas };
}

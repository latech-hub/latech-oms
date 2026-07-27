// ============================================================
// _lib/orders.js — Orquestación del flujo de una orden (Cloudflare, ESM)
// stock (RelBase) -> aceptar/derivar (Uber) -> nota de venta (RelBase)
// ============================================================

export function createOrders(env, uber, relbase) {
  // Extrae líneas normalizadas del detalle de orden de Uber.
  function extraerLineas(orden) {
    const items = (orden && (orden.cart?.items || orden.items)) || [];
    return items.map((it) => ({
      // El SKU del comercio suele venir en external_data (definido en el menú).
      sku: it.external_data || it.merchant_supplied_id || it.id || it.instance_id,
      nombre: it.title || it.name,
      cantidad: it.quantity?.amount || it.quantity || 1,
      // Uber envía montos en centavos de la moneda local.
      precio: (it.price?.unit_price?.amount ?? it.price ?? 0) / 100,
    }));
  }

  // Resuelve cada línea contra RelBase: producto + stock disponible.
  async function resolverLineas(lineas) {
    const resueltas = [];
    const faltantes = [];
    for (const l of lineas) {
      if (!l.sku) { faltantes.push({ ...l, motivo: "sin SKU mapeado" }); continue; }
      const prod = await relbase.buscarProductoPorSku(l.sku);
      if (!prod) { faltantes.push({ ...l, motivo: "producto no encontrado" }); continue; }
      const stock = await relbase.getStock(prod.id);
      const disponible = stock.enBodega != null ? stock.enBodega : stock.total;
      if (disponible < l.cantidad) {
        faltantes.push({ ...l, disponible, motivo: "stock insuficiente" });
        continue;
      }
      resueltas.push({
        product_id: prod.id,
        quantity: l.cantidad,
        price: l.precio,
        nombre: l.nombre,
      });
    }
    return { resueltas, faltantes };
  }

  // Procesa una orden nueva de Uber.
  async function procesarOrdenUber(resourceHref) {
    const orden = await uber.getOrder(resourceHref);
    const orderId = orden.id;
    const lineas = extraerLineas(orden);

    // 1. Resolver productos y stock en RelBase.
    const { resueltas, faltantes } = await resolverLineas(lineas);

    // 2. Si falta stock: NO rechazar; dejar para sustitución manual en el
    //    panel de Uber Orders. La nota de venta se crea al resolverse.
    if (faltantes.length) {
      return { estado: "requiere_sustitucion_manual", orderId, faltantes };
    }

    // 3. Hay stock: aceptar + crear nota de venta (RelBase descuenta stock).
    await uber.aceptarOrden(orderId);
    const nota = await relbase.crearNotaVenta({
      lineas: resueltas,
      comentario: `Uber Eats #${orden.display_id || orderId}`,
    });
    return { estado: "aceptada", orderId, notaVenta: nota?.data?.id || nota?.id };
  }

  // Se llama tras resolverse una sustitución (orders.fulfillment_issues.resolved).
  async function procesarResolucionUber(resourceHref) {
    const orden = await uber.getOrder(resourceHref);
    const lineas = extraerLineas(orden);
    const { resueltas, faltantes } = await resolverLineas(lineas);
    if (faltantes.length) {
      return { estado: "sustitucion_incompleta", orderId: orden.id, faltantes };
    }
    const nota = await relbase.crearNotaVenta({
      lineas: resueltas,
      comentario: `Uber Eats #${orden.display_id || orden.id} (sustitución)`,
    });
    return { estado: "aceptada_con_sustitucion", orderId: orden.id, notaVenta: nota?.data?.id || nota?.id };
  }

  return { procesarOrdenUber, procesarResolucionUber, extraerLineas, resolverLineas };
}

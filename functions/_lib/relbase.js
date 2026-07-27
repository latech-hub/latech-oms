// ============================================================
// _lib/relbase.js — Conexión con RelBase (Cloudflare Pages Functions, ESM)
// Endpoints confirmados en vivo:
//   Buscar por SKU:  GET /productos?query=<SKU>            (SKU = campo "code")
//   Leer stock:      GET /productos/{id}/stock_por_bodegas
//   Crear venta:     POST /dtes  con type_document = 1001 (Nota de venta)
// Config de la cuenta (confirmada vía /usuarios/documentos, /canal_ventas,
// /forma_pagos, /bodegas). Se puede sobreescribir por variables de entorno.
//   Nota de venta (type_document) = 1001
//   Bodega Principal (ware_house_id) = 2943
//   Canal "Uber"     (channel_id) = 4413
//   Forma pago "Uber"(type_payment_id) = 19833
// El cliente es opcional: en el uso real no se selecciona, así que NO se
// envía customer_id (salvo que se defina RELBASE_DEFAULT_CUSTOMER_ID).
// Auth headers: company = RELBASE_COMPANY_TOKEN, authorization = RELBASE_USER_TOKEN
// ============================================================

const BASE_URL = "https://api.relbase.cl/api/v1";

export function createRelbase(env) {
  const CFG = {
    typeDocumentNotaVenta: Number(env.RELBASE_NOTA_VENTA_TYPE || 1001),
    // Documento tributario en que se factura la nota de venta (39 = Boleta
    // electrónica, 33 = Factura). Uber = consumidor final => boleta.
    typeDocumentSii: Number(env.RELBASE_TYPE_DOCUMENT_SII || 39),
    wareHouseId: Number(env.RELBASE_WAREHOUSE_ID || 2943),
    channelId: Number(env.RELBASE_UBER_CHANNEL_ID || 4413),
    paymentId: Number(env.RELBASE_UBER_PAYMENT_ID || 19833),
    // Opcional: si se define, se envía como customer_id. Vacío => se omite.
    customerId: env.RELBASE_DEFAULT_CUSTOMER_ID ? Number(env.RELBASE_DEFAULT_CUSTOMER_ID) : null,
  };

  const headers = () => {
    if (!env.RELBASE_COMPANY_TOKEN || !env.RELBASE_USER_TOKEN) {
      throw new Error("Faltan RELBASE_COMPANY_TOKEN / RELBASE_USER_TOKEN.");
    }
    return {
      company: env.RELBASE_COMPANY_TOKEN,
      authorization: env.RELBASE_USER_TOKEN,
      "Content-Type": "application/json",
    };
  };

  // Reintenta ante 403 (rate limit: 7 req/s) con backoff.
  async function rb(path, options = {}, tries = 0) {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: headers() });
    if (res.status === 403 && tries < 3) {
      await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
      return rb(path, options, tries + 1);
    }
    return res;
  }

  function products(json) {
    const d = json && json.data ? json.data : json;
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.products)) return d.products;
    if (Array.isArray(d.data)) return d.data;
    return [];
  }

  // Buscar un producto por SKU (campo "code") usando el parámetro "query".
  // Devuelve el producto con su id (necesario para la nota de venta).
  async function buscarProductoPorSku(sku) {
    const res = await rb(`/productos?query=${encodeURIComponent(sku)}`, { method: "GET" });
    if (!res.ok) throw new Error(`RelBase productos ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const list = products(json);
    const s = String(sku).toLowerCase();
    return (
      list.find((p) => p.code && String(p.code).toLowerCase() === s) ||
      list.find((p) => p.barcode && String(p.barcode).toLowerCase() === s) ||
      null
    );
  }

  // Leer el stock total del producto sumando las bodegas.
  async function getStock(productId) {
    const res = await rb(`/productos/${productId}/stock_por_bodegas`, { method: "GET" });
    if (!res.ok) throw new Error(`RelBase stock ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const data = json.data || json;
    // RelBase devuelve { stocks: [{ ware_house_id, current_stock, ... }] }.
    let bodegas = [];
    if (Array.isArray(data)) bodegas = data;
    else if (Array.isArray(data.stocks)) bodegas = data.stocks;
    else if (Array.isArray(data.warehouses)) bodegas = data.warehouses;
    else if (Array.isArray(data.bodegas)) bodegas = data.bodegas;
    else if (Array.isArray(data.stock)) bodegas = data.stock;
    let total = 0;
    let enBodega = null;
    for (const b of bodegas) {
      const s = b.current_stock ?? b.stock ?? b.quantity ?? b.cantidad ?? b.available ?? 0;
      total += Number(s) || 0;
      const bid = b.ware_house_id ?? b.warehouse_id ?? b.id;
      if (Number(bid) === CFG.wareHouseId) enBodega = Number(s) || 0;
    }
    return { total, enBodega, bodegas, raw: data };
  }

  // Crea la Nota de venta (POST /dtes, type_document 1001).
  // Espejo exacto del proceso manual de Uber en RelBase:
  //   - label_value = "N° pedido" (nombre clienta + código Uber)
  //   - mnt_bruto = true (los precios de Uber vienen con IVA incluido)
  //   - continuous / addon_ecommerce = true (como las notas reales)
  //   - paid: por defecto NO se marca pagada (queda pendiente, igual que hoy);
  //     se puede forzar con RELBASE_MARCAR_PAGADO=1.
  // lineas: [{ product_id, quantity, price, tax_affected? }]
  async function crearNotaVenta({ lineas, numeroPedido, comentario }) {
    const hoy = new Date().toISOString().slice(0, 10);
    const marcarPagado = env.RELBASE_MARCAR_PAGADO === "1";
    const payload = {
      type_document: CFG.typeDocumentNotaVenta,
      type_document_sii: CFG.typeDocumentSii,
      start_date: hoy,
      end_date: hoy,
      channel_id: CFG.channelId,
      type_payment_id: CFG.paymentId,
      ware_house_id: CFG.wareHouseId,
      mnt_bruto: true,
      continuous: true,
      addon_ecommerce: true,
      paid: marcarPagado,
      label_value: numeroPedido || "",
      comment: comentario || "",
      products: (lineas || []).map((l) => ({
        product_id: l.product_id,
        quantity: l.quantity,
        price: l.price,
        tax_affected: l.tax_affected !== undefined ? l.tax_affected : true,
      })),
    };
    if (CFG.customerId) payload.customer_id = CFG.customerId;

    const res = await rb(`/dtes`, { method: "POST", body: JSON.stringify(payload) });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error(`RelBase nota de venta ${res.status}: ${text}`);
    return json;
  }

  return { CFG, buscarProductoPorSku, getStock, crearNotaVenta };
}

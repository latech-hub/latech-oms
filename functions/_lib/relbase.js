// ============================================================
// _lib/relbase.js — Conexión con RelBase (Cloudflare Pages Functions, ESM)
// Endpoints confirmados en vivo:
//   Buscar por SKU:  GET /productos?query=<SKU>   (SKU = campo "code")
//   Leer stock:      GET /productos/{id}/stock_por_bodegas
//   Crear venta:     (por confirmar endpoint exacto; ver crearNotaVenta)
// Auth headers: company = RELBASE_COMPANY_TOKEN, authorization = RELBASE_USER_TOKEN
// ============================================================

const BASE_URL = "https://api.relbase.cl/api/v1";

export function createRelbase(env) {
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
    if (!json) return [];
    if (Array.isArray(json.data)) return json.data;
    if (json.data && Array.isArray(json.data.products)) return json.data.products;
    return [];
  }

  // Buscar un producto por SKU (campo "code") usando el parámetro "query".
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
  // Endpoint dedicado: /productos/{id}/stock_por_bodegas
  async function getStock(productId) {
    const res = await rb(`/productos/${productId}/stock_por_bodegas`, { method: "GET" });
    if (!res.ok) throw new Error(`RelBase stock ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const data = json.data || json;
    // La estructura exacta se confirma en la 1a prueba real. Buscamos un
    // arreglo de bodegas y sumamos su stock.
    let bodegas = [];
    if (Array.isArray(data)) bodegas = data;
    else if (data && Array.isArray(data.warehouses)) bodegas = data.warehouses;
    else if (data && Array.isArray(data.bodegas)) bodegas = data.bodegas;
    else if (data && Array.isArray(data.stock)) bodegas = data.stock;
    let total = 0;
    for (const b of bodegas) {
      const s = b.stock ?? b.quantity ?? b.cantidad ?? b.available ?? 0;
      total += Number(s) || 0;
    }
    return { total, bodegas, raw: data };
  }

  // Crear la nota de venta. [CONFIRMAR endpoint: en el Swagger no hay
  // "notas_venta" separado; la venta puede ir por POST /dtes con el tipo
  // adecuado. Se ajusta al confirmar con RelBase.]
  async function crearNotaVenta({ lineas, cliente, canalVentaId }) {
    const payload = {
      // [CONFIRMAR] estructura real del documento de venta.
      customer_id: cliente?.id || env.RELBASE_DEFAULT_CUSTOMER_ID,
      channel_id: canalVentaId || env.RELBASE_CHANNEL_ID_UBER,
      date: new Date().toISOString().slice(0, 10),
      products: (lineas || []).map((l) => ({
        code: l.sku,
        name: l.nombre,
        quantity: l.cantidad,
        price: l.precio,
      })),
    };
    // [CONFIRMAR] ruta real. Placeholder: /dtes (documento de venta).
    const res = await rb(`/dtes`, { method: "POST", body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`RelBase venta ${res.status}: ${await res.text()}`);
    return res.json();
  }

  return { buscarProductoPorSku, getStock, crearNotaVenta };
}

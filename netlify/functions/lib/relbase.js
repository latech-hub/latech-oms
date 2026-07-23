// ============================================================
// core/relbase.js — Conexión con RelBase (stock + nota de venta)
// Sistema de ventas de La Tech. Doc API: https://apidocs.relbase.cl
// ============================================================
//
// Autenticación (headers):
//   company:       <RELBASE_COMPANY_TOKEN>
//   authorization: <RELBASE_USER_TOKEN>
//
// Base URL: https://api.relbase.cl/api/v1
// Rate limit: 7 solicitudes/segundo.
//
// Node 18+ (Netlify) trae fetch global — sin dependencias externas.

const BASE_URL = "https://api.relbase.cl/api/v1";

function headers() {
  const company = process.env.RELBASE_COMPANY_TOKEN;
  const user = process.env.RELBASE_USER_TOKEN;
  if (!company || !user) {
    throw new Error("Faltan RELBASE_COMPANY_TOKEN / RELBASE_USER_TOKEN en variables de entorno.");
  }
  return {
    company,
    authorization: user,
    "Content-Type": "application/json",
  };
}

// Pequeña ayuda: reintenta ante error 403 (rate limit) con backoff.
async function relbaseFetch(path, options = {}, tries = 0) {
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers: headers() });
  if (res.status === 403 && tries < 3) {
    await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
    return relbaseFetch(path, options, tries + 1);
  }
  return res;
}

// ------------------------------------------------------------
// Buscar un producto por SKU (código) y devolver su stock.
// ------------------------------------------------------------
async function buscarProductoPorSku(sku) {
  // La API de productos permite filtrar; usamos búsqueda por código.
  // Devuelve el primer producto que calce con el SKU.
  const res = await relbaseFetch(`/productos?code=${encodeURIComponent(sku)}`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`RelBase productos ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const lista = data.data || data.productos || [];
  return Array.isArray(lista) && lista.length ? lista[0] : null;
}

// Devuelve el stock disponible de un producto (número). 0 si no hay.
function stockDeProducto(producto) {
  if (!producto) return 0;
  // Los campos exactos de stock se confirman en la 1a prueba real.
  // Candidatos comunes en RelBase: stock, quantity, current_stock.
  const s = producto.stock ?? producto.quantity ?? producto.current_stock ?? 0;
  return Number(s) || 0;
}

// ------------------------------------------------------------
// Crear una Nota de Venta en RelBase a partir de líneas de la orden.
// lineas: [{ sku, nombre, cantidad, precio }]
// ------------------------------------------------------------
// NOTA: el esquema exacto del payload de nota de venta se confirma contra
// apidocs.relbase.cl y con la primera llamada real. Dejamos la construcción
// en un solo lugar para ajustarla fácil. Marcado con [CONFIRMAR].
async function crearNotaVenta({ lineas, cliente, canalVentaId }) {
  const payload = {
    nota_venta: {
      // [CONFIRMAR] cliente por defecto (consumidor final) o mapeo real.
      customer_id: cliente?.id || process.env.RELBASE_DEFAULT_CUSTOMER_ID,
      channel_id: canalVentaId || process.env.RELBASE_CHANNEL_ID, // canal de venta (Uber/PedidosYa)
      date: new Date().toISOString().slice(0, 10),
      // [CONFIRMAR] nombre del arreglo de líneas: products / details / items
      products: lineas.map((l) => ({
        code: l.sku,
        name: l.nombre,
        quantity: l.cantidad,
        price: l.precio,
      })),
    },
  };

  const res = await relbaseFetch(`/notas_venta`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`RelBase nota_venta ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

module.exports = {
  buscarProductoPorSku,
  stockDeProducto,
  crearNotaVenta,
};

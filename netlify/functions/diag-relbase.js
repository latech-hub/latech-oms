// ============================================================
// diag-relbase.js — Diagnóstico TEMPORAL. Busca un producto por SKU
// y devuelve su estructura de stock (para modelar la lógica).
// Llamar con ?sku=XXXX . Se elimina antes de producción.
// ============================================================

const BASE_URL = "https://api.relbase.cl/api/v1";

exports.handler = async (event) => {
  const company = process.env.RELBASE_COMPANY_TOKEN;
  const user = process.env.RELBASE_USER_TOKEN;
  if (!company || !user) {
    return { statusCode: 500, body: JSON.stringify({ error: "faltan tokens" }) };
  }
  const H = { company, authorization: user, "Content-Type": "application/json" };
  const sku = (event.queryStringParameters && event.queryStringParameters.sku) || "";

  async function get(path) {
    const r = await fetch(`${BASE_URL}${path}`, { method: "GET", headers: H });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, json: j };
  }

  function productsOf(j) {
    if (!j) return [];
    if (Array.isArray(j.data)) return j.data;
    if (j.data && Array.isArray(j.data.products)) return j.data.products;
    return [];
  }

  try {
    const s = sku.toLowerCase();
    // Probar distintas formas de filtrar por SKU en RelBase.
    const intentos = [
      `/productos?code=${encodeURIComponent(sku)}`,
      `/productos?value=${encodeURIComponent(sku)}`,
      `/productos?search=${encodeURIComponent(sku)}`,
      `/productos?name=${encodeURIComponent(sku)}`,
    ];
    let encontrado = null, via = null, diag = {};
    for (const p of intentos) {
      const res = await get(p);
      const list = productsOf(res.json);
      const total = res.json && res.json.meta ? res.json.meta.total_count : null;
      diag[p] = { status: res.status, total_count: total, returned: list.length,
        sample: list.slice(0, 3).map((x) => ({ code: x.code, name: x.name })) };
      const match = list.find(
        (x) => (x.code && x.code.toLowerCase() === s) ||
               (x.barcode && String(x.barcode).toLowerCase() === s) ||
               (x.code && x.code.toLowerCase().includes(s)) ||
               (x.name && x.name.toLowerCase().includes(s))
      );
      if (match) { encontrado = match; via = p; break; }
    }

    if (!encontrado) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, encontrado: false, diag }, null, 2) };
    }

    // Pedir el detalle para ver inventarios/variantes con stock.
    const det = await get(`/productos/${encontrado.id}`);
    const prod = det.json && det.json.data ? (det.json.data.product || det.json.data) : null;

    const resumen = prod ? {
      id: prod.id, code: prod.code, name: prod.name,
      price: prod.price, price_sale: prod.price_sale,
      is_inventory: prod.is_inventory,
      inventories: prod.inventories,       // stock por bodega (producto simple)
      variants_count: Array.isArray(prod.variants) ? prod.variants.length : null,
      variant_0: Array.isArray(prod.variants) && prod.variants.length ? prod.variants[0] : null,
    } : null;

    return { statusCode: 200, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, encontrado: true, via, resumen }, null, 2) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

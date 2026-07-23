// ============================================================
// diag-relbase.js — Diagnóstico TEMPORAL de la conexión con RelBase
// Devuelve SOLO estructura (nombres de campos), nunca datos de negocio.
// Se elimina apenas confirmamos el mapeo. No expone valores sensibles.
// ============================================================

const BASE_URL = "https://api.relbase.cl/api/v1";

exports.handler = async () => {
  const company = process.env.RELBASE_COMPANY_TOKEN;
  const user = process.env.RELBASE_USER_TOKEN;
  if (!company || !user) {
    return { statusCode: 500, body: JSON.stringify({ error: "faltan tokens RelBase en env" }) };
  }

  try {
    const res = await fetch(`${BASE_URL}/productos`, {
      method: "GET",
      headers: { company, authorization: user, "Content-Type": "application/json" },
    });

    const status = res.status;
    let bodyText = await res.text();
    let json = null;
    try { json = JSON.parse(bodyText); } catch {}

    // Sólo estructura: llaves del primer producto y del meta. Sin valores.
    let productKeys = null;
    let sampleStockFields = null;
    let metaKeys = null;
    let totalCount = null;

    if (json) {
      // Detectar dónde viene la lista: probamos varias formas comunes.
      const lista =
        (Array.isArray(json.data) && json.data) ||
        (Array.isArray(json.productos) && json.productos) ||
        (json.data && Array.isArray(json.data.productos) && json.data.productos) ||
        (Array.isArray(json.results) && json.results) ||
        [];
      metaKeys = json.meta ? Object.keys(json.meta) : Object.keys(json);
      totalCount = json.meta ? json.meta.total_count : null;
      if (Array.isArray(lista) && lista.length) {
        const p = lista[0];
        productKeys = Object.keys(p);
        sampleStockFields = productKeys.filter((k) => /stock|cantidad|quantity|bodega|inventar/i.test(k));
      } else {
        // Si no encontramos la lista, reportar las llaves de nivel superior
        // para ver la forma real de la respuesta (sin valores).
        productKeys = Object.keys(json);
      }
    }

    // Tomar el primer producto de la lista y pedir su DETALLE para ver el stock.
    let sample = null;
    if (json && json.data && Array.isArray(json.data.products) && json.data.products.length) {
      const p0 = json.data.products[0];
      const detRes = await fetch(`${BASE_URL}/productos/${p0.id}`, {
        method: "GET",
        headers: { company, authorization: user, "Content-Type": "application/json" },
      });
      const detJson = await detRes.json().catch(() => null);
      const prod = detJson && detJson.data ? (detJson.data.product || detJson.data) : null;
      sample = {
        detalle_status: detRes.status,
        code: p0.code,
        is_inventory: p0.is_inventory,
        detalle_top_keys: detJson ? Object.keys(detJson) : null,
        producto_keys: prod ? Object.keys(prod) : null,
        inventories_type: prod && Array.isArray(prod.inventories) ? "array(" + prod.inventories.length + ")" : (prod ? typeof prod.inventories : null),
        inventory_item: prod && Array.isArray(prod.inventories) && prod.inventories.length ? prod.inventories[0] : null,
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relbase_auth_status: status,
        total_productos: totalCount,
        sample_producto: sample,
      }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

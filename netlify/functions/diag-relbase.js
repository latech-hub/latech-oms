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
      const lista = json.data || json.productos || [];
      metaKeys = json.meta ? Object.keys(json.meta) : null;
      totalCount = json.meta ? json.meta.total_count : null;
      if (Array.isArray(lista) && lista.length) {
        const p = lista[0];
        productKeys = Object.keys(p);
        // Reportar qué campos parecen de stock (solo nombres), sin valores.
        sampleStockFields = productKeys.filter((k) => /stock|cantidad|quantity|bodega|inventar/i.test(k));
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relbase_auth_status: status,
        total_productos: totalCount,
        meta_keys: metaKeys,
        product_field_keys: productKeys,
        posibles_campos_stock: sampleStockFields,
      }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

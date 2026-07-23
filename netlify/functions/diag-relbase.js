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

    let data_type = null, data_obj_keys = null, first_product_keys = null;
    if (json) {
      const d = json.data;
      if (Array.isArray(d)) {
        data_type = "array(" + d.length + ")";
        if (d.length) first_product_keys = Object.keys(d[0]);
      } else if (d && typeof d === "object") {
        data_type = "object";
        data_obj_keys = Object.keys(d);
        for (const k of data_obj_keys) {
          if (Array.isArray(d[k]) && d[k].length && typeof d[k][0] === "object") {
            first_product_keys = { via: k, keys: Object.keys(d[k][0]) };
            break;
          }
        }
      } else {
        data_type = typeof d;
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        relbase_auth_status: status,
        total_productos: totalCount,
        data_type: data_type,
        data_obj_keys: data_obj_keys,
        first_product_keys: first_product_keys,
      }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

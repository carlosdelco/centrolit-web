// Materiales por pedido (BOM) — funciones puras, sin DOM ni acceso a disco.
// Mismo patrón UMD que cotizador-engine.js: require() en Node/tests, global `BomEngine` en el
// navegador (escritorio y web comparten este fichero).
//
// Dos piezas:
//  - lineasDesdeOferta(): convierte una oferta del Cotizador en líneas estructuradas
//    (material, fijación, flashing, partida) que se guardan con "Pasar a pedido".
//  - calcularMateriales(): convierte líneas + recetas en el requerimiento de materiales
//    (kg de acero, aislante, etc. por receta; accesorios tal cual vienen).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BomEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const n = (v) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : 0;
  };
  const norm = (s) =>
    String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  const r2 = (x) => Math.round(x * 100) / 100;
  const unidadNorm = (u) => String(u ?? '').trim().toLowerCase().replace('²', '2');

  // Cantidad de material a fabricar en la unidad real de cotización: ml para paneles, m² para
  // Standing Seam (mismo criterio que unidadMaterial() en cotizador.js). Incluye desperdicio:
  // es lo que se factura y por tanto lo que se fabrica.
  function cantidadMaterial(modo, anchoUtil, areaConDesp) {
    const esMl = modo === 'ml' && n(anchoUtil) > 0;
    return esMl ? { cantidad: n(areaConDesp) / n(anchoUtil), unidad: 'ml' } : { cantidad: n(areaConDesp), unidad: 'm2' };
  }

  /**
   * Líneas de materiales de una oferta.
   * @param {object} o  Oferta del Cotizador (`ultima`): secciones | productoCatalogo + modo +
   *   anchoUtil + areaConDesp, tornillosCant, rematesDetalle, rematesMlFacturable, partidas.
   * @param {object} ctx  { nombreTornillo, flashings: [{codigo, descripcion}] }
   * @returns {Array<{tipo, producto, codigo, descripcion, cantidad, unidad, nota}>}
   */
  function lineasDesdeOferta(o, ctx = {}) {
    const L = [];
    const nombreTornillo = ctx.nombreTornillo || 'Fijaciones';
    const material = (producto, descripcion, modo, anchoUtil, areaConDesp, nota) => {
      const q = cantidadMaterial(modo, anchoUtil, areaConDesp);
      L.push({ tipo: 'material', producto, codigo: '', descripcion: descripcion || producto, cantidad: r2(q.cantidad), unidad: q.unidad, nota: nota || '' });
    };
    const fijacion = (cantidad, nota) => {
      L.push({ tipo: 'fijacion', producto: '', codigo: '', descripcion: nombreTornillo, cantidad: n(cantidad), unidad: 'unid', nota: nota || '' });
    };

    if (Array.isArray(o.secciones) && o.secciones.length) {
      o.secciones.forEach((s) => {
        material(s.productoCatalogo || '', s.nombreProducto, s.modo, s.anchoUtil, s.areaConDesp, s.nombre);
        fijacion(s.tornillosCant, s.nombre);
      });
    } else {
      material(o.productoCatalogo || '', o.productoNombre, o.modo, o.anchoUtil, o.areaConDesp, '');
      fijacion(o.tornillosCant, '');
    }

    if (Array.isArray(o.rematesDetalle) && o.rematesDetalle.length) {
      o.rematesDetalle.forEach((d) => {
        const f = (ctx.flashings || []).find((x) => x.codigo === d.codigo);
        L.push({ tipo: 'flashing', producto: '', codigo: d.codigo, descripcion: f ? f.descripcion : '', cantidad: n(d.piezas), unidad: 'pieza', nota: '' });
      });
    } else if (n(o.rematesMlFacturable) > 0) {
      L.push({ tipo: 'flashing', producto: '', codigo: '', descripcion: 'Remates / flashings (estimado)', cantidad: n(o.rematesMlFacturable), unidad: 'ml', nota: '' });
    }

    (o.partidas || []).forEach((x) => {
      L.push({ tipo: 'partida', producto: '', codigo: '', descripcion: x.descripcion || 'Partida adicional', cantidad: n(x.cantidad), unidad: x.unidad || 'unid', nota: '' });
    });

    return L.filter((l) => l.cantidad > 0);
  }

  /**
   * Requerimiento de materiales.
   * @param {object} p
   *   lineas: [{tipo, producto, codigo, descripcion, cantidad, unidad}]
   *   recetas: [{producto, material, categoria, base:'ml'|'m2', unidad, cantidad_por_unidad (null si
   *     solo hay costo y falta la cantidad física), merma_pct, estado:'confirmada'|'por_confirmar', nota}]
   *   anchos: { [producto]: ancho_util (m) } — para convertir ml↔m² cuando la línea y la receta usan
   *     unidades distintas.
   * @returns {{materiales, accesorios, pendientes, sinReceta}}
   */
  function calcularMateriales({ lineas = [], recetas = [], anchos = {} } = {}) {
    const porProducto = new Map();
    for (const r of recetas) {
      const k = norm(r.producto);
      if (!k) continue;
      if (!porProducto.has(k)) porProducto.set(k, []);
      porProducto.get(k).push(r);
    }
    const anchoDe = (producto) => {
      const k = norm(producto);
      for (const [nombre, v] of Object.entries(anchos)) if (norm(nombre) === k) return n(v);
      return 0;
    };

    const materiales = new Map();
    const accesorios = new Map();
    const pendientes = [];
    const sinReceta = [];

    for (const l of lineas) {
      const cant = n(l.cantidad);
      if (!(cant > 0)) continue;

      if (l.tipo !== 'material') {
        const clave = [l.tipo, norm(l.codigo || l.descripcion), unidadNorm(l.unidad)].join('|');
        const a = accesorios.get(clave) || { tipo: l.tipo, codigo: l.codigo || '', descripcion: l.descripcion || '', unidad: l.unidad || '', cantidad: 0 };
        a.cantidad += cant;
        accesorios.set(clave, a);
        continue;
      }

      const rows = porProducto.get(norm(l.producto));
      if (!rows || !rows.length) {
        if (!sinReceta.includes(l.producto)) sinReceta.push(l.producto);
        continue;
      }
      const u = unidadNorm(l.unidad);
      for (const r of rows) {
        const base = unidadNorm(r.base);
        if (base !== 'ml' && base !== 'm2') {
          pendientes.push({ producto: l.producto, material: r.material, motivo: 'La receta no indica si la cantidad es por ml o por m².' });
          continue;
        }
        let cantBase = cant;
        if (u !== base) {
          const ancho = anchoDe(l.producto);
          if (!(ancho > 0)) {
            pendientes.push({ producto: l.producto, material: r.material, motivo: 'Falta el ancho útil del producto para convertir ml ↔ m².' });
            continue;
          }
          cantBase = u === 'ml' && base === 'm2' ? cant * ancho : u === 'm2' && base === 'ml' ? cant / ancho : cant;
        }
        if (r.cantidad_por_unidad == null || r.cantidad_por_unidad === '') {
          pendientes.push({ producto: l.producto, material: r.material, motivo: 'La receta no tiene cantidad física (solo costo).', nota: r.nota || '' });
          continue;
        }
        const q = cantBase * n(r.cantidad_por_unidad) * (1 + n(r.merma_pct) / 100);
        const clave = [norm(r.material), unidadNorm(r.unidad)].join('|');
        const m = materiales.get(clave) || { material: r.material, categoria: r.categoria || '', unidad: r.unidad || '', cantidad: 0, estado: 'confirmada', detalle: [] };
        m.cantidad += q;
        if (norm(r.estado) !== 'confirmada') m.estado = 'por_confirmar';
        m.detalle.push({ producto: l.producto, cantidad: r2(q) });
        materiales.set(clave, m);
      }
    }

    return {
      materiales: [...materiales.values()].map((m) => ({ ...m, cantidad: r2(m.cantidad) })),
      accesorios: [...accesorios.values()].map((a) => ({ ...a, cantidad: r2(a.cantidad) })),
      pendientes,
      sinReceta,
    };
  }

  return { lineasDesdeOferta, calcularMateriales, cantidadMaterial };
});

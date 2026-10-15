// Motor de cálculo del cotizador — funciones puras, sin DOM ni acceso a disco.
// Portado 1:1 de reference/cotizador_actual.html (función calcular()).
// Se usa tanto en el renderer (window.CotizadorEngine) como en los tests (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CotizadorEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const n = (v) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : 0;
  };

  // Precio por m² de un producto. En paneles/láminas el precio de lista es por metro lineal,
  // y se divide entre el ancho útil para obtener el precio por m².
  function precioM2Lista(producto, pago) {
    return producto.ancho ? producto[pago] / producto.ancho : producto[pago];
  }

  // Cálculo de material + fijaciones + remates para UN ítem (un producto + un área + un
  // perímetro de remates). Factorizado para poder sumar varios en calcularOferta() cuando hay
  // varias secciones ("aguas", techos y pantallas por separado — punto 3 del feedback comercial).
  function calcularItem(it, p) {
    const pago = it.pago;
    const area = n(it.area);
    const desperdicioPct = n(it.desperdicioPct);
    const tornillosPorM2 = n(it.tornillosPorM2);
    const rematesMl = n(it.rematesMl);
    const man = it.preciosManuales;

    // Un producto sin precio de lista para esta forma de pago (precio_efectivo/precio_bcv en
    // blanco en el Sheet — p. ej. una referencia nueva pendiente de confirmar) NO debe cotizarse
    // a US$ 0: se marca `precioFaltante` y el importe queda en 0 pero bloqueado en la UI.
    const precioFaltante = !man && !!it.producto && it.producto[pago] == null;
    const precioM2 = man ? n(man.material) : precioFaltante ? 0 : precioM2Lista(it.producto, pago);
    const areaConDesp = area * (1 + desperdicioPct / 100);
    const materialImporte = areaConDesp * precioM2;

    // Los tornillos se cuentan sobre el área neta (sin desperdicio), como en el cotizador original.
    const tornillosCant = Math.ceil(area * tornillosPorM2);
    const tornilloPrecio = man ? n(man.tornillo) : p.tornillo[pago];
    const tornillosImporte = tornillosCant * tornilloPrecio;

    // Remates/flashings se venden por PIEZA (2,40 m): se redondea siempre hacia arriba.
    const piezaM = p.piezaRemateM || 2.4;
    const piezasRemate = rematesMl > 0 ? Math.ceil(rematesMl / piezaM) : 0;
    const rematesMlFacturable = +(piezasRemate * piezaM).toFixed(6);
    const rematePrecio = man ? n(man.remate) : p.remate[pago];
    const rematesImporte = rematesMlFacturable * rematePrecio;

    return {
      nombre: it.nombre || (it.producto && it.producto.n) || '',
      area, desperdicioPct, areaConDesp, precioM2, materialImporte, precioFaltante,
      tornillosPorM2, tornillosCant, tornilloPrecio, tornillosImporte,
      rematesMl, piezasRemate, rematesMlFacturable, rematePrecio, rematesImporte,
    };
  }

  // Suma varios calcularItem() en los mismos totales agregados que devuelve un ítem único, más
  // el detalle de cada sección en `secciones` para mostrarlas por separado en la oferta.
  function sumarSecciones(secciones, p) {
    const items = secciones.map((s) => calcularItem(s, p));
    const sum = (campo) => items.reduce((a, it) => a + it[campo], 0);
    const areaConDesp = sum('areaConDesp');
    const tornillosCant = sum('tornillosCant');
    const rematesMlFacturable = sum('rematesMlFacturable');
    const materialImporte = sum('materialImporte');
    const tornillosImporte = sum('tornillosImporte');
    const rematesImporte = sum('rematesImporte');
    return {
      secciones: items,
      precioFaltante: items.some((it) => it.precioFaltante),
      area: sum('area'),
      // Cada sección puede tener su propio % de desperdicio; aquí solo queda un valor de
      // referencia (el de la primera sección) — el desglose real está en cada `secciones[i]`.
      desperdicioPct: items[0] ? items[0].desperdicioPct : 0,
      areaConDesp,
      // Precios "efectivos" promedio, solo para mostrar un US$/unidad agregado — el desglose
      // real y correcto está en `secciones`, cada una con su propio precio.
      precioM2: areaConDesp > 0 ? materialImporte / areaConDesp : 0,
      materialImporte,
      tornillosPorM2: items[0] ? items[0].tornillosPorM2 : 0,
      tornillosCant,
      tornilloPrecio: tornillosCant > 0 ? tornillosImporte / tornillosCant : 0,
      tornillosImporte,
      rematesMl: sum('rematesMl'),
      piezasRemate: sum('piezasRemate'),
      rematesMlFacturable,
      rematePrecio: rematesMlFacturable > 0 ? rematesImporte / rematesMlFacturable : 0,
      rematesImporte,
    };
  }

  /**
   * @param {object} i  Entradas del formulario
   *   producto {n, ancho, efectivo, bcv}, pago 'efectivo'|'bcv', area (m²), desperdicioPct,
   *   tornillosPorM2, rematesMl, ivaPct, tasaBcv,
   *   preciosManuales: null | {material, tornillo, remate}
   *   secciones: null | [{nombre, producto, pago, area, desperdicioPct, tornillosPorM2, rematesMl,
   *     preciosManuales}] — techo a varias aguas, o varios techos/pantallas cotizados juntos;
   *     cuando viene informado sustituye a producto/area/rematesMl de arriba (punto 3 del feedback).
   *   montaje: {incluir, m2, ml, diasGrua, precioGruaDia, andamios, supervisor}, flete: {incluir, monto},
   *   margen: null | {costoMaterial, costoTornillo, costoRemate, costoOtros}
   * @param {object} p  Parámetros de la lista de precios
   *   tornillo {efectivo, bcv}, remate {efectivo, bcv}, piezaRemateM
   */
  function calcularOferta(i, p) {
    const pago = i.pago;
    const ivaPct = n(i.ivaPct);
    const tasaBcv = n(i.tasaBcv);
    const man = i.preciosManuales;

    const multi = Array.isArray(i.secciones) && i.secciones.length > 0;
    const base = multi
      ? sumarSecciones(i.secciones.map((s) => ({ ...s, pago: s.pago || pago, preciosManuales: s.preciosManuales || man })), p)
      : calcularItem({ producto: i.producto, pago, area: i.area, desperdicioPct: i.desperdicioPct, tornillosPorM2: i.tornillosPorM2, rematesMl: i.rematesMl, preciosManuales: man }, p);

    const { area, desperdicioPct, areaConDesp, precioM2, materialImporte, precioFaltante, tornillosPorM2, tornillosCant, tornilloPrecio, tornillosImporte, rematesMl, piezasRemate, rematesMlFacturable, rematePrecio, rematesImporte } = base;
    const secciones = multi ? base.secciones : null;

    const incluirMontaje = !!(i.montaje && i.montaje.incluir);
    const incluirFlete = !!(i.flete && i.flete.incluir);
    const precioMontajeM2 = n(i.montaje && i.montaje.m2);
    const precioMontajeMl = n(i.montaje && i.montaje.ml);
    // Partidas adicionales del montaje que no dependen del área: días de grúa (p. ej. izado en
    // standing seam), andamios especiales y supervisor fijo en obra — cada obra las tiene o no.
    const diasGrua = n(i.montaje && i.montaje.diasGrua);
    const precioGruaDia = n(i.montaje && i.montaje.precioGruaDia);
    const gruaImporte = diasGrua * precioGruaDia;
    const andamios = n(i.montaje && i.montaje.andamios);
    const supervisor = n(i.montaje && i.montaje.supervisor);
    const precioFlete = n(i.flete && i.flete.monto);
    const montajeImporte = incluirMontaje
      ? areaConDesp * precioMontajeM2 + rematesMlFacturable * precioMontajeMl + gruaImporte + andamios + supervisor
      : 0;
    const fleteImporte = incluirFlete ? precioFlete : 0;

    const subtotal = materialImporte + tornillosImporte + rematesImporte + montajeImporte + fleteImporte;
    const iva = (subtotal * ivaPct) / 100;
    const total = subtotal + iva;
    const totalBs = tasaBcv > 0 ? total * tasaBcv : null;

    const r = {
      area, desperdicioPct, areaConDesp, precioM2, materialImporte, precioFaltante,
      tornillosPorM2, tornillosCant, tornilloPrecio, tornillosImporte,
      rematesMl, piezasRemate, rematesMlFacturable, rematePrecio, rematesImporte,
      secciones,
      incluirMontaje, precioMontajeM2, precioMontajeMl, montajeImporte,
      diasGrua, precioGruaDia, gruaImporte, andamios, supervisor,
      incluirFlete, precioFlete, fleteImporte,
      subtotal, ivaPct, iva, total, tasaBcv, totalBs,
      incluirMargen: !!i.margen,
      margenData: null,
    };

    if (i.margen) {
      const cm = n(i.margen.costoMaterial);
      const ct = n(i.margen.costoTornillo);
      const cr = n(i.margen.costoRemate);
      const costoOtros = n(i.margen.costoOtros);
      const costoMaterialImporte = areaConDesp * cm;
      const costoTornillosImporte = tornillosCant * ct;
      const costoRematesImporte = rematesMlFacturable * cr;
      const costoTotal = costoMaterialImporte + costoTornillosImporte + costoRematesImporte + costoOtros;
      const margenUSD = subtotal - costoTotal;
      // Margen bruto = ganancia / venta.  Markup = ganancia / costo.  Son métricas distintas.
      const margenPct = subtotal > 0 ? (margenUSD / subtotal) * 100 : 0;
      const markupPct = costoTotal > 0 ? (margenUSD / costoTotal) * 100 : 0;

      const fila = (nombre, venta, costo) => {
        const m = venta - costo;
        return {
          nombre, venta, costo, margen: m,
          margenPct: venta > 0 ? (m / venta) * 100 : 0,
          markupPct: costo > 0 ? (m / costo) * 100 : 0,
        };
      };
      const nombreMaterial = multi ? `Material — ${secciones.length} sección(es)` : i.producto.n;
      const filas = [
        fila(nombreMaterial + ' (material)', materialImporte, costoMaterialImporte),
        fila('Fijaciones', tornillosImporte, costoTornillosImporte),
        fila('Remates / Flashings', rematesImporte, costoRematesImporte),
      ];
      const ventaMontajeFlete = montajeImporte + fleteImporte;
      if (costoOtros > 0 || ventaMontajeFlete > 0) {
        filas.push(fila('Montaje / Flete (venta vs. costo real)', ventaMontajeFlete, costoOtros));
      }
      r.margenData = { filas, subtotal, costoTotal, margenUSD, margenPct, markupPct };
    }
    return r;
  }

  // Semáforo de un KPI (misma lógica que el dashboard de referencia).
  function semaforo(kpi, valor) {
    if (valor === undefined || valor === null || valor === '' || Number.isNaN(Number(valor))) return 'gray';
    if (kpi.meta === undefined || kpi.meta === null) return 'gray';
    if (kpi.metaTipo === 'max') return valor <= kpi.meta ? 'green' : valor <= kpi.meta + 1 ? 'amber' : 'red';
    if (valor >= kpi.meta) return 'green';
    if (valor >= kpi.meta * 0.9) return 'amber';
    return 'red';
  }

  return { calcularOferta, precioM2Lista, semaforo };
});

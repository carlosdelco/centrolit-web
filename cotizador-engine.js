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

  /**
   * @param {object} i  Entradas del formulario
   *   producto {n, ancho, efectivo, bcv}, pago 'efectivo'|'bcv', area (m²), desperdicioPct,
   *   tornillosPorM2, rematesMl, ivaPct, tasaBcv,
   *   preciosManuales: null | {material, tornillo, remate}
   *   montaje: {incluir, m2, ml}, flete: {incluir, monto},
   *   margen: null | {costoMaterial, costoTornillo, costoRemate, costoOtros}
   * @param {object} p  Parámetros de la lista de precios
   *   tornillo {efectivo, bcv}, remate {efectivo, bcv}, piezaRemateM
   */
  function calcularOferta(i, p) {
    const pago = i.pago;
    const area = n(i.area);
    const desperdicioPct = n(i.desperdicioPct);
    const tornillosPorM2 = n(i.tornillosPorM2);
    const rematesMl = n(i.rematesMl);
    const ivaPct = n(i.ivaPct);
    const tasaBcv = n(i.tasaBcv);
    const man = i.preciosManuales;

    const precioM2 = man ? n(man.material) : precioM2Lista(i.producto, pago);
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

    const incluirMontaje = !!(i.montaje && i.montaje.incluir);
    const incluirFlete = !!(i.flete && i.flete.incluir);
    const precioMontajeM2 = n(i.montaje && i.montaje.m2);
    const precioMontajeMl = n(i.montaje && i.montaje.ml);
    const precioFlete = n(i.flete && i.flete.monto);
    const montajeImporte = incluirMontaje
      ? areaConDesp * precioMontajeM2 + rematesMlFacturable * precioMontajeMl
      : 0;
    const fleteImporte = incluirFlete ? precioFlete : 0;

    const subtotal = materialImporte + tornillosImporte + rematesImporte + montajeImporte + fleteImporte;
    const iva = (subtotal * ivaPct) / 100;
    const total = subtotal + iva;
    const totalBs = tasaBcv > 0 ? total * tasaBcv : null;

    const r = {
      area, desperdicioPct, areaConDesp, precioM2, materialImporte,
      tornillosPorM2, tornillosCant, tornilloPrecio, tornillosImporte,
      rematesMl, piezasRemate, rematesMlFacturable, rematePrecio, rematesImporte,
      incluirMontaje, precioMontajeM2, precioMontajeMl, montajeImporte,
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
      const filas = [
        fila(i.producto.n + ' (material)', materialImporte, costoMaterialImporte),
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

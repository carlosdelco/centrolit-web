// Utilidades puras de la pestaña Pedidos (sin DOM): normalizar y validar el código del pedido, y
// unificar las dos fuentes (pedidos del Cotizador + STATUS PEDIDOS.xlsx). UMD, mismo patrón que
// bom-engine.js: require() en Node/tests, global `PedidosUtil` en el navegador (escritorio y web).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PedidosUtil = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PLANTAS_VALIDAS = ['P', 'S', 'V'];
  const normCodigo = (s) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const plantaBridge = (s) => (PLANTAS_VALIDAS.includes(String(s ?? '').trim().toUpperCase()) ? String(s).trim().toUpperCase() : 'V');

  // Código de pedido que se puede asignar a mano a un pedido del Cotizador (p. ej. P341, S458).
  // Vacío = quitar el código. Debe ser único entre los pedidos del Cotizador; que coincida con uno
  // de STATUS PEDIDOS.xlsx es lo esperado (se fusionan en una sola fila, ver unificarPedidos()).
  function validarCodigo(codigo, bridge, refActual) {
    const c = normCodigo(codigo);
    if (!c) return { ok: true, codigo: '' };
    if (!/^[A-Z0-9][A-Z0-9\-_./]{0,39}$/.test(c)) {
      return { ok: false, codigo: c, error: 'El código solo admite letras, números y - _ . / (máximo 40 caracteres).' };
    }
    if ((bridge || []).some((b) => b.origen_oferta !== refActual && normCodigo(b.codigo_pedido) === c)) {
      return { ok: false, codigo: c, error: 'Ese código ya está asignado a otro pedido del Cotizador.' };
    }
    return { ok: true, codigo: c };
  }

  /**
   * Une pedidos del Cotizador ("bridge") y de STATUS PEDIDOS.xlsx ("real") en una sola lista.
   * - Un pedido del Cotizador cuyo código coincide con uno de STATUS PEDIDOS se muestra como UNA
   *   fila (estado del fichero real + materiales del Cotizador), no duplicado.
   * - `ref` es la clave con la que se guardan sus líneas de materiales: el origen_oferta del
   *   Cotizador si lo hay, si no el código real.
   * @returns {Array} filas con { origen, ref, pedido, planta, cliente, tipoProducto, etapaFabricacion,
   *   etapaMontaje, conCodigo, fusionado?, _raw? (fila del Cotizador), alt? (código real, ref alterna) }
   */
  function unificarPedidos(data) {
    const real = (data.real || []).map((f) => ({ origen: 'real', ref: f.pedido, conCodigo: true, ...f }));
    const porCodigo = new Map(real.map((f) => [normCodigo(f.pedido), f]));
    const usados = new Set();
    // Si la misma oferta se pasó a pedido más de una vez (había quedado así en la hoja antes de que
    // "Pasar a pedido" actualizara en vez de duplicar), se usa solo el registro MÁS RECIENTE: es el
    // que refleja los montos/datos actuales y evita claves repetidas (no se podría seleccionar el
    // segundo). `registros` indica cuántas filas había.
    const ultimo = new Map();
    (data.bridge || []).forEach((f, i) => ultimo.set(String(f.origen_oferta ?? '').trim() || '#' + i, i));
    const cuenta = (ref) => (data.bridge || []).filter((x) => String(x.origen_oferta ?? '').trim() === ref).length;
    const bridge = (data.bridge || [])
      .filter((f, i) => ultimo.get(String(f.origen_oferta ?? '').trim() || '#' + i) === i)
      .slice()
      .reverse()
      .map((f) => {
        const codigo = normCodigo(f.codigo_pedido);
        const coincide = codigo ? porCodigo.get(codigo) : null;
        if (coincide) {
          usados.add(coincide);
          return { ...coincide, ref: f.origen_oferta, alt: coincide.pedido, fusionado: true, registros: cuenta(String(f.origen_oferta ?? '').trim()), _raw: f };
        }
        return {
          origen: 'bridge',
          ref: f.origen_oferta,
          pedido: codigo,
          conCodigo: !!codigo,
          planta: plantaBridge(f.planta_sugerida),
          cliente: f.cliente,
          tipoProducto: f.resumen_material,
          etapaFabricacion: 'sin_dato',
          etapaMontaje: 'sin_dato',
          registros: cuenta(String(f.origen_oferta ?? '').trim()),
          _raw: f,
        };
      });
    return [...bridge, ...real.filter((f) => !usados.has(f))];
  }

  return { PLANTAS_VALIDAS, normCodigo, plantaBridge, validarCodigo, unificarPedidos };
});

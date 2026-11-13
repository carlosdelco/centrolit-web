'use strict';
// Seguimiento de ofertas: la pestaña "Ofertas" del Sheet de Pedidos. El Cotizador ENVÍA aquí la
// oferta hecha al cliente (en vez de pasarla directo a Pedidos); desde la pestaña Ofertas se marca
// "ganada" (→ se registra como pedido) o "perdida" (con el motivo).
//
// UMD: escritorio (require, con Sheets vía google-api.js) y web (global `OfertasCore`, con Sheets vía
// fetch) comparten esta lógica; solo cambia el objeto `io` que se le pasa a crearOfertas().
//
// io = {
//   leer():            → filas crudas de la pestaña (array de arrays, con cabecera) o [] si no existe,
//   asegurar():        → crea la pestaña con su cabecera si todavía no existe,
//   agregar(fila):     → agrega una fila al final,
//   escribirFila(n, fila): → reescribe la fila n (1 = cabecera),
//   pasarAPedido(registro): → registra la oferta como pedido (pedidos-service / WebData.pasarAPedido),
// }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OfertasCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const COLUMNAS = [
  'oferta_id', 'fecha', 'vendedor', 'cliente', 'ciudad_obra', 'tipo_obra', 'forma_pago', 'monto_usd',
  'resumen', 'estado', 'motivo_perdida', 'nota_cierre', 'cerrado_por', 'cerrado_en',
  'registro_json', 'detalle_1', 'detalle_2', 'detalle_3',
];
const I = Object.fromEntries(COLUMNAS.map((c, i) => [c, i]));
const CELDA_MAX = 45000; // Google Sheets admite 50.000 caracteres por celda
const PARTES_DETALLE = 3;

const ESTADOS = ['pendiente', 'ganada', 'perdida'];
const MOTIVOS_PERDIDA = [
  { id: 'precio', label: 'Precio' },
  { id: 'plazo', label: 'Plazo de entrega' },
  { id: 'competencia', label: 'Eligió a la competencia' },
  { id: 'sin_presupuesto', label: 'Cliente sin presupuesto / proyecto cancelado' },
  { id: 'sin_respuesta', label: 'Sin respuesta del cliente' },
  { id: 'otro', label: 'Otro (indicar en la nota)' },
];

const txt = (v, max = 300) => String(v ?? '').slice(0, max);
const normEstado = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return ESTADOS.includes(s) ? s : 'pendiente';
};

function partir(s, n = CELDA_MAX) {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
}

// Convierte las filas crudas de la hoja en objetos (con el JSON del registro y el HTML del detalle ya
// unidos). `fila` = número de fila en la hoja (para reescribirla después). Las filas sin oferta_id se
// ignoran. Si el JSON está dañado, `registro` queda en null (la oferta se muestra, pero no se puede
// pasar a pedido hasta reenviarla desde el Cotizador).
function parseOfertas(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const head = (raw[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const col = (row, nombre) => {
    const j = head.indexOf(nombre);
    return j < 0 ? '' : row[j] ?? '';
  };
  const out = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] || [];
    const id = String(col(row, 'oferta_id')).trim();
    if (!id) continue;
    let registro = null;
    try { registro = JSON.parse(String(col(row, 'registro_json') || 'null')); } catch { registro = null; }
    const monto = Number(col(row, 'monto_usd'));
    out.push({
      fila: i + 1,
      id,
      fecha: String(col(row, 'fecha')),
      vendedor: String(col(row, 'vendedor')),
      cliente: String(col(row, 'cliente')),
      ciudadObra: String(col(row, 'ciudad_obra')),
      tipoObra: String(col(row, 'tipo_obra')),
      formaPago: String(col(row, 'forma_pago')),
      montoUsd: Number.isFinite(monto) ? monto : 0,
      resumen: String(col(row, 'resumen')),
      estado: normEstado(col(row, 'estado')),
      motivoPerdida: String(col(row, 'motivo_perdida')),
      notaCierre: String(col(row, 'nota_cierre')),
      cerradoPor: String(col(row, 'cerrado_por')),
      cerradoEn: String(col(row, 'cerrado_en')),
      registro,
      detalle: ['detalle_1', 'detalle_2', 'detalle_3'].map((c) => String(col(row, c))).join(''),
    });
  }
  return out;
}

// Última fila con ese id (la más reciente es la vigente), con su fila cruda para poder reescribirla.
function buscar(raw, id) {
  const clave = String(id ?? '').trim();
  if (!clave) return null;
  const head = (raw[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const j = head.indexOf('oferta_id');
  if (j < 0) return null;
  for (let i = raw.length - 1; i > 0; i--) {
    if (String((raw[i] || [])[j] ?? '').trim() === clave) return { fila: i + 1, valores: raw[i] };
  }
  return null;
}

const completar = (valores) => {
  const v = COLUMNAS.map((_, i) => valores[i] ?? '');
  return v;
};

function crearOfertas(io) {
  // Las filas que lee `io.leer()` se asumen con la cabecera de COLUMNAS (las crea `asegurar`).
  async function enviar(registro, detalleHtml, quien) {
    const id = txt(registro && registro.origenOferta, 120).trim();
    if (!id) throw new Error('La oferta no tiene número: ponle un número antes de enviarla a Ofertas.');
    const registroJson = JSON.stringify(registro);
    if (registroJson.length > CELDA_MAX) throw new Error('La oferta es demasiado grande para guardarse en la hoja de Ofertas (demasiadas líneas de materiales).');
    const html = String(detalleHtml || '');
    const partes = partir(html);
    if (partes.length > PARTES_DETALLE) throw new Error('El detalle de la oferta es demasiado largo para guardarse en la hoja de Ofertas.');

    await io.asegurar();
    const raw = await io.leer();
    const previa = buscar(raw, id);
    const ahora = new Date().toISOString();
    if (previa) {
      const estado = normEstado(previa.valores[I.estado]);
      if (estado === 'ganada') throw new Error(`La oferta ${id} ya fue marcada como GANADA y pasó a Pedidos. Si cambió algo, guárdala con otro número (revisión) y envíala de nuevo.`);
      if (estado === 'perdida') throw new Error(`La oferta ${id} está marcada como PERDIDA. Reábrela desde la pestaña Ofertas si quieres volver a enviarla, o guárdala con otro número (revisión).`);
    }
    const fila = completar([]);
    fila[I.oferta_id] = id;
    fila[I.fecha] = previa ? previa.valores[I.fecha] || ahora : ahora;
    fila[I.vendedor] = txt(quien || registro.registradoPor, 120);
    fila[I.cliente] = txt(registro.cliente, 200);
    fila[I.ciudad_obra] = txt(registro.ciudadObra, 120);
    fila[I.tipo_obra] = txt(registro.tipoObra, 120);
    fila[I.forma_pago] = txt(registro.formaPago, 120);
    fila[I.monto_usd] = Number(registro.montoTotalUsd) || 0;
    fila[I.resumen] = txt(registro.resumenMaterial, 300);
    fila[I.estado] = 'pendiente';
    fila[I.registro_json] = registroJson;
    partes.forEach((p, k) => { fila[I.detalle_1 + k] = p; });
    if (previa) await io.escribirFila(previa.fila, fila);
    else await io.agregar(fila);
    return { ok: true, actualizado: !!previa };
  }

  async function cargar(id) {
    const raw = await io.leer();
    const previa = buscar(raw, id);
    if (!previa) throw new Error(`No se encontró la oferta ${id} en la hoja de Ofertas (¿se borró la fila?).`);
    return { raw, previa, estado: normEstado(previa.valores[I.estado]) };
  }

  async function ganada(id, quien) {
    const { previa, estado } = await cargar(id);
    if (estado === 'ganada') return { ok: true, yaGanada: true };
    let registro = null;
    try { registro = JSON.parse(String(previa.valores[I.registro_json] || 'null')); } catch { registro = null; }
    if (!registro) throw new Error('Esta oferta no tiene sus datos guardados: reenvíala desde el Cotizador para poder pasarla a pedido.');
    // 1) Se registra el pedido (idempotente). Si falla, la oferta NO se marca como ganada.
    const pedido = await io.pasarAPedido(registro);
    // 2) Se marca la oferta. Si esto fallara, reintentar es seguro: pasarAPedido actualiza, no duplica.
    const fila = completar(previa.valores);
    fila[I.estado] = 'ganada';
    fila[I.motivo_perdida] = '';
    fila[I.nota_cierre] = '';
    fila[I.cerrado_por] = txt(quien, 120);
    fila[I.cerrado_en] = new Date().toISOString();
    try {
      await io.escribirFila(previa.fila, fila);
    } catch (e) {
      throw new Error('El pedido se registró, pero no se pudo marcar la oferta como ganada: ' + e.message + ' Vuelve a pulsar "Oferta ganada" (no duplica el pedido).');
    }
    return { ok: true, pedido };
  }

  async function perdida(id, { motivo, nota } = {}, quien) {
    const m = MOTIVOS_PERDIDA.find((x) => x.id === motivo);
    if (!m) throw new Error('Elige el motivo por el que se perdió la oferta.');
    const notaTxt = txt(nota, 500).trim();
    if (m.id === 'otro' && !notaTxt) throw new Error('Indica en la nota cuál fue el motivo.');
    const { previa, estado } = await cargar(id);
    if (estado === 'ganada') throw new Error('Esta oferta ya fue marcada como ganada y pasó a Pedidos: no se puede marcar como perdida.');
    const fila = completar(previa.valores);
    fila[I.estado] = 'perdida';
    fila[I.motivo_perdida] = m.label;
    fila[I.nota_cierre] = notaTxt;
    fila[I.cerrado_por] = txt(quien, 120);
    fila[I.cerrado_en] = new Date().toISOString();
    await io.escribirFila(previa.fila, fila);
    return { ok: true };
  }

  async function reabrir(id) {
    const { previa, estado } = await cargar(id);
    if (estado === 'ganada') throw new Error('Esta oferta ya pasó a Pedidos: no se puede reabrir.');
    if (estado === 'pendiente') return { ok: true };
    const fila = completar(previa.valores);
    fila[I.estado] = 'pendiente';
    fila[I.motivo_perdida] = '';
    fila[I.nota_cierre] = '';
    fila[I.cerrado_por] = '';
    fila[I.cerrado_en] = '';
    await io.escribirFila(previa.fila, fila);
    return { ok: true };
  }

  async function listar() {
    return parseOfertas(await io.leer());
  }

  return { enviar, ganada, perdida, reabrir, listar };
}

return { COLUMNAS, MOTIVOS_PERDIDA, ESTADOS, CELDA_MAX, parseOfertas, buscar, partir, crearOfertas };
});

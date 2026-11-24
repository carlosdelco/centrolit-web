'use strict';
// Partes de producción de paneles: la versión digital de la "Hoja de Producción" que llena la planta
// (bobinas usadas, láminas fabricadas, anime, pega, tornillos, scrap...) y que el encargado de revisión
// (p. ej. Carlos López) envía a administración. Se guarda en la pestaña "Partes_Produccion" del Sheet
// de Pedidos: una fila por parte con los TOTALES en columnas legibles (para que administración y
// facturación los lean directo en Sheets) + el detalle completo en `detalle_json` (para la app/PDF).
//
// UMD: escritorio (src/main/partes-service.js) y web (web/data.js) comparten esta lógica; solo cambia
// el objeto `io` que se pasa a crearPartes() — mismo patrón que ofertas-core.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PartesCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

const COLUMNAS = [
  'numero', 'hoja_papel', 'pedido', 'fecha', 'cliente', 'producto', 'proveedor_acero', 'calibre', 'color_sup', 'color_inf',
  'ml_producidos', 'laminas', 'kg_acero', 'kg_1200', 'kg_1100', 'kg_1000', 'kg_otros_anchos', 'ml_segunda',
  'anime_laminas', 'anime_m', 'poliol_kg', 'isocianato_kg', 'tornillos', 'capelotes', 'cumbreras', 'flashings_ml',
  'scrap_kg', 'supervisor', 'operador', 'revisado_por', 'observaciones',
  'estado', 'enviado_por', 'enviado_en', 'procesado_por', 'procesado_en', 'detalle_json',
];
const I = Object.fromEntries(COLUMNAS.map((c, i) => [c, i]));
const ESTADOS = ['enviado', 'procesado', 'anulado'];
const PROVEEDORES_ACERO = ['Acesco', 'Corpacero', 'Rogo', 'Arme'];
const CELDA_MAX = 45000;

// Tablas del parte (mismo contenido que la hoja en papel, con dos mejoras: el scrap distingue
// "arranque de máquina" / "producción" como la orden de producción, y capelotes/cumbreras/tornillos
// admiten varias filas con descripción).
const TABLAS = {
  bobinas: ['numero', 'ancho', 'pesoInicial', 'pesoFinal'],
  laminas: ['cantidad', 'largo'],
  segunda: ['cantidad', 'largo'],
  anime: ['cantidad', 'largo'],
  tornillos: ['tipo', 'cantidad'],
  capelotes: ['descripcion', 'cantidad'],
  cumbreras: ['descripcion', 'cantidad'],
  flashings: ['descripcion', 'cantidad', 'largo', 'ancho'],
  scrap: ['tipo', 'ancho', 'kg', 'metros'],
};
const TEXTO = new Set(['numero', 'tipo', 'descripcion']);
const CABECERA = ['hojaPapel', 'pedido', 'fecha', 'cliente', 'producto', 'proveedorAcero', 'calibre', 'colorSup', 'colorInf', 'supervisor', 'operador', 'revisadoPor', 'observaciones'];

const txt = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  if (v === '' || v === null || v === undefined) return '';
  const x = Number(String(v).replace(',', '.'));
  return Number.isFinite(x) && x >= 0 ? x : '';
};
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x) => Math.round(x * 100) / 100;

// Limpia lo que llega del formulario (o de la hoja): solo campos conocidos, números >= 0, textos
// recortados, filas vacías fuera, máximo 60 filas por tabla.
function normalizar(p = {}) {
  const out = {};
  for (const c of CABECERA) out[c] = txt(p[c], c === 'observaciones' ? 2000 : 200);
  for (const [t, cols] of Object.entries(TABLAS)) {
    const filas = Array.isArray(p[t]) ? p[t] : [];
    out[t] = filas
      .map((f) => Object.fromEntries(cols.map((c) => [c, TEXTO.has(c) ? txt(f && f[c], 120) : num(f && f[c])])))
      .filter((f) => cols.some((c) => f[c] !== '' && f[c] !== 0))
      .slice(0, 60);
  }
  out.poliolKg = num(p.poliolKg);
  out.isocianatoKg = num(p.isocianatoKg);
  return out;
}

// Totales del parte, igual que los que se suman a mano en la hoja (y algunos que la hoja no tiene:
// kg por ancho calculados, avisos de incoherencias).
function calcular(p) {
  const q = normalizar(p);
  const suma = (arr, fn) => arr.reduce((a, f) => a + fn(f), 0);
  const kgPorAncho = {};
  const avisos = [];
  q.bobinas.forEach((b, i) => {
    const usado = n(b.pesoInicial) - n(b.pesoFinal);
    if (b.pesoInicial !== '' && b.pesoFinal !== '' && usado < 0) avisos.push(`Bobina ${b.numero || i + 1}: el peso final es mayor que el inicial.`);
    if (b.pesoInicial !== '' && b.pesoFinal === '') avisos.push(`Bobina ${b.numero || i + 1}: falta el peso final (no se puede saber cuánto acero se usó).`);
    if (usado > 0 && b.pesoInicial !== '' && b.pesoFinal !== '') {
      const k = String(b.ancho || 'sin ancho');
      kgPorAncho[k] = r2((kgPorAncho[k] || 0) + usado);
    }
  });
  const kgAcero = r2(Object.values(kgPorAncho).reduce((a, b) => a + b, 0));
  const ml = r2(suma(q.laminas, (f) => n(f.cantidad) * n(f.largo)));
  const t = {
    ml,
    laminas: suma(q.laminas, (f) => n(f.cantidad)),
    kgPorAncho,
    kgAcero,
    kg1200: kgPorAncho['1200'] || 0,
    kg1100: kgPorAncho['1100'] || 0,
    kg1000: kgPorAncho['1000'] || 0,
    kgOtros: r2(Object.entries(kgPorAncho).filter(([k]) => !['1200', '1100', '1000'].includes(k)).reduce((a, [, v]) => a + v, 0)),
    mlSegunda: r2(suma(q.segunda, (f) => n(f.cantidad) * n(f.largo))),
    animeLaminas: suma(q.anime, (f) => n(f.cantidad)),
    animeM: r2(suma(q.anime, (f) => n(f.cantidad) * n(f.largo))),
    poliolKg: n(q.poliolKg),
    isocianatoKg: n(q.isocianatoKg),
    tornillos: suma(q.tornillos, (f) => n(f.cantidad)),
    capelotes: suma(q.capelotes, (f) => n(f.cantidad)),
    cumbreras: suma(q.cumbreras, (f) => n(f.cantidad)),
    flashingsMl: r2(suma(q.flashings, (f) => n(f.cantidad) * n(f.largo))),
    scrapKg: r2(suma(q.scrap, (f) => n(f.kg))),
    scrapArranqueKg: r2(suma(q.scrap.filter((f) => /arranque/i.test(f.tipo)), (f) => n(f.kg))),
    kgPorMl: ml > 0 && kgAcero > 0 ? r2(kgAcero / ml) : 0,
    avisos,
  };
  if (q.laminas.some((f) => f.largo !== '' && n(f.largo) > 30)) t.avisos.push('Hay láminas de más de 30 m: revisa que el largo esté en metros (no en cm).');
  if (q.anime.some((f) => f.largo !== '' && n(f.largo) > 30)) t.avisos.push('Hay anime de más de 30 m de largo: en la hoja de papel se anota en cm (300 = 3,00 m); aquí va en metros.');
  return t;
}

// Previsto (receta × ml producidos) contra real. Solo recetas por ml (paneles); el acero se compara
// por ancho de bobina ("ancho 1200" en el nombre del material de la receta contra kg usados de las
// bobinas de 1200 mm). No inventa: si no hay receta o el material no tiene equivalente real, no sale.
function compararConReceta(p, recetas = []) {
  const q = normalizar(p);
  const t = calcular(q);
  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const rs = recetas.filter((r) => norm(r.producto) === norm(q.producto) && r.cantidad_por_unidad != null && r.cantidad_por_unidad !== '');
  if (!q.producto) return { filas: [], motivo: 'Elige el producto para comparar con su receta.' };
  if (!rs.length) return { filas: [], motivo: `No hay receta cargada para "${q.producto}".` };
  if (!(t.ml > 0)) return { filas: [], motivo: 'Faltan los metros producidos (láminas: cantidad × largo).' };
  if (rs.every((r) => norm(r.base) !== 'ml')) return { filas: [], motivo: 'La receta de este producto es por m², no por ml: no se compara todavía.' };
  const filas = [];
  const porConfirmar = rs.some((r) => norm(r.estado) !== 'confirmada');
  for (const r of rs) {
    if (norm(r.base) !== 'ml') continue;
    const porMl = n(r.cantidad_por_unidad) * (1 + n(r.merma_pct) / 100);
    const previsto = r2(porMl * t.ml);
    const mat = norm(r.material);
    let real = null;
    let unidad = r.unidad || '';
    const ancho = (mat.match(/ancho\s*(\d{3,4})/) || [])[1];
    if (/acero/.test(mat)) real = ancho ? (t.kgPorAncho[ancho] ?? 0) : t.kgAcero;
    else if (/poliestireno|anime|eps/.test(mat)) real = t.animeLaminas;
    else if (/isocianato/.test(mat)) real = t.isocianatoKg;
    else if (/poliol/.test(mat)) real = t.poliolKg;
    if (real === null) continue; // p. ej. trapecios: la hoja no los registra
    const dif = previsto > 0 ? Math.round(((real - previsto) / previsto) * 100) : null;
    filas.push({ material: r.material, unidad, previsto, real: r2(real), dif, previstoPorMl: r2(porMl), realPorMl: r2(real / t.ml) });
  }
  return { filas, ml: t.ml, porConfirmar, motivo: filas.length ? '' : 'La receta no tiene materiales que la hoja registre.' };
}

function filaDesdeParte(p, meta) {
  const q = normalizar(p);
  const t = calcular(q);
  const det = JSON.stringify(q);
  if (det.length > CELDA_MAX) throw new Error('El parte tiene demasiadas filas para guardarse en la hoja.');
  const v = {
    numero: meta.numero, hoja_papel: q.hojaPapel, pedido: q.pedido, fecha: q.fecha, cliente: q.cliente, producto: q.producto,
    proveedor_acero: q.proveedorAcero, calibre: q.calibre, color_sup: q.colorSup, color_inf: q.colorInf,
    ml_producidos: t.ml, laminas: t.laminas, kg_acero: t.kgAcero, kg_1200: t.kg1200, kg_1100: t.kg1100, kg_1000: t.kg1000,
    kg_otros_anchos: t.kgOtros, ml_segunda: t.mlSegunda, anime_laminas: t.animeLaminas, anime_m: t.animeM,
    poliol_kg: t.poliolKg, isocianato_kg: t.isocianatoKg, tornillos: t.tornillos, capelotes: t.capelotes, cumbreras: t.cumbreras,
    flashings_ml: t.flashingsMl, scrap_kg: t.scrapKg, supervisor: q.supervisor, operador: q.operador, revisado_por: q.revisadoPor,
    observaciones: q.observaciones, estado: meta.estado, enviado_por: meta.enviadoPor, enviado_en: meta.enviadoEn,
    procesado_por: meta.procesadoPor || '', procesado_en: meta.procesadoEn || '', detalle_json: det,
  };
  return COLUMNAS.map((c) => v[c] ?? '');
}

function parsePartes(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return [];
  const head = (raw[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
  const out = [];
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i] || [];
    const col = (c) => { const j = head.indexOf(c); return j < 0 ? '' : row[j] ?? ''; };
    const numero = String(col('numero')).trim();
    if (!numero) continue;
    let detalle = null;
    try { detalle = JSON.parse(String(col('detalle_json') || 'null')); } catch { detalle = null; }
    const parte = normalizar(detalle || {
      hojaPapel: col('hoja_papel'), pedido: col('pedido'), fecha: col('fecha'), cliente: col('cliente'), producto: col('producto'),
      proveedorAcero: col('proveedor_acero'), calibre: col('calibre'), colorSup: col('color_sup'), colorInf: col('color_inf'),
      supervisor: col('supervisor'), operador: col('operador'), revisadoPor: col('revisado_por'), observaciones: col('observaciones'),
    });
    const estado = String(col('estado')).trim().toLowerCase();
    out.push({
      fila: i + 1,
      numero,
      estado: ESTADOS.includes(estado) ? estado : 'enviado',
      enviadoPor: String(col('enviado_por')), enviadoEn: String(col('enviado_en')),
      procesadoPor: String(col('procesado_por')), procesadoEn: String(col('procesado_en')),
      detalleDanado: !detalle,
      parte,
      totales: calcular(parte),
    });
  }
  return out;
}

const pad = (x) => String(x).padStart(6, '0');

function crearPartes(io) {
  const buscar = (raw, numero) => {
    const head = (raw[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
    const j = head.indexOf('numero');
    if (j < 0) return null;
    for (let i = raw.length - 1; i > 0; i--) if (String((raw[i] || [])[j] ?? '').trim() === String(numero)) return { fila: i + 1, valores: raw[i] };
    return null;
  };

  // Guarda un parte nuevo (numero vacío → se asigna el siguiente correlativo) o edita uno existente
  // mientras administración no lo haya procesado.
  async function guardar(parte, quien, numero) {
    const q = normalizar(parte);
    if (!q.pedido) throw new Error('Indica el pedido al que pertenece el parte.');
    if (!q.fecha) throw new Error('Indica la fecha de producción.');
    if (!q.producto) throw new Error('Elige el producto fabricado.');
    if (!q.laminas.length) throw new Error('Carga al menos una fila de láminas fabricadas (cantidad y largo).');
    await io.asegurar();
    const raw = await io.leer();
    const ahora = new Date().toISOString();
    if (numero) {
      const prev = buscar(raw, numero);
      if (!prev) throw new Error(`No se encontró el parte N° ${numero} (¿se borró la fila?).`);
      const est = String(prev.valores[I.estado] || '').trim().toLowerCase();
      if (est === 'procesado') throw new Error('Administración ya procesó este parte: no se puede modificar. Pide que lo desmarquen si hay que corregirlo.');
      const fila = filaDesdeParte(q, { numero, estado: est === 'anulado' ? 'anulado' : 'enviado', enviadoPor: quien, enviadoEn: ahora });
      await io.escribirFila(prev.fila, fila);
      return { ok: true, numero, actualizado: true };
    }
    const j = (raw[0] || []).map((h) => String(h ?? '').trim().toLowerCase()).indexOf('numero');
    const max = raw.slice(1).reduce((m, r) => Math.max(m, parseInt((r || [])[j], 10) || 0), 0);
    const nuevo = pad(max + 1);
    await io.agregar(filaDesdeParte(q, { numero: nuevo, estado: 'enviado', enviadoPor: quien, enviadoEn: ahora }));
    return { ok: true, numero: nuevo, actualizado: false };
  }

  async function cambiarEstado(numero, estado, quien) {
    if (!ESTADOS.includes(estado)) throw new Error('Estado inválido.');
    const raw = await io.leer();
    const prev = buscar(raw, numero);
    if (!prev) throw new Error(`No se encontró el parte N° ${numero}.`);
    const fila = COLUMNAS.map((_, i) => prev.valores[i] ?? '');
    const actual = String(fila[I.estado] || '').trim().toLowerCase();
    if (estado === 'anulado' && actual === 'procesado') throw new Error('Un parte ya procesado por administración no se puede anular.');
    fila[I.estado] = estado;
    if (estado === 'procesado') { fila[I.procesado_por] = quien || ''; fila[I.procesado_en] = new Date().toISOString(); }
    else { fila[I.procesado_por] = ''; fila[I.procesado_en] = ''; }
    await io.escribirFila(prev.fila, fila);
    return { ok: true };
  }

  async function listar() {
    return parsePartes(await io.leer());
  }

  return { guardar, cambiarEstado, listar };
}

return { COLUMNAS, ESTADOS, PROVEEDORES_ACERO, TABLAS, normalizar, calcular, compararConReceta, parsePartes, filaDesdeParte, crearPartes };
});

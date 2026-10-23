// Convierte las filas crudas de Google Sheets (arrays de strings) en las estructuras de la app.
// Formato esperado de cada pestaña: docs/HOJAS-GOOGLE.md
// UMD: se usa con require() en el proceso principal de Electron y en los tests, y con una
// etiqueta <script> (global `Parsers`) en la versión web — mismo fichero, sin duplicar lógica.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Parsers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

// Acepta "1.234,56", "1,234.56", "12,5", "12.5", "35%" y "US$ 10" → número. Vacío → null.
function num(v) {
  if (v === undefined || v === null) return null;
  let s = String(v).trim().replace(/[%\s]|US\$|\$|Bs\.?/gi, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // el separador decimal es el que aparece último
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

// Primera fila = cabeceras. Devuelve [{cabecera_normalizada: valor}, ...] saltando filas vacías.
function tabla(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const heads = values[0].map(norm);
  return values
    .slice(1)
    .filter((row) => row.some((c) => String(c ?? '').trim() !== ''))
    .map((row) => Object.fromEntries(heads.map((h, i) => [h, row[i] ?? ''])));
}

function requerir(filas, cols, hoja) {
  if (!filas.length) throw new Error(`La pestaña "${hoja}" está vacía o no tiene cabeceras.`);
  const faltan = cols.filter((c) => !(c in filas[0]));
  if (faltan.length) throw new Error(`Faltan columnas en "${hoja}": ${faltan.join(', ')}`);
}

function parsePrecios({ productos, parametros, textos, tiposObra }) {
  const filasProd = tabla(productos);
  requerir(filasProd, ['categoria', 'producto', 'precio_efectivo', 'precio_bcv'], 'Productos');
  const prods = filasProd
    .filter((f) => f.producto && f.categoria)
    .map((f) => ({
      categoria: String(f.categoria).trim(),
      producto: String(f.producto).trim(),
      ancho_util: num(f.ancho_util),
      // null (no 0) si la celda viene vacía: un precio en US$ 0 se vería como "gratis" en una
      // oferta real. El motor y la UI deben tratar null como "precio pendiente de confirmar".
      precio_efectivo: num(f.precio_efectivo),
      precio_bcv: num(f.precio_bcv) ?? num(f.precio_efectivo),
      montaje_m2: num(f.montaje_m2),
      montaje_ml: num(f.montaje_ml),
    }));

  const params = {};
  for (const f of tabla(parametros)) {
    if (!f.clave) continue;
    const k = norm(f.clave);
    const v = String(f.valor ?? '').trim();
    params[k] = num(v) ?? v;
  }
  for (const k of ['tornillo_efectivo', 'tornillo_bcv', 'remate_efectivo', 'remate_bcv']) {
    if (typeof params[k] !== 'number') throw new Error(`Falta el parámetro numérico "${k}" en la pestaña Parametros.`);
  }

  const txt = tabla(textos)
    .filter((f) => f.producto)
    .map((f) => ({
      producto: String(f.producto).trim(),
      descripcion: String(f.descripcion ?? '').trim(),
      notas: String(f.notas ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    }));

  const tipos = tabla(tiposObra).map((f) => String(f.tipo_de_obra ?? f.tipo ?? '').trim()).filter(Boolean);

  return { productos: prods, parametros: params, textos: txt, tiposObra: tipos };
}

// Catálogo real de flashings (punto 4 del feedback): cada código tiene su propio desarrollo y
// precio, no se pueden englobar en un precio único por ml. Pestaña opcional — si no existe en el
// Sheet (todavía), se devuelve vacío en vez de fallar, para no romper Productos/Parametros/Textos.
function parseFlashings(rows) {
  return tabla(rows)
    .filter((f) => f.codigo && f.descripcion)
    .map((f) => ({
      codigo: String(f.codigo).trim(),
      calibre: num(f.calibre),
      descripcion: String(f.descripcion).trim(),
      desarrollo_cm: String(f.desarrollo_cm ?? '').trim(),
      precio_efectivo: num(f.precio_efectivo),
      precio_bcv: num(f.precio_bcv) ?? num(f.precio_efectivo),
    }));
}

// Catálogo real de fijaciones (punto 5): combos de tornillos/clips/capelotes por producto ("uso").
function parseFijaciones(rows) {
  return tabla(rows)
    .filter((f) => f.nombre)
    .map((f) => ({
      nombre: String(f.nombre).trim(),
      precio_efectivo: num(f.precio_efectivo),
      uso: String(f.uso ?? '').trim(),
    }));
}

function parseKpis({ areas, kpis, historial }) {
  const filasAreas = tabla(areas);
  requerir(filasAreas, ['area', 'nombre'], 'Areas');
  const filasKpis = tabla(kpis);
  requerir(filasKpis, ['area', 'kpi', 'nombre'], 'KPIs');

  const lista = filasAreas.map((a) => ({
    key: norm(a.area),
    nombre: String(a.nombre).trim(),
    responsable: String(a.responsable ?? '').trim(),
    kpis: filasKpis
      .filter((k) => norm(k.area) === norm(a.area))
      .map((k) => {
        const meta = num(k.meta);
        const tipo = norm(k.tipo_meta);
        return {
          key: norm(k.kpi),
          nombre: String(k.nombre).trim(),
          unidad: String(k.unidad ?? '').trim(),
          meta,
          metaTipo: meta == null ? null : tipo === 'max' ? 'max' : 'min',
        };
      }),
  }));

  // Historial en formato largo: una fila por (semana, área, KPI). Se agrupa a {area: [{semana, valores, nota}]}.
  const hist = {};
  const filasHist = tabla(historial);
  if (filasHist.length) requerir(filasHist, ['semana', 'area', 'kpi', 'valor'], 'Historial');
  for (const f of filasHist) {
    const area = norm(f.area);
    const semana = fechaISO(f.semana);
    if (!area || !semana) continue;
    const arr = (hist[area] ??= []);
    let e = arr.find((x) => x.semana === semana);
    if (!e) arr.push((e = { semana, valores: {}, nota: '' }));
    const v = num(f.valor);
    if (v !== null) e.valores[norm(f.kpi)] = v;
    if (f.nota) e.nota = String(f.nota).trim();
  }
  for (const a of Object.keys(hist)) hist[a].sort((x, y) => x.semana.localeCompare(y.semana));

  return { areas: lista, historial: hist };
}

// Pedido real → planta, a partir de la letra inicial del código (P/S ya usados en el Grupo;
// cualquier otra letra o código irregular cae en "V" sin ocultar el código original).
function plantaDeCodigo(codigo) {
  const m = String(codigo ?? '').trim().match(/^[A-Za-z]/);
  const letra = m ? m[0].toUpperCase() : '';
  return letra === 'P' || letra === 'S' ? letra : 'V';
}

// Clasifica un texto libre de estado de fabricación/montaje en 3 etapas, para poder agrupar sin
// inventar un cronograma que el fichero real no tiene. Heurística sobre texto/porcentaje tal cual
// lo escribe el equipo (p. ej. "Fabricado y entregado", "100%", "sin fabricar", "0%").
function clasificarEtapa(v) {
  const s = norm(v);
  if (!s) return 'sin_dato';
  if (s === '100' || s.includes('entregado') || s.includes('terminado')) return 'terminado';
  if (s === '0' || s.includes('sin_fabricar') || s.includes('por_definir')) return 'sin_iniciar';
  return 'en_curso';
}

// Parsea STATUS PEDIDOS.xlsx (fichero real del equipo en Drive, no un Sheet nuestro) — fechas se
// dejan tal cual vienen (texto libre, formatos inconsistentes en el fichero real: "01/08/" sin
// año, "SEMANA DEL 15 /09", M/D/Y mezclado con D/M/Y) en vez de forzarlas a una fecha que podría
// quedar mal interpretada.
function parseStatusPedidos(rows) {
  return tabla(rows)
    .filter((f) => f.pedido && norm(f.cliente) !== 'eliminado')
    .map((f) => ({
      pedido: String(f.pedido).trim(),
      planta: plantaDeCodigo(f.pedido),
      cliente: String(f.cliente ?? '').trim(),
      tipoProducto: String(f.tipo_de_producto ?? '').trim(),
      fechaProgramada: String(f.fecha_programada_de_fabricacion ?? '').trim(),
      statusFabricacion: String(f.status_de_fabricacion ?? '').trim(),
      statusMontaje: String(f.status_montaje ?? '').trim(),
      fechaCulminacion: String(f.fecha_de_culminacion ?? '').trim(),
      situacion: String(f.situacion ?? '').trim(),
      observaciones: String(f.observaciones ?? '').trim(),
      etapaFabricacion: clasificarEtapa(f.status_de_fabricacion),
      etapaMontaje: clasificarEtapa(f.status_montaje),
    }));
}

// Acepta 2026-09-14, 14/09/2026 (formato es-VE) o un serial de Excel/Sheets.
function fechaISO(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  return '';
}

return { norm, num, tabla, parsePrecios, parseFlashings, parseFijaciones, parseKpis, parseStatusPedidos, fechaISO };
});

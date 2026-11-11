'use strict';
// Lee KPIs desde Sheets API directamente desde el navegador (sin backend propio).
// Caché en localStorage SIN cifrar — el navegador no tiene equivalente a safeStorage de Electron.
// Por eso el scope sigue siendo de solo lectura y nunca se guarda el token, solo los datos ya
// leídos (los mismos números que ya se ven en pantalla). Ver docs/SEGURIDAD.md.
const WebData = (() => {
  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const HOJAS_KPIS = { areas: 'Areas', kpis: 'KPIs', historial: 'Historial' };
  const HOJAS_PRECIOS = { productos: 'Productos', parametros: 'Parametros', textos: 'Textos', tiposObra: 'TiposObra' };
  const HOJAS_PRECIOS_OPCIONAL = { flashings: 'Flashings', fijaciones: 'Fijaciones' };
  // Nombre legible por tipo de fichero — el mensaje de "sin acceso" antes era genérico para los 3
  // (Precios/KPIs/Personal) y no decía CUÁL fichero fallaba, lo que hacía casi imposible
  // diagnosticar a distancia cuál cuenta le faltaba acceso a qué (caso real, nov 2026).
  const NOMBRE_FICHERO = { precios: 'la Lista de precios', kpis: 'los KPIs', personal: 'Personal' };

  const cacheKey = (kind, email) => `centrolit.cache.${kind}.${email}`;

  function readCache(kind) {
    const email = WebAuth.current()?.email;
    if (!email) return null;
    try { return JSON.parse(localStorage.getItem(cacheKey(kind, email))); } catch { return null; }
  }
  function writeCache(kind, data) {
    const email = WebAuth.current()?.email;
    if (!email) return;
    try { localStorage.setItem(cacheKey(kind, email), JSON.stringify({ fetchedAt: new Date().toISOString(), data })); } catch { /* cuota llena, etc.: sin caché */ }
  }

  async function readTabs(fileId, tabNames, token) {
    const qs = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
    tabNames.forEach((t) => qs.append('ranges', t));
    const r = await fetch(`${SHEETS_BASE}/${encodeURIComponent(fileId)}/values:batchGet?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const e = new Error(j.error?.message || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    const j = await r.json();
    const out = {};
    j.valueRanges.forEach((vr, i) => (out[tabNames[i]] = vr.values || []));
    return out;
  }

  async function demo(kind) {
    if (kind === 'kpis') {
      const [areas, hist] = await Promise.all([fetch('demo/areas.json').then((r) => r.json()), fetch('demo/historial.json').then((r) => r.json())]);
      return { areas, historial: hist.historial };
    }
    if (kind === 'pedidos') {
      const [bridge, real, lineas] = await Promise.all([fetch('demo/pedidos.json').then((r) => r.json()), fetch('demo/status-pedidos.json').then((r) => r.json()), fetch('demo/pedidos-lineas.json').then((r) => r.json())]);
      return { bridge, real, lineas };
    }
    if (kind === 'personal') return fetch('demo/personal.json').then((r) => r.json());
    return fetch('demo/precios.json').then((r) => r.json());
  }

  async function cargar(kind, { fileId, demoMode, refresh }) {
    if (demoMode) return { ok: true, data: await demo(kind), source: 'demo', fetchedAt: null };
    if (!fileId) return { ok: false, code: 'sin_fichero', error: 'Falta indicar el fichero en Ajustes.' };
    if (!WebAuth.current()) return { ok: false, code: 'no_session', error: 'Inicia sesión con tu cuenta de Google.' };

    const cached = readCache(kind);
    if (cached && !refresh) return { ok: true, data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true, source: 'google' };

    try {
      const token = await WebAuth.getAccessToken();
      if (kind === 'personal') {
        const tab = 'Personal';
        const raw = await readTabs(fileId, [tab], token);
        const data = Parsers.parsePersonal(raw[tab]);
        writeCache(kind, data);
        return { ok: true, data, fetchedAt: new Date().toISOString(), source: 'google' };
      }
      const tabs = kind === 'kpis' ? HOJAS_KPIS : HOJAS_PRECIOS;
      const names = Object.values(tabs);
      const raw = await readTabs(fileId, names, token);
      const byKey = Object.fromEntries(Object.entries(tabs).map(([k, name]) => [k, raw[name]]));
      const data = kind === 'kpis' ? Parsers.parseKpis(byKey) : Parsers.parsePrecios(byKey);
      if (kind === 'precios') {
        // Pestañas Flashings/Fijaciones (puntos 4 y 5 del feedback): opcionales — si el Sheet
        // todavía no las tiene, no debe romper la carga de Productos/Parametros/Textos. Esto
        // faltaba en la web (sí estaba en escritorio) — por eso el catálogo de flashings de la
        // Calculadora aparecía vacío solo en la web con cuenta real, nunca en demo ni escritorio.
        try {
          const rawOpc = await readTabs(fileId, Object.values(HOJAS_PRECIOS_OPCIONAL), token);
          data.flashings = Parsers.parseFlashings(rawOpc[HOJAS_PRECIOS_OPCIONAL.flashings] || []);
          data.fijaciones = Parsers.parseFijaciones(rawOpc[HOJAS_PRECIOS_OPCIONAL.fijaciones] || []);
        } catch {
          data.flashings = [];
          data.fijaciones = [];
        }
        // Recetas (materiales por producto, BOM): pestaña opcional aparte, para que si falta no
        // arrastre a Flashings/Fijaciones (ni viceversa).
        try {
          const rawRec = await readTabs(fileId, ['Recetas'], token);
          data.recetas = Parsers.parseRecetas(rawRec.Recetas || []);
        } catch {
          data.recetas = [];
        }
      }
      writeCache(kind, data);
      return { ok: true, data, fetchedAt: new Date().toISOString(), source: 'google' };
    } catch (e) {
      if (e.code === 'no_session') return { ok: false, code: 'no_session', error: e.message };
      if (e.status === undefined && cached) {
        // fetch sin red: usar caché con aviso
        return { ok: true, data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true, stale: true, source: 'google' };
      }
      if (e.status === 403 || e.status === 404) return { ok: false, code: 'sin_acceso', error: `Tu cuenta de Google no tiene acceso al fichero de ${NOMBRE_FICHERO[kind] || kind}.` };
      return { ok: false, code: 'error', error: e.message };
    }
  }

  const getKpis = (opts) => cargar('kpis', opts);
  const getPrecios = (opts) => cargar('precios', opts);
  const getPersonal = (opts) => cargar('personal', opts);

  // Registro de Pedidos (mismo esquema de columnas que src/main/pedidos-service.js).
  const COLUMNAS_PEDIDO = [
    'fechaCreacion', 'origenOferta', 'plantaSugerida', 'cliente', 'rifCliente',
    'telefonoContacto', 'correoContacto', 'direccionFiscal', 'direccionObra', 'ciudadObra',
    'tipoObra', 'formaPago', 'montoTotalUsd', 'incluyeMontaje', 'incluyeFlete',
    'resumenMaterial', 'comentarios', 'registradoPor', 'estadoImportacion',
  ];
  async function leerBridge(fileId, tab, token) {
    if (!fileId) return [];
    const raw = await readTabs(fileId, [tab || 'Pedidos'], token);
    return Parsers.tabla(raw[tab || 'Pedidos']).map((f, i) => ({ fila: i + 2, ...f }));
  }

  // STATUS PEDIDOS.xlsx: fichero real del equipo en Drive, no un Sheet nuestro — se descarga con
  // Drive API (alt=media) y se parsea con ExcelJS (vendor/exceljs.min.js, global `ExcelJS`).
  async function xlsxAFilas(arrayBuffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const filas = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values.slice(1); // ExcelJS: índice 0 vacío
      filas.push(vals.map((c) => (c && typeof c === 'object' && 'text' in c ? c.text : c ?? '')));
    });
    return filas;
  }

  async function leerReal(fileId, token) {
    if (!fileId) return [];
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const e = new Error(j.error?.message || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return Parsers.parseStatusPedidos(await xlsxAFilas(await r.arrayBuffer()));
  }

  // Líneas de materiales de cada pedido (BOM). La pestaña se crea sola al guardar la primera.
  const TAB_LINEAS = 'Pedidos_Lineas';
  async function leerLineas(fileId, token) {
    if (!fileId) return [];
    try {
      const raw = await readTabs(fileId, [TAB_LINEAS], token);
      return Parsers.parsePedidoLineas(raw[TAB_LINEAS]);
    } catch (e) {
      if (e.status === 400) return []; // la pestaña todavía no existe
      throw e;
    }
  }

  async function sheetsReq(url, opts, token) {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const e = new Error(j.error?.message || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return r.json();
  }

  async function ensureTab(fileId, tabName, headers, token) {
    const id = encodeURIComponent(fileId);
    const meta = await sheetsReq(`${SHEETS_BASE}/${id}?fields=sheets.properties.title`, {}, token);
    if ((meta.sheets || []).some((s) => s.properties && s.properties.title === tabName)) return;
    await sheetsReq(`${SHEETS_BASE}/${id}:batchUpdate`, { method: 'POST', body: { requests: [{ addSheet: { properties: { title: tabName } } }] } }, token);
    await sheetsReq(`${SHEETS_BASE}/${id}/values/${encodeURIComponent(tabName + '!A1')}?valueInputOption=RAW`, { method: 'PUT', body: { values: [headers] } }, token);
  }

  const TIPOS_LINEA = ['material', 'lamina', 'fijacion', 'flashing', 'partida', 'observacion'];
  const limpiar = (s, max = 300) => String(s ?? '').slice(0, max);
  function sanearLineas(lineas) {
    if (!Array.isArray(lineas)) throw new Error('Líneas inválidas.');
    if (lineas.length > 500) throw new Error('Demasiadas líneas (máximo 500 por pedido).');
    let hayObs = false;
    return lineas
      .map((l) => {
        const cantidad = Number(l.cantidad);
        const largo = Number(l.largo_m);
        const tipo = TIPOS_LINEA.includes(l.tipo) ? l.tipo : 'partida';
        return {
          tipo,
          producto: limpiar(l.producto), codigo: limpiar(l.codigo, 60), descripcion: limpiar(l.descripcion, tipo === 'observacion' ? 2000 : 300),
          cantidad: Number.isFinite(cantidad) && cantidad >= 0 ? cantidad : 0,
          unidad: limpiar(l.unidad, 20),
          largo_m: tipo === 'lamina' && Number.isFinite(largo) && largo >= 0 ? largo : '',
          nota: limpiar(l.nota),
        };
      })
      // Una observación para producción no tiene cantidad (solo texto, una por pedido); el resto de
      // las líneas necesita cantidad > 0 y algo que las identifique.
      .filter((l) => {
        if (l.tipo === 'observacion') {
          if (hayObs || !l.descripcion.trim()) return false;
          hayObs = true;
          return true;
        }
        return l.cantidad > 0 && (l.producto || l.codigo || l.descripcion);
      });
  }

  const letraColumna = (i) => {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  // Mismo comportamiento que pedidos-service.js > actualizarPedido() (escritorio): edita el código
  // real y la planta de un pedido del Cotizador en su fila de la hoja Pedidos. La columna
  // codigo_pedido se crea sola en la cabecera si todavía no existe.
  async function actualizarPedido(ref, { codigo, planta } = {}, fileId, tab, demoMode) {
    const clave = limpiar(ref, 120).trim();
    if (!clave) throw new Error('Falta el pedido que se quiere editar.');
    const plantaOk = planta === undefined ? undefined : PedidosUtil.plantaBridge(planta);
    if (demoMode) {
      const v = PedidosUtil.validarCodigo(codigo, [], clave);
      if (!v.ok) throw new Error(v.error);
      return { ok: true, demo: true, codigo: v.codigo, planta: plantaOk };
    }
    if (!fileId) throw new Error('Falta configurar el fichero de Pedidos (Ajustes).');
    const hoja = tab || 'Pedidos';
    const token = await WebAuth.getAccessToken();
    const raw = (await readTabs(fileId, [hoja], token))[hoja] || [];
    const cab = raw[0] || [];
    const head = cab.map(Parsers.norm);
    const iRef = head.indexOf('origen_oferta');
    if (iRef < 0) throw new Error('La hoja de Pedidos no tiene la columna origen_oferta.');
    const idx = raw.findIndex((r, i) => i > 0 && String(r[iRef] ?? '').trim() === clave);
    if (idx < 0) throw new Error('No se encontró ese pedido en la hoja de Pedidos (¿se borró la fila?).');
    const v = PedidosUtil.validarCodigo(codigo, Parsers.tabla(raw), clave);
    if (!v.ok) throw new Error(v.error);
    const data = [];
    let iCod = head.indexOf('codigo_pedido');
    if (iCod < 0) {
      iCod = cab.length;
      data.push({ range: `${hoja}!${letraColumna(iCod)}1`, values: [['codigo_pedido']] });
    }
    data.push({ range: `${hoja}!${letraColumna(iCod)}${idx + 1}`, values: [[v.codigo]] });
    if (plantaOk !== undefined) {
      const iPl = head.indexOf('planta_sugerida');
      if (iPl < 0) throw new Error('La hoja de Pedidos no tiene la columna planta_sugerida.');
      data.push({ range: `${hoja}!${letraColumna(iPl)}${idx + 1}`, values: [[plantaOk]] });
    }
    await sheetsReq(`${SHEETS_BASE}/${encodeURIComponent(fileId)}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } }, token);
    return { ok: true, codigo: v.codigo, planta: plantaOk };
  }

  // Mismo comportamiento que pedidos-service.js > guardarLineas() (escritorio): reemplaza TODAS las
  // líneas de un pedido leyendo y reescribiendo la pestaña — idempotente, última escritura gana.
  async function guardarLineas(ref, lineas, fileId, demoMode) {
    const clave = limpiar(ref, 120).trim();
    if (!clave) throw new Error('Falta el pedido al que pertenecen las líneas.');
    const ahora = new Date().toISOString();
    const quien = WebAuth.current()?.email || '';
    const guardadas = sanearLineas(lineas).map((l, i) => ({ pedido_ref: clave, linea: i + 1, ...l, actualizado_por: quien, actualizado_en: ahora }));
    if (demoMode) return { ok: true, demo: true, lineas: guardadas };
    if (!fileId) throw new Error('Falta configurar el fichero de Pedidos (Ajustes).');
    const token = await WebAuth.getAccessToken();
    const id = encodeURIComponent(fileId);
    const cols = Parsers.COLUMNAS_PEDIDO_LINEAS;
    await ensureTab(fileId, TAB_LINEAS, cols, token);
    const raw = await readTabs(fileId, [TAB_LINEAS], token);
    const otras = Parsers.parsePedidoLineas(raw[TAB_LINEAS]).filter((l) => l.pedido_ref !== clave);
    const filas = [...otras, ...guardadas].map((l) => cols.map((c) => l[c] ?? ''));
    await sheetsReq(`${SHEETS_BASE}/${id}/values/${encodeURIComponent(TAB_LINEAS)}:clear`, { method: 'POST', body: {} }, token);
    await sheetsReq(`${SHEETS_BASE}/${id}/values/${encodeURIComponent(TAB_LINEAS + '!A1')}?valueInputOption=RAW`, { method: 'PUT', body: { values: [cols, ...filas] } }, token);
    return { ok: true, lineas: guardadas };
  }

  // data = { bridge: [...registrado desde el Cotizador], real: [...STATUS PEDIDOS.xlsx], lineas: [...] }.
  async function getPedidos(fileId, statusFileId, tab, demoMode) {
    if (demoMode) return { ok: true, data: await demo('pedidos'), source: 'demo' };
    if (!fileId && !statusFileId) return { ok: false, code: 'sin_fichero', error: 'Falta configurar los ficheros de Pedidos (Ajustes).' };
    if (!WebAuth.current()) return { ok: false, code: 'no_session', error: 'Inicia sesión con tu cuenta de Google.' };
    try {
      const token = await WebAuth.getAccessToken();
      const [bridge, real, lineas] = await Promise.all([leerBridge(fileId, tab, token), leerReal(statusFileId, token), leerLineas(fileId, token)]);
      return { ok: true, data: { bridge, real, lineas }, fetchedAt: new Date().toISOString(), source: 'google' };
    } catch (e) {
      if (e.code === 'no_session') return { ok: false, code: 'no_session', error: e.message };
      if (e.status === 403 || e.status === 404) return { ok: false, code: 'sin_acceso', error: 'Tu cuenta de Google no tiene acceso a alguno de los ficheros de Pedidos.' };
      return { ok: false, code: 'error', error: e.message };
    }
  }

  async function pasarAPedido(registro, fileId, tab, demoMode) {
    if (demoMode) throw new Error('No disponible en modo demo — inicia sesión con una cuenta real de Google.');
    if (!fileId) throw new Error('Falta configurar el fichero de Pedidos (Ajustes).');
    const token = await WebAuth.getAccessToken();
    const fila = { ...registro, fechaCreacion: new Date().toISOString(), estadoImportacion: 'pendiente' };
    const valores = COLUMNAS_PEDIDO.map((c) => fila[c] ?? '');
    const qs = new URLSearchParams({ valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' });
    const r = await fetch(`${SHEETS_BASE}/${encodeURIComponent(fileId)}/values/${encodeURIComponent(tab || 'Pedidos')}:append?${qs}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [valores] }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error?.message || `HTTP ${r.status}`);
    }
    // Líneas de materiales (BOM): el pedido ya quedó registrado; si esto falla se avisa con claridad
    // y se pueden agregar después desde la pestaña Pedidos.
    if (Array.isArray(registro.lineas) && registro.lineas.length) {
      try {
        await guardarLineas(registro.origenOferta, registro.lineas, fileId, false);
      } catch (e) {
        throw new Error('El pedido se registró, pero no se pudieron guardar sus líneas de materiales: ' + e.message + ' Puedes agregarlas desde la pestaña Pedidos.');
      }
    }
    return { ok: true };
  }

  // Igual que data-service.js (escritorio): intenta abrir el fichero; 403/404 = sin acceso = el
  // Cuadro de Mando se oculta. Esto es lo único que decide si el módulo aparece.
  async function accesoKpis(fileId, demoMode) {
    if (demoMode) return { visible: true, motivo: 'demo' };
    if (!fileId) return { visible: false, motivo: 'sin_fichero' };
    if (!WebAuth.current()) return { visible: false, motivo: 'no_session' };
    try {
      const token = await WebAuth.getAccessToken();
      const r = await fetch(`${SHEETS_BASE}/${encodeURIComponent(fileId)}?fields=properties.title`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) return { visible: true, motivo: 'ok' };
      if (r.status === 403 || r.status === 404) return { visible: false, motivo: 'sin_acceso' };
      return { visible: !!readCache('kpis'), motivo: 'offline' };
    } catch {
      return { visible: !!readCache('kpis'), motivo: 'offline' };
    }
  }

  return { getKpis, getPrecios, getPersonal, accesoKpis, pasarAPedido, guardarLineas, actualizarPedido, getPedidos };
})();

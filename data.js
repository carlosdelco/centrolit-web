'use strict';
// Lee KPIs desde Sheets API directamente desde el navegador (sin backend propio).
// Caché en localStorage SIN cifrar — el navegador no tiene equivalente a safeStorage de Electron.
// Por eso el scope sigue siendo de solo lectura y nunca se guarda el token, solo los datos ya
// leídos (los mismos números que ya se ven en pantalla). Ver docs/SEGURIDAD.md.
const WebData = (() => {
  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
  const HOJAS_KPIS = { areas: 'Areas', kpis: 'KPIs', historial: 'Historial' };
  const HOJAS_PRECIOS = { productos: 'Productos', parametros: 'Parametros', textos: 'Textos', tiposObra: 'TiposObra' };

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
      const tabs = kind === 'kpis' ? HOJAS_KPIS : HOJAS_PRECIOS;
      const names = Object.values(tabs);
      const raw = await readTabs(fileId, names, token);
      const byKey = Object.fromEntries(Object.entries(tabs).map(([k, name]) => [k, raw[name]]));
      const data = kind === 'kpis' ? Parsers.parseKpis(byKey) : Parsers.parsePrecios(byKey);
      writeCache(kind, data);
      return { ok: true, data, fetchedAt: new Date().toISOString(), source: 'google' };
    } catch (e) {
      if (e.code === 'no_session') return { ok: false, code: 'no_session', error: e.message };
      if (e.status === undefined && cached) {
        // fetch sin red: usar caché con aviso
        return { ok: true, data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true, stale: true, source: 'google' };
      }
      if (e.status === 403 || e.status === 404) return { ok: false, code: 'sin_acceso', error: 'Tu cuenta de Google no tiene acceso a este fichero.' };
      return { ok: false, code: 'error', error: e.message };
    }
  }

  const getKpis = (opts) => cargar('kpis', opts);
  const getPrecios = (opts) => cargar('precios', opts);

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

  return { getKpis, getPrecios, accesoKpis };
})();

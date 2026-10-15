'use strict';
// Módulo Cuadro de Mando (solo Dirección: el acceso lo decide Google Drive, ver data-service.js).
// Solo lectura: los KPIs semanales se cargan en el Google Sheet, la app los muestra.

const Dashboard = (() => {
  let root, data, route = { area: null };

  const semaforo = CotizadorEngine.semaforo;
  const areaPor = (k) => data.areas.find((a) => a.key === k);
  const historial = (k) => data.historial[k] || [];
  const ultima = (k) => historial(k).at(-1) || null;

  function fmtVal(v, unidad) {
    if (v === undefined || v === null || Number.isNaN(Number(v))) return '—';
    const s = Number(v).toLocaleString('es-VE', { maximumFractionDigits: 2 });
    if (unidad === 'US$') return 'US$ ' + s;
    if (unidad === '%') return s + '%';
    return s + (unidad ? ' ' + unidad : '');
  }

  // Peor semáforo entre los KPIs de un área con meta definida.
  function semaforoArea(a) {
    const last = ultima(a.key);
    if (!last) return 'gray';
    const dots = a.kpis.map((k) => semaforo(k, last.valores[k.key])).filter((d) => d !== 'gray');
    return dots.includes('red') ? 'red' : dots.includes('amber') ? 'amber' : dots.length ? 'green' : 'gray';
  }

  function sparkline(valores) {
    if (valores.length < 2) return '';
    const w = 110, h = 28, min = Math.min(...valores), max = Math.max(...valores), rng = max - min || 1;
    const pts = valores.map((v, i) => `${(i / (valores.length - 1)) * (w - 4) + 2},${h - 3 - ((v - min) / rng) * (h - 6)}`);
    const [lx, ly] = pts.at(-1).split(',');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <polyline points="${pts.join(' ')}" fill="none" stroke="#2B4257" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="2.6" fill="#2E8B45"/></svg>`;
  }

  function vistaGeneral() {
    const cards = data.areas.map((a) => {
      const last = ultima(a.key);
      const filas = a.kpis.map((k) => {
        const v = last?.valores[k.key];
        return `<div class="kpirow"><div class="kname">${esc(k.nombre)}</div>
          <div class="kval"><div style="text-align:right"><span class="v">${fmtVal(v, k.unidad)}</span><span class="wk">${last ? fmtFecha(last.semana) : 'sin datos'}</span></div>
          <span class="semdot ${last ? semaforo(k, v) : 'gray'}"></span></div></div>`;
      }).join('');
      return `<button class="kcard" data-area="${esc(a.key)}"><h3>${esc(a.nombre)}<span class="semdot ${semaforoArea(a)}"></span></h3>
        <div class="resp">${esc(a.responsable)}</div>${filas}</button>`;
    }).join('');
    return `<div class="grid">${cards || '<div class="empty-state">No hay áreas definidas en la pestaña "Areas".</div>'}</div>`;
  }

  function vistaArea(a) {
    const hist = historial(a.key);
    const tarjetas = a.kpis.map((k) => {
      const serie = hist.map((h) => h.valores[k.key]).filter((v) => v !== undefined);
      const v = ultima(a.key)?.valores[k.key];
      const meta = k.meta == null ? '<span class="badge" style="background:var(--surface-2);color:var(--muted)">sin meta</span>'
        : `<span class="badge ${k.metaTipo}">meta ${k.metaTipo === 'max' ? '≤' : '≥'} ${esc(k.meta)}${k.unidad === '%' ? '%' : ''}</span>`;
      return `<div class="card" style="margin:0"><div class="kname" style="font-size:12.5px;margin-bottom:6px">${esc(k.nombre)} ${meta}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div class="kval"><span class="semdot ${semaforo(k, v)}"></span><span class="v" style="font-size:20px">${fmtVal(v, k.unidad)}</span></div>${sparkline(serie.slice(-12))}</div></div>`;
    }).join('');

    const filas = hist.slice().reverse().map((h) => `<tr><td>${fmtFecha(h.semana)}</td>
      ${a.kpis.map((k) => `<td><span class="semdot ${semaforo(k, h.valores[k.key])}" style="margin-right:6px"></span>${fmtVal(h.valores[k.key], k.unidad)}</td>`).join('')}
      <td style="color:var(--muted);font-style:italic">${esc(h.nota)}</td></tr>`).join('')
      || `<tr><td colspan="${a.kpis.length + 2}" style="color:var(--muted);font-style:italic">Todavía no hay semanas cargadas para esta área en el Google Sheet.</td></tr>`;

    return `<div class="area-head"><div><h2>${esc(a.nombre)}</h2><div class="resp">Responsable: ${esc(a.responsable)}</div></div>
        <button class="btn secondary" data-area="">← Volver al dashboard</button></div>
      <div class="grid" style="margin-bottom:18px">${tarjetas}</div>
      <div class="panel"><h3>Histórico</h3><div class="tablewrap"><table class="hist">
        <thead><tr><th>Semana</th>${a.kpis.map((k) => `<th>${esc(k.nombre)}</th>`).join('')}<th>Nota</th></tr></thead><tbody>${filas}</tbody></table></div>
        <div class="hint">Los datos se editan directamente en el Google Sheet (pestaña "Historial"); aquí solo se visualizan. El semáforo se calcula solo en KPIs con meta definida.</div></div>`;
  }

  function mount(container, res) {
    root = container;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    data = res.data;
    if (route.area && !areaPor(route.area)) route.area = null;
    pintar();
    root.onclick = (e) => {
      const b = e.target.closest('[data-area]');
      if (b) { route.area = b.dataset.area || null; pintar(); }
    };
  }

  function pintar() {
    root.innerHTML = route.area ? vistaArea(areaPor(route.area)) : vistaGeneral();
  }

  return { mount };
})();

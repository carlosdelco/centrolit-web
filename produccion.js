'use strict';
// Producción: tablero de estado derivado de STATUS PEDIDOS.xlsx (fabricación/montaje). No es un
// Gantt — el fichero real no trae fechas de tarea ni asignación de máquina/operario por pedido,
// solo un texto de estado libre (ej. "Fabricado y entregado", "100%", "sin fabricar"). Mostrar un
// cronograma inventado sería peor que no mostrarlo, así que se agrupan los pedidos reales por
// etapa (sin iniciar / en curso / terminado), igual que hace el motor con pedidos-service.js >
// parseStatusPedidos() > clasificarEtapa().

// Desde 2026-11: la pestaña tiene dos vistas — "Partes de producción" (los partes digitales que envía el
// encargado de revisión, ver partes.js) y "Estado de pedidos" (este tablero, sin cambios).
const Produccion = (() => {
  let contenedor, root, filas = [], subvista = 'partes', pedidosRes = null;
  let etapaVista = 'fabricacion'; // 'fabricacion' | 'montaje'
  let planta = 'todas';

  const COLUMNAS = [
    ['sin_iniciar', 'Sin iniciar'],
    ['en_curso', 'En curso'],
    ['terminado', 'Terminado'],
  ];

  function coincide(f) {
    return planta === 'todas' || f.planta === planta;
  }

  function tarjeta(f) {
    const status = etapaVista === 'fabricacion' ? f.statusFabricacion : f.statusMontaje;
    return `<div class="prod-card" data-i="${filas.indexOf(f)}">
      <div class="prod-card-top"><span class="mono">${esc(f.pedido)}</span><span class="tag-planta">${esc(f.planta)}</span></div>
      <div class="prod-card-cliente">${esc(f.cliente || '—')}</div>
      <div class="prod-card-prod">${esc(f.tipoProducto || '')}</div>
      ${status ? `<div class="prod-card-status">${esc(status)}</div>` : ''}
    </div>`;
  }

  function pintar() {
    const visibles = filas.filter(coincide);
    const porEtapa = (k) => visibles.filter((f) => (etapaVista === 'fabricacion' ? f.etapaFabricacion : f.etapaMontaje) === k);
    const sinDato = visibles.filter((f) => (etapaVista === 'fabricacion' ? f.etapaFabricacion : f.etapaMontaje) === 'sin_dato').length;

    root.innerHTML = `
      <div class="hint" style="margin-bottom:12px">Agrupado a partir del texto de estado de STATUS PEDIDOS.xlsx — no hay cronograma de fechas/máquinas en el fichero real, así que no se muestra un Gantt.</div>
      <div class="toolbar-ped">
        <div class="chips-ped" role="group" aria-label="Vista">
          <button class="chip-ped" data-vista="fabricacion" aria-pressed="${etapaVista === 'fabricacion'}">Fabricación</button>
          <button class="chip-ped" data-vista="montaje" aria-pressed="${etapaVista === 'montaje'}">Montaje</button>
        </div>
        <div class="chips-ped">
          ${['todas', 'P', 'S', 'V'].map((p) => `<button type="button" class="chip-ped" data-planta="${p}" aria-pressed="${p === planta}">${p === 'todas' ? 'Todas' : p + ' · ' + PLANTAS[p]}</button>`).join('')}
        </div>
      </div>
      <div class="board-prod">
        ${COLUMNAS.map(([k, l]) => `<div class="board-col">
          <div class="board-col-h">${esc(l)} <span class="n">${porEtapa(k).length}</span></div>
          <div class="board-col-body">${porEtapa(k).map(tarjeta).join('') || '<p class="hint">Sin pedidos aquí.</p>'}</div>
        </div>`).join('')}
      </div>
      ${sinDato ? `<div class="hint" style="margin-top:10px">${sinDato} pedido(s) sin dato de ${etapaVista === 'fabricacion' ? 'fabricación' : 'montaje'} en el fichero — no se muestran en el tablero.</div>` : ''}
      <div id="panelProd"></div>`;
  }

  function detalle(f) {
    const campo = (l, v) => `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
    return `<div class="card" id="detalleProd" style="margin-top:14px">
      <h2><span class="dot"></span>${esc(f.pedido)} — ${esc(f.cliente)}</h2>
      <div class="doc-info">
        ${campo('Planta', PLANTAS[f.planta] || f.planta)}${campo('Producto', f.tipoProducto)}
        ${campo('Fecha programada de fabricación', f.fechaProgramada)}${campo('Fecha de culminación', f.fechaCulminacion)}
        ${campo('Situación', f.situacion)}
      </div>
      <div class="hint" style="margin-top:8px"><strong>Fabricación:</strong> ${esc(f.statusFabricacion || '—')} &nbsp;·&nbsp; <strong>Montaje:</strong> ${esc(f.statusMontaje || '—')}</div>
      ${f.observaciones ? `<div class="hint" style="margin-top:4px"><strong>Observaciones:</strong> ${esc(f.observaciones)}</div>` : ''}
    </div>`;
  }

  // res = pedidos (para el tablero de estado); partesRes/partesOpts = partes de producción (partes.js).
  function mount(container, res, partesRes, partesOpts) {
    contenedor = container;
    pedidosRes = res;
    const nPend = partesRes && partesRes.ok ? partesRes.data.filter((x) => x.estado === 'enviado').length : 0;
    container.innerHTML = `<div class="chips-ped prod-subtabs" role="tablist">
        <button type="button" class="chip-ped" data-sub="partes" aria-pressed="${subvista === 'partes'}">Partes de producción${nPend ? ` <span class="badge max">${nPend} por procesar</span>` : ''}</button>
        <button type="button" class="chip-ped" data-sub="estado" aria-pressed="${subvista === 'estado'}">Estado de pedidos (STATUS PEDIDOS)</button>
      </div>
      <div id="prodPartes" ${subvista === 'partes' ? '' : 'hidden'}></div>
      <div id="prodEstado" ${subvista === 'estado' ? '' : 'hidden'}></div>`;
    container.onclick = (e) => {
      if (e.target.closest('[data-act="refrescar"]') && partesOpts && partesOpts.refrescar) { partesOpts.refrescar(); return; }
      const s = e.target.closest('[data-sub]');
      if (!s) return;
      subvista = s.dataset.sub;
      container.querySelectorAll('[data-sub]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sub === subvista)));
      container.querySelector('#prodPartes').hidden = subvista !== 'partes';
      container.querySelector('#prodEstado').hidden = subvista !== 'estado';
    };
    if (typeof Partes !== 'undefined') Partes.mount(container.querySelector('#prodPartes'), partesRes, partesOpts || {});
    root = container.querySelector('#prodEstado');
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    filas = res.data.real || [];
    pintar();
    root.onclick = (e) => {
      const vista = e.target.closest('[data-vista]');
      if (vista) { etapaVista = vista.dataset.vista; pintar(); return; }
      const chip = e.target.closest('[data-planta]');
      if (chip) { planta = chip.dataset.planta; pintar(); return; }
      const card = e.target.closest('.prod-card');
      if (card) {
        const f = filas[+card.dataset.i];
        const panel = root.querySelector('#panelProd');
        panel.innerHTML = detalle(f);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
  }

  // Abre la vista de partes (p. ej. desde un pedido: "Registrar parte de producción").
  function mostrarPartes() {
    subvista = 'partes';
    if (!contenedor) return;
    contenedor.querySelectorAll('[data-sub]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sub === 'partes')));
    contenedor.querySelector('#prodPartes').hidden = false;
    contenedor.querySelector('#prodEstado').hidden = true;
  }

  return { mount, mostrarPartes };
})();

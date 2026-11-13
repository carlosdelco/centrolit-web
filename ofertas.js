'use strict';
// Ofertas: seguimiento de las ofertas enviadas desde el Cotizador. Lista a la izquierda y, a la
// derecha, el detalle de la oferta TAL COMO SE ENVIÓ AL CLIENTE (instantánea del documento) con los
// botones "Oferta ganada" (→ se registra como pedido en la pestaña Pedidos) y "Oferta perdida" (con
// el motivo: precio, plazo, competencia...). La lógica de guardado vive en src/shared/ofertas-core.js.

const Ofertas = (() => {
  let root, lista = [], resultado = null;
  let filtro = 'pendiente', q = '', selId = null;
  let paso = null; // null | 'ganada' | 'perdida' — confirmación en curso en el panel
  let ocupado = false;
  let opts = {};

  const ESTADO = {
    pendiente: { l: 'Pendiente', c: 'amber' },
    ganada: { l: 'Ganada', c: 'ok' },
    perdida: { l: 'Perdida', c: 'red' },
  };
  const pill = (e) => `<span class="pill ${(ESTADO[e] || ESTADO.pendiente).c}">${esc((ESTADO[e] || ESTADO.pendiente).l)}</span>`;
  const usd = (n) => 'US$ ' + fmt(n || 0);

  // Una fila por oferta (si el mismo número aparece repetido en la hoja, vale la última), la más
  // reciente primero.
  function preparar(datos) {
    const porId = new Map();
    for (const o of datos || []) porId.set(o.id, o);
    return [...porId.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  // ---------- Detalle del documento (HTML guardado en la hoja → se sanea antes de mostrarlo) ----------
  // Cualquiera con acceso al Sheet puede editar esa celda, así que el HTML se trata como NO confiable:
  // solo se conservan etiquetas y atributos de una lista permitida (sin scripts, estilos en línea,
  // enlaces ni ids) y el único <img> es el logo, cuyo origen pone la app, no el documento.
  const TAGS = new Set(['DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'STRONG', 'B', 'I', 'EM', 'BR', 'P', 'UL', 'OL', 'LI', 'SMALL', 'HR', 'SUP', 'SUB']);
  const DESCARTAR = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'IMG', 'TEMPLATE', 'NOSCRIPT', 'BASE']);
  const ATRIBUTOS = new Set(['class', 'colspan', 'rowspan']);

  function limpiarNodo(nodo) {
    for (const hijo of [...nodo.childNodes]) {
      if (hijo.nodeType === 3) continue; // texto
      if (hijo.nodeType !== 1) { hijo.remove(); continue; } // comentarios, etc.
      const tag = hijo.tagName.toUpperCase();
      if (DESCARTAR.has(tag)) { hijo.remove(); continue; }
      limpiarNodo(hijo);
      if (!TAGS.has(tag)) { hijo.replaceWith(...hijo.childNodes); continue; } // etiqueta desconocida: se queda el contenido
      for (const a of [...hijo.attributes]) {
        if (!ATRIBUTOS.has(a.name)) { hijo.removeAttribute(a.name); continue; }
        if (a.name === 'class') hijo.setAttribute('class', a.value.split(/\s+/).filter((c) => /^[a-z0-9_-]+$/i.test(c)).join(' '));
        else if (!/^\d{1,2}$/.test(a.value)) hijo.removeAttribute(a.name);
      }
    }
  }

  function documentoSeguro(html) {
    const d = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    limpiarNodo(d.body);
    // El logo no viaja en la instantánea: se vuelve a poner aquí con la ruta de esta página.
    const logo = d.body.querySelector('.doc-head-logo');
    if (logo && opts.logoSrc) {
      const img = d.createElement('img');
      img.setAttribute('src', opts.logoSrc);
      img.setAttribute('alt', 'Centrolit');
      logo.insertBefore(img, logo.firstChild);
    }
    return d.body.innerHTML;
  }

  // ---------- Lista ----------
  function visibles() {
    const t = q.trim().toLowerCase();
    return lista.filter((o) => (filtro === 'todas' || o.estado === filtro) && (!t || [o.id, o.cliente, o.resumen, o.vendedor].some((v) => String(v || '').toLowerCase().includes(t))));
  }

  function pintarTabla() {
    const cont = root.querySelector('#tablaOfertas');
    if (!cont) return;
    const v = visibles();
    cont.innerHTML = v.length ? `<table class="tabla-ped ped-tabla ofe-tabla">
      <thead><tr><th>Oferta</th><th>Cliente</th><th class="r">Monto</th><th>Estado</th></tr></thead>
      <tbody>${v.map((o) => `<tr data-id="${esc(o.id)}" class="${o.id === selId ? 'sel' : ''}">
        <td class="mono">${esc(o.id)}<div class="ofe-sub">${esc(fmtFecha(o.fecha))}</div></td>
        <td><strong>${esc(o.cliente || '—')}</strong><div class="ofe-sub">${esc(o.resumen || '')}</div></td>
        <td class="r">${esc(usd(o.montoUsd))}</td>
        <td>${pill(o.estado)}</td>
      </tr>`).join('')}</tbody></table>`
      : `<div class="empty-state" style="margin:30px auto"><b>${lista.length ? 'Sin ofertas con ese filtro' : 'Todavía no hay ofertas'}</b><p>${lista.length ? 'Prueba con otro estado o borra la búsqueda.' : 'Cuando envíes una oferta desde el Cotizador (botón "Enviar a Ofertas") aparecerá aquí.'}</p></div>`;
  }

  function resumenCifras() {
    const suma = (e) => lista.filter((o) => o.estado === e).reduce((a, o) => a + (o.montoUsd || 0), 0);
    const n = (e) => lista.filter((o) => o.estado === e).length;
    const cerradas = n('ganada') + n('perdida');
    const tasa = cerradas ? Math.round((n('ganada') / cerradas) * 100) + '%' : '—';
    return `<div class="stats-ped">
      <div class="stat-ped"><div class="n">${n('pendiente')}</div><div class="l">Pendientes · ${esc(usd(suma('pendiente')))}</div></div>
      <div class="stat-ped"><div class="n">${n('ganada')}</div><div class="l">Ganadas · ${esc(usd(suma('ganada')))}</div></div>
      <div class="stat-ped"><div class="n">${n('perdida')}</div><div class="l">Perdidas · ${esc(usd(suma('perdida')))}</div></div>
      <div class="stat-ped"><div class="n">${esc(tasa)}</div><div class="l">Ofertas ganadas del total cerrado</div></div>
    </div>`;
  }

  function pintar() {
    root.innerHTML = `
      <div class="ped-layout ofe-layout">
        <div class="ped-lista">
          ${resumenCifras()}
          <div class="toolbar-ped">
            <div class="chips-ped">
              ${[['pendiente', 'Pendientes'], ['ganada', 'Ganadas'], ['perdida', 'Perdidas'], ['todas', 'Todas']].map(([k, t]) => `<button type="button" class="chip-ped" data-filtro="${k}" aria-pressed="${k === filtro}">${t}</button>`).join('')}
            </div>
            <input class="search-ped" type="search" id="qOfertas" placeholder="Buscar número, cliente o producto" value="${esc(q)}">
          </div>
          <div class="card" style="padding:0;overflow:auto" id="tablaOfertas"></div>
        </div>
        <aside class="ped-detalle ofe-detalle" id="panelOferta"></aside>
      </div>`;
    pintarTabla();
    pintarPanel();
  }

  // ---------- Panel de detalle ----------
  function campo(l, v) {
    return `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
  }

  function accionesHtml(o) {
    if (o.estado === 'ganada') {
      return `<div class="ofe-acciones"><span class="ofe-ok">✔ Esta oferta pasó a Pedidos.</span>${opts.irAPedidos ? ' <button class="btn secondary small" data-act="ir-pedidos">Ver en Pedidos</button>' : ''}</div>`;
    }
    if (o.estado === 'perdida') {
      return `<div class="ofe-acciones"><button class="btn secondary small" data-act="reabrir" ${ocupado ? 'disabled' : ''}>↩ Reabrir (volver a Pendiente)</button></div>`;
    }
    if (paso === 'ganada') {
      return `<div class="ofe-confirma ofe-confirma-ok">
        <b>¿Marcar como GANADA?</b>
        <p>Se registrará como pedido en la pestaña Pedidos (con sus materiales) y la oferta quedará cerrada.</p>
        <div class="btnrow"><button class="btn" data-act="confirmar-ganada" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Registrando…' : 'Sí, pasar a Pedidos'}</button><button class="btn secondary" data-act="cancelar-paso" ${ocupado ? 'disabled' : ''}>Cancelar</button></div>
      </div>`;
    }
    if (paso === 'perdida') {
      const motivos = (typeof OfertasCore !== 'undefined' ? OfertasCore.MOTIVOS_PERDIDA : []);
      return `<div class="ofe-confirma ofe-confirma-mal">
        <b>¿Por qué se perdió la oferta?</b>
        <select id="ofeMotivo" class="ln-in" style="margin:8px 0"><option value="">— elige un motivo —</option>${motivos.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</select>
        <textarea id="ofeNota" class="ln-in" rows="2" maxlength="500" placeholder="Nota (opcional; obligatoria si el motivo es «Otro»). Ej.: la competencia ofreció 8% menos"></textarea>
        <div class="btnrow" style="margin-top:8px"><button class="btn danger" data-act="confirmar-perdida" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Guardando…' : 'Marcar como perdida'}</button><button class="btn secondary" data-act="cancelar-paso" ${ocupado ? 'disabled' : ''}>Cancelar</button></div>
      </div>`;
    }
    return `<div class="ofe-acciones">
      <button class="btn" data-act="paso-ganada">✅ Oferta ganada</button>
      <button class="btn secondary" data-act="paso-perdida">❌ Oferta perdida</button>
    </div>`;
  }

  function pintarPanel() {
    const cont = root.querySelector('#panelOferta');
    if (!cont) return;
    const o = lista.find((x) => x.id === selId);
    if (!o) {
      cont.innerHTML = '<div class="card ofe-vacio"><b>Selecciona una oferta</b><p>Aquí verás el detalle tal como se envió al cliente, y podrás marcarla como ganada o perdida.</p></div>';
      return;
    }
    const cierre = o.estado !== 'pendiente' && o.cerradoEn
      ? `<div class="ofe-cierre">${o.estado === 'ganada' ? 'Ganada' : 'Perdida'} el ${esc(fmtFechaHora(o.cerradoEn))}${o.cerradoPor ? ' por ' + esc(o.cerradoPor) : ''}
        ${o.estado === 'perdida' ? `<div><b>Motivo:</b> ${esc(o.motivoPerdida || '—')}${o.notaCierre ? ' — ' + esc(o.notaCierre) : ''}</div>` : ''}</div>`
      : '';
    cont.innerHTML = `<div class="card ofe-panel">
      <div class="ofe-cab"><div><div class="ofe-titulo">Oferta ${esc(o.id)}</div><div class="ofe-sub">Enviada el ${esc(fmtFechaHora(o.fecha))}${o.vendedor ? ' por ' + esc(o.vendedor) : ''}</div></div>${pill(o.estado)}</div>
      <div class="doc-info ofe-datos">
        ${campo('Cliente', o.cliente)}${campo('Monto total', usd(o.montoUsd))}
        ${campo('Ciudad de la obra', o.ciudadObra)}${campo('Tipo de obra', o.tipoObra)}
        ${campo('Forma de pago', o.formaPago)}${campo('Producto', o.resumen)}
      </div>
      ${cierre}
      ${accionesHtml(o)}
      ${o.registro ? '' : '<div class="ped-aviso">Esta oferta no tiene sus datos guardados completos: para pasarla a pedido hay que reenviarla desde el Cotizador.</div>'}
    </div>
    <div class="ofe-doc-titulo">Detalle de la oferta enviada al cliente</div>
    ${o.detalle ? `<div class="doc ofe-doc">${documentoSeguro(o.detalle)}</div>` : '<div class="card ofe-vacio"><p>Esta oferta no trae el detalle guardado.</p></div>'}`;
  }

  // ---------- Acciones ----------
  async function recargar(tras) {
    if (!opts.recargar) return;
    const res = await opts.recargar();
    if (res && res.ok) { resultado = res; lista = preparar(res.data); }
    if (tras) tras();
    pintar();
  }

  async function ejecutar(fn, okMsg) {
    if (ocupado) return;
    ocupado = true;
    pintarPanel();
    try {
      const r = await fn();
      paso = null;
      ocupado = false;
      toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await recargar();
      if (opts.alCambiar) opts.alCambiar();
    } catch (e) {
      ocupado = false;
      toast(e.message, 'error');
      pintarPanel();
    }
  }

  function alClick(e) {
    const chip = e.target.closest('[data-filtro]');
    if (chip) { filtro = chip.dataset.filtro; selId = null; paso = null; root.querySelectorAll('[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filtro === filtro))); pintarTabla(); pintarPanel(); return; }
    const fila = e.target.closest('tr[data-id]');
    if (fila) { selId = fila.dataset.id; paso = null; pintarTabla(); pintarPanel(); return; }
    const b = e.target.closest('[data-act]');
    if (!b || !selId) return;
    const o = lista.find((x) => x.id === selId);
    if (!o) return;
    switch (b.dataset.act) {
      case 'paso-ganada': paso = 'ganada'; pintarPanel(); break;
      case 'paso-perdida': paso = 'perdida'; pintarPanel(); break;
      case 'cancelar-paso': paso = null; pintarPanel(); break;
      case 'ir-pedidos': if (opts.irAPedidos) opts.irAPedidos(); break;
      case 'confirmar-ganada':
        ejecutar(() => opts.accion.ganada(o.id), (r) => (r && r.yaGanada ? 'Esa oferta ya estaba marcada como ganada.' : r && r.pedido && r.pedido.demo ? 'Demo: la oferta quedó como ganada, pero en modo demo no se crea ningún pedido real.' : 'Oferta ganada: se registró como pedido en la pestaña Pedidos.'));
        break;
      case 'confirmar-perdida': {
        const motivo = root.querySelector('#ofeMotivo')?.value || '';
        const nota = root.querySelector('#ofeNota')?.value || '';
        if (!motivo) { toast('Elige el motivo por el que se perdió la oferta.', 'error'); break; }
        ejecutar(() => opts.accion.perdida(o.id, motivo, nota), 'Oferta marcada como perdida.');
        break;
      }
      case 'reabrir': ejecutar(() => opts.accion.reabrir(o.id), 'Oferta reabierta: vuelve a estar pendiente.'); break;
    }
  }

  // res = { ok, data: [ofertas] } (ver ofertas-service.js > listar).
  function mount(container, res, o = {}) {
    const mismo = root === container;
    root = container;
    opts = o;
    resultado = res;
    if (!res || !res.ok) { root.innerHTML = bloqueError(res || {}, true); return; }
    lista = preparar(res.data);
    if (!mismo) { filtro = 'pendiente'; q = ''; }
    if (selId && !lista.some((x) => x.id === selId)) selId = null;
    paso = null;
    ocupado = false;
    pintar();
    root.onclick = alClick;
    root.oninput = (e) => { if (e.target.id === 'qOfertas') { q = e.target.value; pintarTabla(); } };
  }

  // Abre una oferta concreta (p. ej. justo después de enviarla desde el Cotizador).
  function abrir(id) {
    if (!root || !lista.some((x) => x.id === id)) return;
    const o = lista.find((x) => x.id === id);
    filtro = o.estado;
    selId = id;
    paso = null;
    pintar();
  }

  return { mount, abrir, documentoSeguro };
})();

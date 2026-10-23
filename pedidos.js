'use strict';
// Pedidos: combina las dos fuentes de pedidos-service.js > listar() —
// "real" = STATUS PEDIDOS.xlsx (el fichero real del equipo en Drive, con código y estado de
// fabricación/montaje) y "bridge" = lo que el propio Cotizador registró con "Pasar a pedido" y
// todavía no tiene código real asignado. Se muestran juntos, distinguibles, sin fusionar filas.

const Pedidos = (() => {
  let root, filas = [];
  let planta = 'todas', q = '';

  const fmt$ = (n) => 'US$ ' + (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plantaBridge = (s) => (['P', 'S', 'V'].includes((s || '').toUpperCase()) ? s.toUpperCase() : 'V');

  function unificar(data) {
    const real = (data.real || []).map((f) => ({ origen: 'real', ...f }));
    const bridge = (data.bridge || [])
      .slice()
      .reverse()
      .map((f) => ({
        origen: 'bridge',
        pedido: '',
        planta: plantaBridge(f.planta_sugerida),
        cliente: f.cliente,
        tipoProducto: f.resumen_material,
        etapaFabricacion: 'sin_dato',
        etapaMontaje: 'sin_dato',
        _raw: f,
      }));
    return [...bridge, ...real];
  }

  function coincide(f) {
    if (planta === 'pendientes') return f.origen === 'bridge';
    if (planta !== 'todas' && f.planta !== planta) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return [f.pedido, f.cliente, f.tipoProducto].some((v) => (v || '').toLowerCase().includes(t));
  }

  function pintar() {
    const visibles = filas.filter(coincide);
    const conCodigo = filas.filter((f) => f.origen === 'real').length;
    const pendientes = filas.length - conCodigo;

    root.innerHTML = `
      <div class="stats-ped">
        <div class="stat-ped"><div class="n">${filas.length}</div><div class="l">Pedidos en total</div></div>
        <div class="stat-ped"><div class="n">${conCodigo}</div><div class="l">Con código real</div></div>
        <div class="stat-ped"><div class="n">${pendientes}</div><div class="l">Pendientes de código</div></div>
      </div>
      <div class="toolbar-ped">
        <div class="chips-ped">
          ${['todas', 'P', 'S', 'V', 'pendientes'].map((p) => `<button type="button" class="chip-ped" data-planta="${p}" aria-pressed="${p === planta}">${p === 'todas' ? 'Todas' : p === 'pendientes' ? 'Pendientes de código' : p + ' · ' + PLANTAS[p]}</button>`).join('')}
        </div>
        <input class="search-ped" type="search" id="qPedidos" placeholder="Buscar código, cliente o producto" value="${esc(q)}">
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${visibles.length ? `<table class="tabla-ped">
          <thead><tr><th>Código</th><th>Planta</th><th>Cliente</th><th>Producto</th><th>Fabricación</th><th>Montaje</th></tr></thead>
          <tbody>${visibles.map((f) => `
            <tr data-i="${filas.indexOf(f)}">
              <td class="mono">${f.origen === 'real' ? esc(f.pedido) : '<span class="pill muted">Pendiente</span>'}</td>
              <td><span class="tag-planta">${esc(f.planta || '—')}</span></td>
              <td><strong>${esc(f.cliente || '—')}</strong></td>
              <td>${esc(f.tipoProducto || '')}</td>
              <td>${pillEtapa(f.etapaFabricacion)}</td>
              <td>${pillEtapa(f.etapaMontaje)}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="empty-state" style="margin:30px auto"><b>Sin pedidos</b><p>No hay pedidos que coincidan con el filtro.</p></div>'}
      </div>
      <div id="panelPedido"></div>`;
  }

  function detalle(f) {
    const campo = (l, v) => `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
    if (f.origen === 'real') {
      return `<div class="card" id="detallePedido" style="margin-top:14px">
        <h2><span class="dot"></span>${esc(f.pedido)} — ${esc(f.cliente)}</h2>
        <div class="doc-info">
          ${campo('Planta', PLANTAS[f.planta] || f.planta)}${campo('Producto', f.tipoProducto)}
          ${campo('Fecha programada de fabricación', f.fechaProgramada)}${campo('Fecha de culminación', f.fechaCulminacion)}
          ${campo('Situación', f.situacion)}
        </div>
        <div class="hint" style="margin-top:8px"><strong>Fabricación:</strong> ${esc(f.statusFabricacion || '—')} &nbsp;·&nbsp; <strong>Montaje:</strong> ${esc(f.statusMontaje || '—')}</div>
        ${f.observaciones ? `<div class="hint" style="margin-top:4px"><strong>Observaciones:</strong> ${esc(f.observaciones)}</div>` : ''}
        <div class="hint" style="margin-top:8px">Fuente: STATUS PEDIDOS.xlsx (Drive, fichero real del equipo).</div>
      </div>`;
    }
    const r = f._raw;
    return `<div class="card" id="detallePedido" style="margin-top:14px">
      <h2><span class="dot"></span>${esc(f.cliente)} — ${esc(r.origen_oferta)}</h2>
      <div class="doc-info">
        ${campo('RIF', r.rif_cliente)}${campo('Planta sugerida', r.planta_sugerida)}
        ${campo('Teléfono', r.telefono_contacto)}${campo('Correo', r.correo_contacto)}
        ${campo('Dirección fiscal', r.direccion_fiscal)}${campo('Dirección de obra', r.direccion_obra)}
        ${campo('Ciudad de la obra', r.ciudad_obra)}${campo('Tipo de obra', r.tipo_obra)}
        ${campo('Forma de pago', r.forma_pago)}${campo('Monto total', fmt$(r.monto_total_usd))}
        ${campo('Incluye montaje', r.incluye_montaje)}${campo('Incluye flete', r.incluye_flete)}
        ${campo('Registrado por', r.registrado_por)}${campo('Enviado', fmtFechaHora(r.fecha_creacion))}
      </div>
      <div class="hint" style="margin-top:8px"><strong>Material:</strong> ${esc(r.resumen_material || '—')}</div>
      ${r.comentarios ? `<div class="hint" style="margin-top:4px"><strong>Comentarios:</strong> ${esc(r.comentarios)}</div>` : ''}
      <div class="hint" style="margin-top:8px">Enviado desde el Cotizador — todavía no tiene código real asignado en STATUS PEDIDOS.xlsx.</div>
    </div>`;
  }

  function mount(container, res) {
    root = container;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    filas = unificar(res.data);
    pintar();
    root.onclick = (e) => {
      const chip = e.target.closest('[data-planta]');
      if (chip) { planta = chip.dataset.planta; pintar(); return; }
      const tr = e.target.closest('tr[data-i]');
      if (tr) {
        const f = filas[+tr.dataset.i];
        const panel = root.querySelector('#panelPedido');
        panel.innerHTML = detalle(f);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    root.oninput = (e) => {
      if (e.target.id === 'qPedidos') { q = e.target.value; pintar(); }
    };
  }

  return { mount };
})();

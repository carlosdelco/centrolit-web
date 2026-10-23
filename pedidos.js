'use strict';
// Módulo Pedidos: la "bandeja de salida" hacia Centrolit Gestión (ver src/main/pedidos-service.js
// y docs/HOJAS-GOOGLE.md > 3). No es el pedido real — eso vive en la base de datos de Gestión,
// fuera de alcance de esta app — es lo que el equipo ya envió por el puente, con su estado de
// importación. Solo lectura.

const Pedidos = (() => {
  let root, filas = [];
  let planta = 'todas', q = '';

  const PLANTAS = { P: 'Paneles', S: 'Centrolam', V: 'Varios' };
  const fmt$ = (n) => 'US$ ' + (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function coincide(f) {
    if (planta !== 'todas' && (f.planta_sugerida || '').toUpperCase() !== planta) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return [f.cliente, f.origen_oferta, f.ciudad_obra, f.resumen_material].some((v) => (v || '').toLowerCase().includes(t));
  }

  function pintar() {
    const visibles = filas.filter(coincide);
    const pendientes = filas.filter((f) => (f.estado_importacion || 'pendiente') !== 'importado').length;
    const importados = filas.length - pendientes;

    root.innerHTML = `
      <div class="stats-ped">
        <div class="stat-ped"><div class="n">${filas.length}</div><div class="l">Enviados a Gestión</div></div>
        <div class="stat-ped"><div class="n">${pendientes}</div><div class="l">Pendientes de importar</div></div>
        <div class="stat-ped"><div class="n">${importados}</div><div class="l">Ya importados</div></div>
      </div>
      <div class="hint" style="margin-bottom:12px">Esto es lo que el equipo ya envió desde el Cotizador con "Pasar a pedido" — no es el pedido real de Centrolit Gestión (eso lo completa y actualiza allá quien gestiona cada obra).</div>
      <div class="toolbar-ped">
        <div class="chips-ped">
          ${['todas', 'P', 'S', 'V'].map((p) => `<button type="button" class="chip-ped" data-planta="${p}" aria-pressed="${p === planta}">${p === 'todas' ? 'Todas' : p + ' · ' + PLANTAS[p]}</button>`).join('')}
        </div>
        <input class="search-ped" type="search" id="qPedidos" placeholder="Buscar cliente, oferta, ciudad o material" value="${esc(q)}">
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${visibles.length ? `<table class="tabla-ped">
          <thead><tr><th>Oferta</th><th>Planta</th><th>Cliente</th><th>Material</th><th class="r">Monto</th><th>Estado</th></tr></thead>
          <tbody>${visibles.map((f, i) => `
            <tr data-i="${filas.indexOf(f)}">
              <td class="mono">${esc(f.origen_oferta)}</td>
              <td><span class="tag-planta">${esc(f.planta_sugerida || '—')}</span></td>
              <td><strong>${esc(f.cliente)}</strong><div class="sub-line">${esc(f.ciudad_obra || '')}</div></td>
              <td>${esc(f.resumen_material || '')}</td>
              <td class="r">${fmt$(f.monto_total_usd)}</td>
              <td><span class="pill ${f.estado_importacion === 'importado' ? 'ok' : 'amber'}">${f.estado_importacion === 'importado' ? 'Importado' : 'Pendiente'}</span></td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="empty-state" style="margin:30px auto"><b>Sin pedidos enviados</b><p>Usa "Pasar a pedido" en una oferta del Cotizador para que aparezca aquí.</p></div>'}
      </div>
      <div id="panelPedido"></div>`;
  }

  function detalle(f) {
    const campo = (l, v) => `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
    return `<div class="card" id="detallePedido" style="margin-top:14px">
      <h2><span class="dot"></span>${esc(f.cliente)} — ${esc(f.origen_oferta)}</h2>
      <div class="doc-info">
        ${campo('RIF', f.rif_cliente)}${campo('Planta sugerida', f.planta_sugerida)}
        ${campo('Teléfono', f.telefono_contacto)}${campo('Correo', f.correo_contacto)}
        ${campo('Dirección fiscal', f.direccion_fiscal)}${campo('Dirección de obra', f.direccion_obra)}
        ${campo('Ciudad de la obra', f.ciudad_obra)}${campo('Tipo de obra', f.tipo_obra)}
        ${campo('Forma de pago', f.forma_pago)}${campo('Monto total', fmt$(f.monto_total_usd))}
        ${campo('Incluye montaje', f.incluye_montaje)}${campo('Incluye flete', f.incluye_flete)}
        ${campo('Registrado por', f.registrado_por)}${campo('Enviado', fmtFechaHora(f.fecha_creacion))}
      </div>
      <div class="hint" style="margin-top:8px"><strong>Material:</strong> ${esc(f.resumen_material || '—')}</div>
      ${f.comentarios ? `<div class="hint" style="margin-top:4px"><strong>Comentarios:</strong> ${esc(f.comentarios)}</div>` : ''}
    </div>`;
  }

  function mount(container, res) {
    root = container;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    filas = res.data.slice().reverse(); // más recientes primero
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

'use strict';
// Clientes: se deriva de las dos fuentes de Pedidos (ver pedidos-service.js > listar()). No hay
// una base de clientes propia — los nombres vienen de STATUS PEDIDOS.xlsx (el fichero real) y los
// datos de contacto (RIF, teléfono, dirección) solo existen para los que pasaron por nuestro
// Cotizador ("Pasar a pedido"). Los demás se muestran solo con nombre e historial de pedidos.

const Clientes = (() => {
  let root, clientes = [];
  let q = '';

  const normNombre = (s) => String(s || '').trim().toLowerCase();

  function construir(data) {
    const porNombre = new Map();
    const entrada = (nombre) => {
      const k = normNombre(nombre);
      if (!k) return null;
      if (!porNombre.has(k)) porNombre.set(k, { nombre: String(nombre).trim(), pedidos: [], contacto: null });
      return porNombre.get(k);
    };
    for (const r of data.real || []) {
      const e = entrada(r.cliente);
      if (e) e.pedidos.push(r);
    }
    for (const b of data.bridge || []) {
      const e = entrada(b.cliente);
      if (!e) continue;
      e.contacto = {
        rif: b.rif_cliente || e.contacto?.rif || '',
        telefono: b.telefono_contacto || e.contacto?.telefono || '',
        correo: b.correo_contacto || e.contacto?.correo || '',
        direccionFiscal: b.direccion_fiscal || e.contacto?.direccionFiscal || '',
        direccionObra: b.direccion_obra || e.contacto?.direccionObra || '',
        ciudad: b.ciudad_obra || e.contacto?.ciudad || '',
      };
    }
    return [...porNombre.values()].sort((a, b) => b.pedidos.length - a.pedidos.length || a.nombre.localeCompare(b.nombre));
  }

  function coincide(c) {
    if (!q) return true;
    return normNombre(c.nombre).includes(q.toLowerCase());
  }

  function pintar() {
    const visibles = clientes.filter(coincide);
    const conContacto = clientes.filter((c) => c.contacto).length;

    root.innerHTML = `
      <div class="stats-ped">
        <div class="stat-ped"><div class="n">${clientes.length}</div><div class="l">Clientes</div></div>
        <div class="stat-ped"><div class="n">${conContacto}</div><div class="l">Con datos de contacto</div></div>
      </div>
      <div class="toolbar-ped">
        <input class="search-ped" type="search" id="qClientes" placeholder="Buscar cliente" value="${esc(q)}" style="margin-left:0">
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${visibles.length ? `<table class="tabla-ped">
          <thead><tr><th>Cliente</th><th class="r">Pedidos</th><th>Contacto</th></tr></thead>
          <tbody>${visibles.map((c) => `
            <tr data-i="${clientes.indexOf(c)}">
              <td><strong>${esc(c.nombre)}</strong></td>
              <td class="r mono">${c.pedidos.length}</td>
              <td>${c.contacto ? '<span class="pill ok">Sí</span>' : '<span class="pill muted">Sin datos</span>'}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="empty-state" style="margin:30px auto"><b>Sin clientes</b><p>No hay clientes que coincidan con la búsqueda.</p></div>'}
      </div>
      <div id="panelCliente"></div>`;
  }

  function detalle(c) {
    const campo = (l, v) => `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
    return `<div class="card" id="detalleCliente" style="margin-top:14px">
      <h2><span class="dot"></span>${esc(c.nombre)}</h2>
      ${c.contacto ? `<div class="doc-info">
          ${campo('RIF', c.contacto.rif)}${campo('Teléfono', c.contacto.telefono)}
          ${campo('Correo', c.contacto.correo)}${campo('Ciudad', c.contacto.ciudad)}
          ${campo('Dirección fiscal', c.contacto.direccionFiscal)}${campo('Dirección de obra', c.contacto.direccionObra)}
        </div>` : `<p class="hint">Sin datos de contacto registrados — todavía no ha cotizado a través del Cotizador.</p>`}
      <h3 style="margin-top:16px;font-size:14px">Pedidos (${c.pedidos.length})</h3>
      ${c.pedidos.length ? `<table class="tabla-ped"><thead><tr><th>Código</th><th>Producto</th><th>Fabricación</th><th>Montaje</th></tr></thead>
        <tbody>${c.pedidos.map((p) => `<tr><td class="mono">${esc(p.pedido)}</td><td>${esc(p.tipoProducto || '')}</td><td>${pillEtapa(p.etapaFabricacion)}</td><td>${pillEtapa(p.etapaMontaje)}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="hint">Sin pedidos con código real todavía.</p>'}
    </div>`;
  }

  function mount(container, res) {
    root = container;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    clientes = construir(res.data);
    pintar();
    root.onclick = (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (tr) {
        const c = clientes[+tr.dataset.i];
        const panel = root.querySelector('#panelCliente');
        panel.innerHTML = detalle(c);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };
    root.oninput = (e) => {
      if (e.target.id === 'qClientes') { q = e.target.value; pintar(); }
    };
  }

  return { mount };
})();

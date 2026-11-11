'use strict';
// Pedidos: lista a la izquierda y, a la derecha (fijo, en vertical), el DETALLE DE PRODUCCIÓN del
// pedido seleccionado: datos de la obra, despiece de láminas, materiales por línea (editables),
// requerimiento de materia prima y observaciones — sin precios, para que producción sepa qué
// tiene que fabricar. Desde ahí se puede editar el código y la planta (pedidos del Cotizador) y
// generar un PDF.
//
// Fuentes (pedidos-service.js > listar()): pedidos del Cotizador ("bridge", hoja Pedidos) y pedidos
// reales de STATUS PEDIDOS.xlsx. Un pedido del Cotizador cuyo código coincide con uno de STATUS
// PEDIDOS se muestra como UNA sola fila (ver PedidosUtil.unificarPedidos). Las líneas de materiales
// viven en la pestaña Pedidos_Lineas; el requerimiento se calcula en vivo con BomEngine.

const Pedidos = (() => {
  let root, filas = [], datos = { bridge: [], real: [], lineas: [] };
  let planta = 'todas', q = '';
  let opts = {};
  let lineasPorRef = new Map(); // ref → líneas guardadas
  let edit = null; // copia de trabajo del pedido abierto

  const fmtN = (n) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
  const copiar = (a) => a.map((l) => ({ ...l }));

  const TIPOS = { material: 'Material', lamina: 'Despiece', fijacion: 'Fijación', flashing: 'Flashing', partida: 'Partida' };
  const UNIDADES = ['ml', 'm2', 'lámina', 'pieza', 'unid', 'kg'];
  const UNIDAD_POR_TIPO = { material: 'ml', lamina: 'lámina', fijacion: 'unid', flashing: 'pieza', partida: 'unid' };

  function agrupar(lineas) {
    const m = new Map();
    for (const l of lineas || []) {
      if (!m.has(l.pedido_ref)) m.set(l.pedido_ref, []);
      m.get(l.pedido_ref).push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.linea || 0) - (b.linea || 0));
    return m;
  }

  function coincide(f) {
    if (planta === 'pendientes') return !f.conCodigo;
    if (planta !== 'todas' && f.planta !== planta) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return [f.pedido, f.cliente, f.tipoProducto].some((v) => (v || '').toLowerCase().includes(t));
  }

  // ---------- Lista ----------
  function pintarTabla() {
    const cont = root.querySelector('#tablaPedidos');
    if (!cont) return;
    const visibles = filas.filter(coincide);
    cont.innerHTML = visibles.length ? `<table class="tabla-ped ped-tabla">
      <thead><tr><th>Código</th><th>Planta</th><th>Cliente</th><th>Producto</th><th>Fab.</th><th>Mont.</th></tr></thead>
      <tbody>${visibles.map((f) => {
        const tiene = (lineasPorRef.get(f.ref) || lineasPorRef.get(f.alt) || []).length > 0;
        return `<tr data-ref="${esc(f.ref)}" class="${edit && edit.ref === f.ref ? 'sel' : ''}">
          <td class="mono">${f.conCodigo ? esc(f.pedido) : '<span class="pill muted">Pendiente</span>'}</td>
          <td><span class="tag-planta">${esc(f.planta || '—')}</span></td>
          <td><strong>${esc(f.cliente || '—')}</strong></td>
          <td>${esc(f.tipoProducto || '')}${tiene ? '<div><span class="pill muted" title="Tiene líneas de materiales">materiales</span></div>' : ''}</td>
          <td>${pillEtapa(f.etapaFabricacion)}</td>
          <td>${pillEtapa(f.etapaMontaje)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>` : '<div class="empty-state" style="margin:30px auto"><b>Sin pedidos</b><p>No hay pedidos que coincidan con el filtro.</p></div>';
  }

  function pintar() {
    const sinCodigo = filas.filter((f) => !f.conCodigo).length;
    root.innerHTML = `
      <div class="ped-layout">
        <div class="ped-lista">
          <div class="stats-ped">
            <div class="stat-ped"><div class="n">${filas.length}</div><div class="l">Pedidos en total</div></div>
            <div class="stat-ped"><div class="n">${filas.length - sinCodigo}</div><div class="l">Con código</div></div>
            <div class="stat-ped"><div class="n">${sinCodigo}</div><div class="l">Pendientes de código</div></div>
          </div>
          <div class="toolbar-ped">
            <div class="chips-ped">
              ${['todas', 'P', 'S', 'V', 'pendientes'].map((p) => `<button type="button" class="chip-ped" data-planta="${p}" aria-pressed="${p === planta}">${p === 'todas' ? 'Todas' : p === 'pendientes' ? 'Pendientes de código' : p + ' · ' + PLANTAS[p]}</button>`).join('')}
            </div>
            <input class="search-ped" type="search" id="qPedidos" placeholder="Buscar código, cliente o producto" value="${esc(q)}">
          </div>
          <div class="card" style="padding:0;overflow:auto" id="tablaPedidos"></div>
        </div>
        <aside class="ped-detalle" id="panelPedido"></aside>
      </div>`;
    pintarTabla();
    pintarPanel();
  }

  // ---------- Detalle de producción (panel derecho) ----------
  function campo(l, v) {
    return `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
  }

  function filaLinea(l, i) {
    const productos = opts.productos || [];
    const conProducto = l.tipo === 'material' || l.tipo === 'lamina';
    const enCatalogo = productos.includes(l.producto);
    const desc = conProducto
      ? `<select class="ln-in" data-i="${i}" data-f="producto">
          <option value="">— elige producto —</option>
          ${!enCatalogo && l.producto ? `<option value="${esc(l.producto)}" selected>${esc(l.producto)} (no está en el catálogo)</option>` : ''}
          ${productos.map((p) => `<option value="${esc(p)}" ${p === l.producto ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>${l.tipo === 'lamina' ? `<input class="ln-in ln-nota" data-i="${i}" data-f="descripcion" value="${esc(l.descripcion)}" placeholder="a qué techo/sección corresponde" maxlength="300">` : ''}`
      : `<div class="ln-desc2">
          ${l.tipo === 'flashing' ? `<input class="ln-in ln-cod" data-i="${i}" data-f="codigo" value="${esc(l.codigo)}" placeholder="código" maxlength="60">` : ''}
          <input class="ln-in" data-i="${i}" data-f="descripcion" value="${esc(l.descripcion)}" placeholder="descripción" maxlength="300">
        </div>`;
    return `<tr>
      <td><span class="pill muted">${esc(TIPOS[l.tipo] || l.tipo)}</span></td>
      <td>${desc}</td>
      <td><input class="ln-in ln-num" type="number" min="0" step="0.01" data-i="${i}" data-f="cantidad" value="${l.cantidad ?? ''}"></td>
      <td><select class="ln-in" data-i="${i}" data-f="unidad">${UNIDADES.map((u) => `<option value="${u}" ${u === l.unidad ? 'selected' : ''}>${u}</option>`).join('')}${l.unidad && !UNIDADES.includes(l.unidad) ? `<option value="${esc(l.unidad)}" selected>${esc(l.unidad)}</option>` : ''}</select></td>
      <td>${l.tipo === 'lamina' ? `<input class="ln-in ln-num" type="number" min="0" step="0.01" data-i="${i}" data-f="largo_m" value="${l.largo_m ?? ''}" title="Largo de cada lámina (m)">` : ''}</td>
      <td><button type="button" class="link" data-ln="quitar" data-i="${i}" title="Quitar línea">✕</button></td>
    </tr>`;
  }

  function pintarPanel() {
    const box = root.querySelector('#panelPedido');
    if (!box) return;
    if (!edit) {
      box.innerHTML = '<div class="card ped-vacio"><b>Detalle de producción</b><p>Selecciona un pedido de la lista para ver qué hay que fabricar: despiece de láminas, materiales por línea y requerimiento de materia prima.</p></div>';
      return;
    }
    const f = edit.f;
    const r = f._raw || {};
    const editable = !!f._raw;
    const hayMaterial = edit.lineas.some((l) => l.tipo === 'material');
    const hayDespiece = edit.lineas.some((l) => l.tipo === 'lamina');
    const demo = opts.demo ? '<div class="hint" style="margin:0 0 8px">Modo demo: los cambios se ven aquí pero no se guardan en Drive.</div>' : '';
    box.innerHTML = `<div class="card ped-panel">
      <div class="ped-panel-head">
        <h2 style="margin:0"><span class="dot"></span>Detalle de producción</h2>
        <button type="button" class="btn small" data-ln="pdf">📄 Generar PDF</button>
      </div>
      ${demo}
      <div class="ped-meta">
        <div><label>Código del pedido</label>${editable
          ? `<input class="ln-in" id="pedCodigo" value="${esc(edit.codigo)}" placeholder="p. ej. P341" maxlength="40" style="text-transform:uppercase">`
          : `<div class="ped-fijo mono">${esc(f.pedido || '—')}</div>`}</div>
        <div><label>Planta${f.fusionado ? ' (según el código)' : ''}</label>${editable && !f.fusionado
          ? `<select class="ln-in" id="pedPlanta">${['P', 'S', 'V'].map((p) => `<option value="${p}" ${p === edit.planta ? 'selected' : ''}>${p} · ${PLANTAS[p]}</option>`).join('')}</select>`
          : `<div class="ped-fijo">${esc((f.planta || '—') + (PLANTAS[f.planta] ? ' · ' + PLANTAS[f.planta] : ''))}</div>`}</div>
      </div>
      <div class="doc-info ped-info">
        ${campo('Cliente', f.cliente)}
        ${editable ? campo('Oferta', r.origen_oferta) : ''}
        ${campo('Producto', f.tipoProducto)}
        ${editable ? campo('Ciudad de la obra', r.ciudad_obra) + campo('Dirección de entrega', r.direccion_obra) + campo('Tipo de obra', r.tipo_obra) : ''}
        ${f.origen === 'real' ? campo('Fabricación', f.statusFabricacion) + campo('Montaje', f.statusMontaje) + campo('Fecha programada', f.fechaProgramada) + campo('Situación', f.situacion) : ''}
      </div>
      ${f.fusionado ? '<div class="hint" style="margin:6px 0 0">Este pedido ya tiene su código en STATUS PEDIDOS.xlsx: se muestran juntos el estado del fichero y los materiales del Cotizador.</div>' : ''}
      ${f.origen === 'real' && !f._raw ? '<div class="hint" style="margin:6px 0 0">Pedido de STATUS PEDIDOS.xlsx: el código y la planta vienen de ese fichero (la app solo lo lee).</div>' : ''}

      <h3 class="ped-h3">Materiales del pedido</h3>
      <div class="hint" style="margin:0 0 8px">Lo que lleva este pedido, tal como lo generó el Cotizador. Se puede corregir: la cantidad real puede diferir de la cotizada. Cantidad 0 o ✕ quita la línea.</div>
      ${edit.lineas.length ? `<div class="tablewrap"><table class="tabla-ped ln-tabla">
        <thead><tr><th>Tipo</th><th>Descripción / producto</th><th>Cant.</th><th>Unidad</th><th>Largo m</th><th></th></tr></thead>
        <tbody>${edit.lineas.map(filaLinea).join('')}</tbody>
      </table></div>` : '<div class="hint">Este pedido todavía no tiene líneas de materiales. Agrégalas abajo.</div>'}
      ${hayMaterial && !hayDespiece ? '<div class="hint" style="margin-top:6px">Sin despiece de láminas (cantidad × largo): la oferta no se armó con la Calculadora. Se puede agregar con “+ Agregar línea → Despiece”.</div>' : ''}
      <div class="btnrow" style="margin-top:10px">
        <select id="lnNuevoTipo" class="ln-in" style="max-width:130px">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <button type="button" class="btn secondary small" data-ln="agregar">+ Agregar línea</button>
      </div>

      <div id="bomBox"></div>

      <h3 class="ped-h3">Observaciones para producción</h3>
      <textarea class="ln-in" id="pedObs" rows="3" maxlength="2000" placeholder="Color, calibre, fecha de entrega, cómo despachar… (sale en el PDF)">${esc(edit.obs)}</textarea>

      <div class="btnrow" style="margin-top:12px">
        <span style="flex:1"></span>
        <button type="button" class="btn secondary small" data-ln="descartar" ${edit.sucio ? '' : 'disabled'}>Descartar cambios</button>
        <button type="button" class="btn small" data-ln="guardar" ${edit.sucio ? '' : 'disabled'}>Guardar cambios</button>
      </div>
    </div>`;
    pintarBom();
  }

  function requerimiento() {
    return BomEngine.calcularMateriales({ lineas: edit.lineas, recetas: opts.recetas || [], anchos: opts.anchos || {} });
  }

  // Bloque de materia prima (compartido por la pantalla y el PDF).
  function htmlRequerimiento(r) {
    const hayPorConfirmar = r.materiales.some((m) => m.estado !== 'confirmada');
    const nombres = (m) => m.detalle.map((d) => `${d.producto}: ${fmtN(d.cantidad)}`).join(' · ');
    return `
      ${r.materiales.length ? `<table class="tabla-ped">
        <thead><tr><th>Material</th><th>Cantidad</th><th>Unidad</th><th>Receta</th><th>Aporte por producto</th></tr></thead>
        <tbody>${r.materiales.map((m) => `<tr>
          <td><strong>${esc(m.material)}</strong></td>
          <td class="mono">${fmtN(m.cantidad)}</td>
          <td>${esc(m.unidad)}</td>
          <td>${m.estado === 'confirmada' ? '<span class="pill ok">confirmada</span>' : '<span class="pill amber">por confirmar</span>'}</td>
          <td class="hint" style="font-size:12px">${esc(nombres(m))}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="hint">Todavía no se puede calcular ningún material: faltan recetas con cantidad física para los productos de este pedido.</div>'}
      ${hayPorConfirmar ? '<div class="hint" style="margin-top:6px">⚠ ORIENTATIVO: recetas por confirmar (datos de análisis de costos de 2019–2021). No usar para comprar hasta que producción las valide.</div>' : ''}
      ${r.sinReceta.length ? `<div class="hint" style="margin-top:6px"><strong>Sin receta:</strong> ${r.sinReceta.map(esc).join(', ')} — no se calculan sus materiales.</div>` : ''}
      ${r.pendientes.length ? `<div class="hint" style="margin-top:6px"><strong>Pendiente de receta:</strong> ${r.pendientes.map((p) => `${esc(p.material)} de ${esc(p.producto)} (${esc(String(p.motivo).replace(/.$/, ''))})`).join('; ')}</div>` : ''}`;
  }

  function pintarBom() {
    const box = root.querySelector('#bomBox');
    if (!box || !edit) return;
    const r = requerimiento();
    box.innerHTML = `<h3 class="ped-h3">Requerimiento de materia prima</h3><div class="tablewrap">${htmlRequerimiento(r)}</div>
      ${r.accesorios.length ? `<h3 class="ped-h3">Fijaciones, flashings y partidas</h3>
        <div class="tablewrap"><table class="tabla-ped">
          <thead><tr><th>Tipo</th><th>Descripción</th><th>Cantidad</th><th>Unidad</th></tr></thead>
          <tbody>${r.accesorios.map((a) => `<tr>
            <td><span class="pill muted">${esc(TIPOS[a.tipo] || a.tipo)}</span></td>
            <td>${a.codigo ? `<span class="mono">${esc(a.codigo)}</span> ` : ''}${esc(a.descripcion)}</td>
            <td class="mono">${fmtN(a.cantidad)}</td><td>${esc(a.unidad)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : ''}`;
  }

  function abrirPedido(f, scroll) {
    const todas = copiar(lineasPorRef.get(f.ref) || lineasPorRef.get(f.alt) || []);
    const obs = todas.find((l) => l.tipo === 'observacion');
    const r = f._raw;
    edit = {
      f,
      ref: f.ref,
      codigo: r ? PedidosUtil.normCodigo(r.codigo_pedido) : f.pedido || '',
      planta: f.planta || 'V',
      orig: { codigo: r ? PedidosUtil.normCodigo(r.codigo_pedido) : '', planta: f.planta || 'V' },
      lineas: todas.filter((l) => l.tipo !== 'observacion'),
      obs: obs ? obs.descripcion : '',
      sucioMeta: false,
      sucioLineas: false,
      sucio: false,
    };
    pintarTabla();
    pintarPanel();
    if (scroll) root.querySelector('#panelPedido').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function marcarSucio(tipo) {
    if (tipo === 'meta') edit.sucioMeta = true;
    else edit.sucioLineas = true;
    edit.sucio = true;
    root.querySelectorAll('[data-ln="guardar"],[data-ln="descartar"]').forEach((b) => (b.disabled = false));
  }

  async function guardar() {
    const btn = root.querySelector('[data-ln="guardar"]');
    const f = edit.f;
    if (f._raw && edit.sucioMeta) {
      const v = PedidosUtil.validarCodigo(edit.codigo, datos.bridge, edit.ref);
      if (!v.ok) { toast(v.error, 'error'); return; }
      edit.codigo = v.codigo;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      if (f._raw && edit.sucioMeta) {
        const res = await opts.actualizarPedido(edit.ref, { codigo: edit.codigo, planta: edit.planta });
        f._raw.codigo_pedido = res.codigo;
        f._raw.planta_sugerida = res.planta;
        edit.sucioMeta = false;
      }
      if (edit.sucioLineas) {
        const aGuardar = [...edit.lineas];
        if (edit.obs.trim()) aGuardar.push({ tipo: 'observacion', descripcion: edit.obs, cantidad: 0 });
        const res = await opts.guardarLineas(edit.ref, aGuardar);
        lineasPorRef.set(edit.ref, (res && res.lineas) || []);
        edit.sucioLineas = false;
      }
      toast(opts.demo ? 'Cambios aplicados (modo demo: no se guardan en Drive).' : 'Cambios guardados.');
      const ref = edit.ref;
      filas = PedidosUtil.unificarPedidos(datos); // el código puede haber fusionado el pedido con uno real
      edit = null;
      pintarTabla();
      abrirPedido(filas.find((x) => x.ref === ref) || filas[0], false);
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
    }
  }

  // ---------- PDF (hoja de producción, sin precios) ----------
  function docImpresion() {
    const f = edit.f;
    const r = f._raw || {};
    const emp = opts.empresa || {};
    const R = requerimiento();
    const hoy = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const codigo = f._raw ? (PedidosUtil.normCodigo(edit.codigo) || 'Pendiente de código') : f.pedido || '—';
    const lineasTabla = edit.lineas.filter((l) => l.tipo !== 'lamina' && Number(l.cantidad) > 0);
    const laminas = edit.lineas.filter((l) => l.tipo === 'lamina' && Number(l.cantidad) > 0);
    const dato = (l, v) => (v ? `<div><span>${esc(l)}:</span> ${esc(v)}</div>` : '');
    return `<div class="ped-doc">
      <div class="ped-doc-head">
        <div class="ped-doc-logo"><img src="${esc(opts.logoSrc || '')}" alt="Grupo Centrolit"></div>
        <div class="ped-doc-titulo"><div class="t">Orden de producción</div><div class="s">Detalle de materiales del pedido</div></div>
        <div class="ped-doc-meta"><div><b>Código:</b> ${esc(codigo)}</div><div><b>Planta:</b> ${esc(edit.planta || f.planta || '—')}${PLANTAS[edit.planta || f.planta] ? ' · ' + esc(PLANTAS[edit.planta || f.planta]) : ''}</div><div><b>Fecha:</b> ${hoy}</div></div>
      </div>
      <div class="ped-doc-info">
        ${dato('Cliente', f.cliente)}${dato('Oferta', r.origen_oferta)}${dato('Producto', f.tipoProducto)}
        ${dato('Ciudad de la obra', r.ciudad_obra)}${dato('Dirección de entrega', r.direccion_obra)}${dato('Tipo de obra', r.tipo_obra)}
        ${f.origen === 'real' ? dato('Fabricación', f.statusFabricacion) + dato('Montaje', f.statusMontaje) + dato('Fecha programada', f.fechaProgramada) : ''}
      </div>
      <h3>Despiece de láminas</h3>
      ${laminas.length ? `<table><thead><tr><th>Sección / techo</th><th>Producto</th><th class="r">Láminas</th><th class="r">Largo (m)</th><th class="r">Metros lineales</th></tr></thead>
        <tbody>${laminas.map((l) => `<tr><td>${esc(l.descripcion || '—')}</td><td>${esc(l.producto)}</td><td class="r">${fmtN(l.cantidad)}</td><td class="r">${fmtN(l.largo_m)}</td><td class="r">${fmtN(l.cantidad * (Number(l.largo_m) || 0))}</td></tr>`).join('')}</tbody></table>`
        : '<p class="nota">Sin despiece de láminas en este pedido (la oferta no se armó con la Calculadora): usar el total de metros de abajo.</p>'}
      <h3>Materiales del pedido</h3>
      ${lineasTabla.length ? `<table><thead><tr><th>Tipo</th><th>Descripción</th><th class="r">Cantidad</th><th>Unidad</th></tr></thead>
        <tbody>${lineasTabla.map((l) => `<tr><td>${esc(TIPOS[l.tipo] || l.tipo)}</td><td>${l.codigo ? `<b>${esc(l.codigo)}</b> ` : ''}${esc(l.descripcion || l.producto)}${l.tipo === 'material' && l.nota ? ` <span class="nota">(${esc(l.nota)})</span>` : ''}</td><td class="r">${fmtN(l.cantidad)}</td><td>${esc(l.unidad)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="nota">Sin líneas de materiales.</p>'}
      <h3>Requerimiento de materia prima <span class="nota">(orientativo)</span></h3>
      <div class="ped-doc-bom">${htmlRequerimiento(R)}</div>
      ${edit.obs.trim() ? `<h3>Observaciones para producción</h3><p class="obs">${esc(edit.obs).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="ped-doc-firmas"><div>Elaborado por</div><div>Recibido por producción</div></div>
      <div class="ped-doc-pie">${esc(emp.nombre || 'Grupo Centrolit')}${emp.rif ? ' · RIF ' + esc(emp.rif) : ''}${emp.web ? ' · ' + esc(emp.web) : ''} — Documento interno, sin precios.</div>
    </div>`;
  }

  async function imprimir() {
    if (!edit || !opts.imprimir) return;
    const host = document.createElement('div');
    host.id = 'docPedidoPrint';
    host.innerHTML = docImpresion();
    document.body.appendChild(host);
    document.body.classList.add('imprimiendo-pedido');
    const base = String(edit.f.pedido || edit.ref || 'pedido');
    const nombre = ('Produccion_' + base + '_' + String(edit.f.cliente || '')).replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 80);
    try {
      await Promise.all(Array.from(host.querySelectorAll('img')).map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; }))));
      await new Promise((res) => setTimeout(res, 150));
      const res = await opts.imprimir(nombre);
      if (res && res.saved) toast('PDF guardado.');
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    } finally {
      document.body.classList.remove('imprimiendo-pedido');
      host.remove();
    }
  }

  // ---------- Montaje ----------
  function mount(container, res, o = {}) {
    root = container;
    opts = o;
    edit = null;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    datos = { bridge: res.data.bridge || [], real: res.data.real || [], lineas: res.data.lineas || [] };
    filas = PedidosUtil.unificarPedidos(datos);
    lineasPorRef = agrupar(datos.lineas);
    pintar();

    root.onclick = (e) => {
      const chip = e.target.closest('[data-planta]');
      if (chip) { planta = chip.dataset.planta; pintar(); return; }
      const ln = e.target.closest('[data-ln]');
      if (ln && edit) {
        const act = ln.dataset.ln;
        if (act === 'agregar') {
          const tipo = root.querySelector('#lnNuevoTipo').value;
          edit.lineas.push({ pedido_ref: edit.ref, tipo, producto: '', codigo: '', descripcion: '', cantidad: '', unidad: UNIDAD_POR_TIPO[tipo] || 'unid', largo_m: '', nota: '' });
          marcarSucio('lineas'); pintarPanel();
        } else if (act === 'quitar') {
          edit.lineas.splice(+ln.dataset.i, 1);
          marcarSucio('lineas'); pintarPanel();
        } else if (act === 'descartar') {
          abrirPedido(edit.f, false);
        } else if (act === 'guardar') {
          guardar();
        } else if (act === 'pdf') {
          imprimir();
        }
        return;
      }
      const tr = e.target.closest('tr[data-ref]');
      if (tr) {
        const f = filas.find((x) => x.ref === tr.dataset.ref);
        if (f) abrirPedido(f, true);
      }
    };

    // Edición: se actualiza la copia de trabajo y solo se recalcula el requerimiento (no se repinta
    // el panel, para no perder el foco mientras se escribe).
    const alEditar = (e) => {
      const t = e.target;
      if (!edit) return;
      if (t.id === 'pedCodigo') { edit.codigo = t.value.toUpperCase(); marcarSucio('meta'); return; }
      if (t.id === 'pedPlanta') { edit.planta = t.value; marcarSucio('meta'); return; }
      if (t.id === 'pedObs') { edit.obs = t.value; marcarSucio('lineas'); return; }
      const inp = t.closest('.ln-in[data-i]');
      if (!inp) return;
      const l = edit.lineas[+inp.dataset.i];
      if (!l) return;
      const campoL = inp.dataset.f;
      l[campoL] = campoL === 'cantidad' || campoL === 'largo_m' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      if (campoL === 'producto' && l.tipo === 'material') l.descripcion = inp.value;
      marcarSucio('lineas');
      pintarBom();
    };
    root.oninput = (e) => {
      if (e.target.id === 'qPedidos') { q = e.target.value; pintarTabla(); return; }
      if (e.target.matches('input.ln-in, textarea.ln-in')) alEditar(e);
    };
    root.onchange = (e) => {
      if (e.target.matches('select.ln-in')) alEditar(e);
    };
  }

  return { mount };
})();

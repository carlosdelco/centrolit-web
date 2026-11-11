'use strict';
// Pedidos: combina las dos fuentes de pedidos-service.js > listar() —
// "real" = STATUS PEDIDOS.xlsx (el fichero real del equipo en Drive, con código y estado de
// fabricación/montaje) y "bridge" = lo que el propio Cotizador registró con "Pasar a pedido" y
// todavía no tiene código real asignado. Se muestran juntos, distinguibles, sin fusionar filas.
//
// Además, cada pedido (de cualquiera de las dos fuentes) tiene sus "Materiales del pedido":
// líneas editables (material, fijación, flashing, partida) guardadas en la pestaña Pedidos_Lineas,
// y el requerimiento de materiales calculado en vivo con las recetas (BomEngine).

const Pedidos = (() => {
  let root, filas = [];
  let planta = 'todas', q = '';
  let opts = {};
  let lineasPorRef = new Map(); // pedido_ref → líneas guardadas
  let edit = null; // { ref, lineas: [...], sucio: bool } — copia de trabajo del pedido abierto

  const fmt$ = (n) => 'US$ ' + (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtN = (n) => (Number(n) || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 });
  const plantaBridge = (s) => (['P', 'S', 'V'].includes((s || '').toUpperCase()) ? s.toUpperCase() : 'V');
  const refDe = (f) => (f.origen === 'real' ? f.pedido : f._raw.origen_oferta);
  const copiar = (a) => a.map((l) => ({ ...l }));

  const TIPOS = { material: 'Material', fijacion: 'Fijación', flashing: 'Flashing', partida: 'Partida' };
  const UNIDADES = ['ml', 'm2', 'pieza', 'unid', 'kg'];
  const UNIDAD_POR_TIPO = { material: 'ml', fijacion: 'unid', flashing: 'pieza', partida: 'unid' };

  function agrupar(lineas) {
    const m = new Map();
    for (const l of lineas || []) {
      if (!m.has(l.pedido_ref)) m.set(l.pedido_ref, []);
      m.get(l.pedido_ref).push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => (a.linea || 0) - (b.linea || 0));
    return m;
  }

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
          <tbody>${visibles.map((f) => {
            const tiene = (lineasPorRef.get(refDe(f)) || []).length > 0;
            return `
            <tr data-i="${filas.indexOf(f)}">
              <td class="mono">${f.origen === 'real' ? esc(f.pedido) : '<span class="pill muted">Pendiente</span>'}</td>
              <td><span class="tag-planta">${esc(f.planta || '—')}</span></td>
              <td><strong>${esc(f.cliente || '—')}</strong></td>
              <td>${esc(f.tipoProducto || '')}${tiene ? ' <span class="pill muted" title="Tiene líneas de materiales">materiales</span>' : ''}</td>
              <td>${pillEtapa(f.etapaFabricacion)}</td>
              <td>${pillEtapa(f.etapaMontaje)}</td>
            </tr>`;
          }).join('')}</tbody>
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

  // ---------- Materiales del pedido (editable) ----------
  function filaLinea(l, i) {
    const productos = opts.productos || [];
    const enCatalogo = productos.includes(l.producto);
    const campoDesc = l.tipo === 'material'
      ? `<select class="ln-in" data-i="${i}" data-f="producto">
          <option value="">— elige producto —</option>
          ${!enCatalogo && l.producto ? `<option value="${esc(l.producto)}" selected>${esc(l.producto)} (no está en el catálogo)</option>` : ''}
          ${productos.map((p) => `<option value="${esc(p)}" ${p === l.producto ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>`
      : `<div class="ln-desc2">
          ${l.tipo === 'flashing' ? `<input class="ln-in ln-cod" data-i="${i}" data-f="codigo" value="${esc(l.codigo)}" placeholder="código" maxlength="60">` : ''}
          <input class="ln-in" data-i="${i}" data-f="descripcion" value="${esc(l.descripcion)}" placeholder="descripción" maxlength="300">
        </div>`;
    return `<tr>
      <td><span class="pill muted">${esc(TIPOS[l.tipo] || l.tipo)}</span></td>
      <td>${campoDesc}</td>
      <td><input class="ln-in ln-num" type="number" min="0" step="0.01" data-i="${i}" data-f="cantidad" value="${l.cantidad ?? ''}"></td>
      <td><select class="ln-in" data-i="${i}" data-f="unidad">${UNIDADES.map((u) => `<option value="${u}" ${u === l.unidad ? 'selected' : ''}>${u}</option>`).join('')}${l.unidad && !UNIDADES.includes(l.unidad) ? `<option value="${esc(l.unidad)}" selected>${esc(l.unidad)}</option>` : ''}</select></td>
      <td><button type="button" class="link" data-ln="quitar" data-i="${i}" title="Quitar línea">✕</button></td>
    </tr>`;
  }

  function pintarLineas() {
    const box = root.querySelector('#lineasCard');
    if (!box || !edit) return;
    const soloDemo = opts.demo ? '<div class="hint" style="margin:0 0 8px">Modo demo: los cambios se ven aquí pero no se guardan en Drive.</div>' : '';
    box.innerHTML = `
      <h2><span class="dot"></span>Materiales del pedido</h2>
      ${soloDemo}
      <div class="hint" style="margin:0 0 8px">Lo que lleva este pedido. Viene de la oferta (se guarda al pasarla a pedido) y se puede corregir: la cantidad real puede diferir de la cotizada. Pon la cantidad en 0 o usa ✕ para quitar una línea.</div>
      ${edit.lineas.length ? `<div class="tablewrap"><table class="tabla-ped ln-tabla">
        <thead><tr><th>Tipo</th><th>Descripción / producto</th><th>Cantidad</th><th>Unidad</th><th></th></tr></thead>
        <tbody>${edit.lineas.map(filaLinea).join('')}</tbody>
      </table></div>` : '<div class="hint">Este pedido todavía no tiene líneas de materiales. Agrégalas abajo.</div>'}
      <div class="btnrow" style="margin-top:10px">
        <select id="lnNuevoTipo" class="ln-in" style="max-width:150px">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <button type="button" class="btn secondary small" data-ln="agregar">+ Agregar línea</button>
        <span style="flex:1"></span>
        <button type="button" class="btn secondary small" data-ln="descartar" ${edit.sucio ? '' : 'disabled'}>Descartar cambios</button>
        <button type="button" class="btn small" data-ln="guardar" ${edit.sucio ? '' : 'disabled'}>Guardar cambios</button>
      </div>
      <div id="bomBox"></div>`;
    pintarBom();
  }

  function pintarBom() {
    const box = root.querySelector('#bomBox');
    if (!box || !edit) return;
    const r = BomEngine.calcularMateriales({ lineas: edit.lineas, recetas: opts.recetas || [], anchos: opts.anchos || {} });
    const hayPorConfirmar = r.materiales.some((m) => m.estado !== 'confirmada');
    const nombres = (m) => m.detalle.map((d) => `${d.producto}: ${fmtN(d.cantidad)}`).join(' · ');
    box.innerHTML = `
      <h3 style="margin:18px 0 6px;font-size:14px">Requerimiento de materiales</h3>
      ${r.materiales.length ? `<div class="tablewrap"><table class="tabla-ped">
        <thead><tr><th>Material</th><th>Cantidad</th><th>Unidad</th><th>Receta</th><th>Aporte por producto</th></tr></thead>
        <tbody>${r.materiales.map((m) => `<tr>
          <td><strong>${esc(m.material)}</strong></td>
          <td class="mono">${fmtN(m.cantidad)}</td>
          <td>${esc(m.unidad)}</td>
          <td>${m.estado === 'confirmada' ? '<span class="pill ok">confirmada</span>' : '<span class="pill amber">por confirmar</span>'}</td>
          <td class="hint" style="font-size:12px">${esc(nombres(m))}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="hint">Todavía no se puede calcular ningún material: faltan recetas con cantidad física para los productos de este pedido.</div>'}
      ${hayPorConfirmar ? '<div class="hint" style="margin-top:6px">⚠ Recetas por confirmar (datos de análisis de costos de 2019–2021): úsalo como orientación, no para comprar hasta que producción las valide.</div>' : ''}
      ${r.sinReceta.length ? `<div class="hint" style="margin-top:6px"><strong>Sin receta:</strong> ${r.sinReceta.map(esc).join(', ')} — no se calculan sus materiales.</div>` : ''}
      ${r.pendientes.length ? `<div class="hint" style="margin-top:6px"><strong>Pendiente de receta:</strong> ${r.pendientes.map((p) => `${esc(p.material)} de ${esc(p.producto)} (${esc(p.motivo)})`).join('; ')}</div>` : ''}
      ${r.accesorios.length ? `<h3 style="margin:14px 0 6px;font-size:14px">Fijaciones, flashings y partidas</h3>
        <div class="tablewrap"><table class="tabla-ped">
          <thead><tr><th>Tipo</th><th>Descripción</th><th>Cantidad</th><th>Unidad</th></tr></thead>
          <tbody>${r.accesorios.map((a) => `<tr>
            <td><span class="pill muted">${esc(TIPOS[a.tipo] || a.tipo)}</span></td>
            <td>${a.codigo ? `<span class="mono">${esc(a.codigo)}</span> ` : ''}${esc(a.descripcion)}</td>
            <td class="mono">${fmtN(a.cantidad)}</td><td>${esc(a.unidad)}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : ''}`;
  }

  function abrirPedido(f) {
    const ref = refDe(f);
    edit = { ref, lineas: copiar(lineasPorRef.get(ref) || []), sucio: false };
    const panel = root.querySelector('#panelPedido');
    panel.innerHTML = detalle(f) + '<div class="card" id="lineasCard" style="margin-top:14px"></div>';
    pintarLineas();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function marcarSucio() {
    edit.sucio = true;
    root.querySelectorAll('[data-ln="guardar"],[data-ln="descartar"]').forEach((b) => (b.disabled = false));
  }

  async function guardar() {
    const btn = root.querySelector('[data-ln="guardar"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      const res = await opts.guardarLineas(edit.ref, edit.lineas);
      const guardadas = (res && res.lineas) || [];
      lineasPorRef.set(edit.ref, guardadas);
      edit.lineas = copiar(guardadas);
      edit.sucio = false;
      pintarLineas();
      toast(res && res.demo ? 'Cambios aplicados (modo demo: no se guardan en Drive).' : 'Líneas de materiales guardadas.');
    } catch (e) {
      toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }
    }
  }

  function mount(container, res, o = {}) {
    root = container;
    opts = o;
    edit = null;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    filas = unificar(res.data);
    lineasPorRef = agrupar(res.data.lineas);
    pintar();
    root.onclick = (e) => {
      const chip = e.target.closest('[data-planta]');
      if (chip) { planta = chip.dataset.planta; edit = null; pintar(); return; }
      const ln = e.target.closest('[data-ln]');
      if (ln && edit) {
        const act = ln.dataset.ln;
        if (act === 'agregar') {
          const tipo = root.querySelector('#lnNuevoTipo').value;
          edit.lineas.push({ pedido_ref: edit.ref, tipo, producto: '', codigo: '', descripcion: '', cantidad: '', unidad: UNIDAD_POR_TIPO[tipo] || 'unid', nota: '' });
          marcarSucio(); pintarLineas();
        } else if (act === 'quitar') {
          edit.lineas.splice(+ln.dataset.i, 1);
          marcarSucio(); pintarLineas();
        } else if (act === 'descartar') {
          edit.lineas = copiar(lineasPorRef.get(edit.ref) || []);
          edit.sucio = false; pintarLineas();
        } else if (act === 'guardar') {
          guardar();
        }
        return;
      }
      const tr = e.target.closest('tr[data-i]');
      if (tr) abrirPedido(filas[+tr.dataset.i]);
    };
    // Edición de una línea: se actualiza la copia de trabajo y solo se recalcula el requerimiento
    // (no se repinta la tabla de líneas, para no perder el foco mientras se escribe).
    const alEditar = (e) => {
      const inp = e.target.closest('.ln-in[data-i]');
      if (!inp || !edit) return;
      const l = edit.lineas[+inp.dataset.i];
      if (!l) return;
      const campo = inp.dataset.f;
      l[campo] = campo === 'cantidad' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      if (campo === 'producto' && l.tipo === 'material') l.descripcion = inp.value;
      marcarSucio();
      pintarBom();
    };
    root.oninput = (e) => {
      if (e.target.id === 'qPedidos') { q = e.target.value; edit = null; pintar(); return; }
      if (e.target.matches('input.ln-in')) alEditar(e);
    };
    root.onchange = (e) => {
      if (e.target.matches('select.ln-in')) alEditar(e);
    };
  }

  return { mount };
})();

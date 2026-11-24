'use strict';
// Partes de producción de paneles — versión digital de la "Hoja de Producción" en papel (la que la
// planta llena y el encargado de revisión pasa a administración). Mismos bloques que el papel:
// cabecera (pedido, producto, proveedor del acero, calibre, colores), bobinas, láminas fabricadas,
// material de segunda, anime, pega, tornillos, capelotes, cumbreras troqueladas, otras láminas/
// flashings, scrap y firmas. Mejoras sobre el papel: los metros, kg usados y totales se calculan
// solos, el scrap distingue arranque de máquina/producción, avisa de incoherencias y compara lo
// consumido con la receta (previsto vs. real).
//
// Se monta dentro de la pestaña Producción. Lógica y guardado: src/shared/partes-core.js.

const Partes = (() => {
  let root, opts = {}, res = null, lista = [];
  let vista = 'lista'; // 'lista' | 'editor' | 'ver'
  let filtro = 'enviado', q = '';
  let ed = null; // { numero, p }
  let selNumero = null;
  let ocupado = false;

  const fmtN = (x, d = 2) => (Number(x) || 0).toLocaleString('es-VE', { maximumFractionDigits: d });
  const hoyIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const errMsg = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  const ESTADO = { enviado: ['Enviado · pendiente de administración', 'amber'], procesado: ['Procesado por administración', 'ok'], anulado: ['Anulado', 'red'] };
  const pillEstado = (e) => `<span class="pill ${(ESTADO[e] || ESTADO.enviado)[1]}">${esc((ESTADO[e] || ESTADO.enviado)[0])}</span>`;

  // Tablas del parte: [clave, título, columnas [campo, etiqueta, tipo, opciones?], cálculo por fila, ayuda]
  const TIPOS_SCRAP = ['Arranque de máquina', 'Producción', 'Otro'];
  const UI = [
    ['bobinas', 'Bobinas utilizadas', [['numero', 'N° bobina', 'text'], ['ancho', 'Ancho (mm)', 'num'], ['pesoInicial', 'Peso inicial (kg)', 'num'], ['pesoFinal', 'Peso final (kg)', 'num']],
      ['Kg usados', (r) => (r.pesoInicial !== '' && r.pesoFinal !== '' && r.pesoInicial != null && r.pesoFinal != null ? n(r.pesoInicial) - n(r.pesoFinal) : null)],
      'El peso final es lo que queda en la bobina (vuelve al almacén). Kg usados = inicial − final.'],
    ['laminas', 'Láminas fabricadas', [['cantidad', 'Cantidad', 'num'], ['largo', 'Largo (m)', 'num']], ['Metros', (r) => n(r.cantidad) * n(r.largo)], ''],
    ['segunda', 'Material de segunda', [['cantidad', 'Cantidad', 'num'], ['largo', 'Largo (m)', 'num']], ['Metros', (r) => n(r.cantidad) * n(r.largo)], ''],
    ['anime', 'Anime (láminas de poliestireno)', [['cantidad', 'Cantidad', 'num'], ['largo', 'Largo (m)', 'num']], ['Metros', (r) => n(r.cantidad) * n(r.largo)], 'Largo en metros (en el papel se anota en cm: 300 = 3,00 m).'],
    ['tornillos', 'Tornillos', [['tipo', 'Tipo (p. ej. 14 x 2 1/2)', 'text'], ['cantidad', 'Cantidad', 'num']], null, ''],
    ['capelotes', 'Capelotes', [['descripcion', 'Descripción (opcional)', 'text'], ['cantidad', 'Cantidad', 'num']], null, ''],
    ['cumbreras', 'Cumbreras troqueladas', [['descripcion', 'Descripción (opcional)', 'text'], ['cantidad', 'Cantidad', 'num']], null, ''],
    ['flashings', 'Otras láminas / flashings', [['descripcion', 'Descripción', 'text'], ['cantidad', 'Cantidad', 'num'], ['largo', 'Largo (m)', 'num'], ['ancho', 'Ancho (mm)', 'num']], ['Metros', (r) => n(r.cantidad) * n(r.largo)], ''],
    ['scrap', 'Reporte de scrap', [['tipo', 'Tipo', 'select', TIPOS_SCRAP], ['ancho', 'Ancho (mm)', 'num'], ['kg', 'Kg', 'num'], ['metros', 'Metros', 'num']], null, 'Distingue el scrap de arranque de máquina del de producción.'],
  ];
  const CAB = [
    ['hojaPapel', 'N° de hoja en papel', 'text', 'p. ej. 000024'],
    ['pedido', 'Pedido', 'pedido', 'p. ej. P-358'],
    ['fecha', 'Fecha de producción', 'date'],
    ['cliente', 'Obra o cliente', 'text'],
    ['producto', 'Producto', 'producto'],
    ['proveedorAcero', 'Material (proveedor del acero)', 'proveedor'],
    ['calibre', 'Calibre (mm)', 'text', 'p. ej. 0,45'],
    ['colorSup', 'Color superior (RAL)', 'text', 'p. ej. Blanco'],
    ['colorInf', 'Color inferior (RAL)', 'text', 'p. ej. Blanco'],
  ];
  const FIRMAS = [['supervisor', 'Supervisor'], ['operador', 'Operador'], ['revisadoPor', 'Revisado por (envía a administración)']];

  const vacio = () => ({ hojaPapel: '', pedido: '', fecha: hoyIso(), cliente: '', producto: '', proveedorAcero: '', calibre: '', colorSup: '', colorInf: '',
    bobinas: [{}, {}], laminas: [{}, {}, {}], segunda: [], anime: [{}], poliolKg: '', isocianatoKg: '', tornillos: [{}], capelotes: [], cumbreras: [], flashings: [], scrap: [],
    supervisor: '', operador: '', revisadoPor: '', observaciones: '' });

  // ---------- Lista ----------
  function visibles() {
    const t = q.trim().toLowerCase();
    return lista.filter((x) => (filtro === 'todos' || x.estado === filtro) && (!t || [x.numero, x.parte.pedido, x.parte.cliente, x.parte.producto, x.parte.hojaPapel].some((v) => String(v || '').toLowerCase().includes(t))));
  }

  function pintarLista() {
    const v = visibles();
    const nPend = lista.filter((x) => x.estado === 'enviado').length;
    root.innerHTML = `
      <div class="toolbar-ped">
        <div class="chips-ped">
          ${[['enviado', `Pendientes de administración (${nPend})`], ['procesado', 'Procesados'], ['anulado', 'Anulados'], ['todos', 'Todos']].map(([k, t]) => `<button type="button" class="chip-ped" data-pf="${k}" aria-pressed="${k === filtro}">${t}</button>`).join('')}
        </div>
        <input class="search-ped" type="search" id="qPartes" placeholder="Buscar pedido, cliente, N° de parte" value="${esc(q)}">
        <button type="button" class="btn small" data-pa="nuevo">＋ Nuevo parte de producción</button>
      </div>
      ${opts.demo ? '<div class="hint" style="margin-bottom:8px">Modo demo: los partes se ven y se pueden crear, pero no se guardan en Drive.</div>' : ''}
      <div class="card" style="padding:0;overflow:auto">${v.length ? `<table class="tabla-ped ped-tabla partes-tabla">
        <thead><tr><th>N° parte</th><th>Fecha</th><th>Pedido</th><th>Cliente / producto</th><th class="r">Metros</th><th class="r">Kg acero</th><th class="r">Kg/ml</th><th>Estado</th></tr></thead>
        <tbody>${v.map((x) => `<tr data-pn="${esc(x.numero)}">
          <td class="mono">${esc(x.numero)}${x.parte.hojaPapel ? `<div class="ofe-sub">papel ${esc(x.parte.hojaPapel)}</div>` : ''}</td>
          <td>${esc(fmtFecha(x.parte.fecha))}</td>
          <td class="mono">${esc(x.parte.pedido)}</td>
          <td><strong>${esc(x.parte.cliente || '—')}</strong><div class="ofe-sub">${esc(x.parte.producto)}</div></td>
          <td class="r">${fmtN(x.totales.ml)}</td>
          <td class="r">${fmtN(x.totales.kgAcero)}</td>
          <td class="r">${x.totales.kgPorMl ? fmtN(x.totales.kgPorMl) : '—'}</td>
          <td>${pillEstado(x.estado)}</td>
        </tr>`).join('')}</tbody></table>`
        : `<div class="empty-state" style="margin:30px auto"><b>${lista.length ? 'Sin partes con ese filtro' : 'Todavía no hay partes de producción'}</b><p>${lista.length ? 'Prueba con otro filtro.' : 'El encargado de revisión los registra con “＋ Nuevo parte de producción” (o desde el pedido, en la pestaña Pedidos) y administración los ve aquí.'}</p></div>`}</div>`;
  }

  // ---------- Tablas (editables o de solo lectura) ----------
  function celdaInput(t, i, [k, , tipo, ops], val) {
    if (tipo === 'select') return `<select class="ln-in" data-t="${t}" data-i="${i}" data-k="${k}"><option value=""></option>${ops.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}${val && !ops.includes(val) ? `<option selected>${esc(val)}</option>` : ''}</select>`;
    return `<input class="ln-in ${tipo === 'num' ? 'ln-num' : ''}" ${tipo === 'num' ? 'type="number" min="0" step="any" inputmode="decimal"' : 'type="text" maxlength="120"'} data-t="${t}" data-i="${i}" data-k="${k}" value="${esc(val ?? '')}">`;
  }

  function tablaHtml([t, titulo, cols, calc, ayuda], p, editable) {
    const filas = p[t] || [];
    if (!editable && !filas.length) return '';
    const totalCalc = calc ? filas.reduce((a, r) => a + (calc[1](r) || 0), 0) : 0;
    return `<div class="parte-bloque">
      <h3 class="ped-h3">${esc(titulo)}</h3>
      ${editable && ayuda ? `<div class="hint" style="margin:-4px 0 6px">${esc(ayuda)}</div>` : ''}
      <div class="tablewrap"><table class="tabla-ped parte-tabla">
        <thead><tr>${cols.map((c) => `<th class="${c[2] === 'num' ? 'r' : ''}">${esc(c[1])}</th>`).join('')}${calc ? `<th class="r">${esc(calc[0])}</th>` : ''}${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${filas.map((r, i) => `<tr>
          ${cols.map((c) => (editable ? `<td>${celdaInput(t, i, c, r[c[0]])}</td>` : `<td class="${c[2] === 'num' ? 'r mono' : ''}">${c[2] === 'num' ? (r[c[0]] === '' || r[c[0]] == null ? '' : fmtN(r[c[0]])) : esc(r[c[0]] || '')}</td>`)).join('')}
          ${calc ? `<td class="r mono" data-calc="${t}-${i}">${calc[1](r) == null ? '—' : fmtN(calc[1](r))}</td>` : ''}
          ${editable ? `<td><button type="button" class="link" data-pa="quitar" data-t="${t}" data-i="${i}" title="Quitar fila">✕</button></td>` : ''}
        </tr>`).join('')}</tbody>
        ${calc && filas.length > 1 ? `<tfoot><tr><td colspan="${cols.length}" class="r"><b>Total</b></td><td class="r mono" data-calc="${t}-total"><b>${fmtN(totalCalc)}</b></td>${editable ? '<td></td>' : ''}</tr></tfoot>` : ''}
      </table></div>
      ${editable ? `<button type="button" class="btn secondary small" data-pa="fila" data-t="${t}">+ Fila</button>` : ''}
    </div>`;
  }

  // ---------- Resumen y previsto vs. real ----------
  function resumenHtml(p) {
    const t = PartesCore.calcular(p);
    const anchos = Object.entries(t.kgPorAncho).map(([a, kg]) => `${esc(a)} mm: <b>${fmtN(kg)} kg</b>`).join(' · ') || '—';
    const c = PartesCore.compararConReceta(p, opts.recetas || []);
    const cls = (d) => (d == null ? '' : Math.abs(d) <= 10 ? 'ok' : Math.abs(d) <= 25 ? 'amber' : 'red');
    return `<div class="parte-totales">
        <div><span>Metros producidos</span><b>${fmtN(t.ml)} ml</b><small>${fmtN(t.laminas, 0)} láminas</small></div>
        <div><span>Acero usado</span><b>${fmtN(t.kgAcero)} kg</b><small>${t.kgPorMl ? fmtN(t.kgPorMl) + ' kg/ml' : '—'}</small></div>
        <div><span>Anime</span><b>${fmtN(t.animeLaminas, 0)} lám.</b><small>${fmtN(t.animeM)} m</small></div>
        <div><span>Pega (poliol + isoc.)</span><b>${fmtN(t.poliolKg + t.isocianatoKg)} kg</b><small>${fmtN(t.poliolKg)} + ${fmtN(t.isocianatoKg)}</small></div>
        <div><span>Scrap</span><b>${fmtN(t.scrapKg)} kg</b><small>arranque ${fmtN(t.scrapArranqueKg)} kg</small></div>
        <div><span>Material de segunda</span><b>${fmtN(t.mlSegunda)} ml</b><small>tornillos ${fmtN(t.tornillos, 0)}</small></div>
      </div>
      <div class="hint" style="margin-top:6px">Kg usados por ancho de bobina: ${anchos}</div>
      ${t.avisos.length ? `<div class="ped-aviso">${t.avisos.map(esc).join('<br>')}</div>` : ''}
      <h3 class="ped-h3">Previsto (receta) vs. real</h3>
      ${c.filas.length ? `<div class="tablewrap"><table class="tabla-ped parte-tabla">
        <thead><tr><th>Material</th><th class="r">Previsto para ${fmtN(c.ml)} ml</th><th class="r">Real</th><th class="r">Diferencia</th><th class="r">Receta / ml</th><th class="r">Real / ml</th></tr></thead>
        <tbody>${c.filas.map((f) => `<tr><td>${esc(f.material)}</td><td class="r mono">${fmtN(f.previsto)} ${esc(f.unidad)}</td><td class="r mono">${fmtN(f.real)} ${esc(f.unidad)}</td>
          <td class="r">${f.dif == null ? '—' : `<span class="pill ${cls(f.dif)}">${f.dif > 0 ? '+' : ''}${f.dif}%</span>`}</td><td class="r mono">${fmtN(f.previstoPorMl, 3)}</td><td class="r mono">${fmtN(f.realPorMl, 3)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${c.porConfirmar ? '<div class="hint" style="margin-top:4px">Receta por confirmar: la diferencia es orientativa. Con varios partes del mismo producto se puede ajustar la receta con datos reales.</div>' : ''}`
      : `<div class="hint">${esc(c.motivo || 'Sin datos para comparar.')}</div>`}`;
  }

  // ---------- Editor ----------
  function campoCab([k, l, tipo, ph], p) {
    const v = p[k] ?? '';
    let input;
    if (tipo === 'date') input = `<input class="ln-in" type="date" data-h="${k}" value="${esc(v)}">`;
    else if (tipo === 'producto') {
      const prods = opts.productos || [];
      input = `<select class="ln-in" data-h="${k}"><option value="">— elige —</option>${v && !prods.includes(v) ? `<option selected>${esc(v)}</option>` : ''}${prods.map((x) => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    } else if (tipo === 'proveedor') input = `<input class="ln-in" type="text" list="listaProveedores" data-h="${k}" value="${esc(v)}" placeholder="Acesco, Corpacero, Rogo, Arme…" maxlength="60">`;
    else if (tipo === 'pedido') input = `<input class="ln-in" type="text" list="listaPedidosPartes" data-h="${k}" value="${esc(v)}" placeholder="${esc(ph || '')}" maxlength="40" style="text-transform:uppercase">`;
    else input = `<input class="ln-in" type="text" data-h="${k}" value="${esc(v)}" placeholder="${esc(ph || '')}" maxlength="120">`;
    return `<div><label>${esc(l)}</label>${input}</div>`;
  }

  function pintarEditor() {
    const p = ed.p;
    const pedidos = opts.pedidos || [];
    root.innerHTML = `<div class="card parte-card">
      <div class="ped-panel-head">
        <h2 style="margin:0"><span class="dot"></span>${ed.numero ? `Editar parte N° ${esc(ed.numero)}` : 'Nuevo parte de producción — Paneles'}</h2>
        <button type="button" class="btn secondary small" data-pa="cancelar">← Volver sin guardar</button>
      </div>
      <div class="hint" style="margin:4px 0 12px">Copia de la Hoja de Producción en papel. Lo envía el encargado de revisión; administración y facturación lo ven en esta pestaña y en la hoja de Drive. Los metros, kg y totales se calculan solos.</div>
      <datalist id="listaProveedores">${(PartesCore.PROVEEDORES_ACERO || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="listaPedidosPartes">${pedidos.map((x) => `<option value="${esc(x.codigo)}">${esc(x.cliente || '')}</option>`).join('')}</datalist>
      <div class="parte-cab">${CAB.map((c) => campoCab(c, p)).join('')}</div>
      ${UI.slice(0, 4).map((u) => tablaHtml(u, p, true)).join('')}
      <div class="parte-bloque"><h3 class="ped-h3">Pega</h3>
        <div class="parte-cab parte-cab-2">
          <div><label>Poliol (kg)</label><input class="ln-in ln-num" type="number" min="0" step="any" data-h="poliolKg" value="${esc(p.poliolKg ?? '')}"></div>
          <div><label>Isocianato (kg)</label><input class="ln-in ln-num" type="number" min="0" step="any" data-h="isocianatoKg" value="${esc(p.isocianatoKg ?? '')}"></div>
        </div></div>
      <div class="parte-col2">${UI.slice(4, 7).map((u) => tablaHtml(u, p, true)).join('')}</div>
      ${UI.slice(7).map((u) => tablaHtml(u, p, true)).join('')}
      <div class="parte-bloque"><h3 class="ped-h3">Firmas y observaciones</h3>
        <div class="parte-cab">${FIRMAS.map(([k, l]) => `<div><label>${esc(l)}</label><input class="ln-in" type="text" maxlength="120" data-h="${k}" value="${esc(p[k] || '')}"></div>`).join('')}</div>
        <label style="margin-top:8px">Observaciones</label><textarea class="ln-in" rows="2" maxlength="2000" data-h="observaciones">${esc(p.observaciones || '')}</textarea>
      </div>
      <div class="parte-bloque" id="parteResumen">${resumenHtml(p)}</div>
      <div class="btnrow" style="margin-top:14px"><span style="flex:1"></span>
        <button type="button" class="btn secondary" data-pa="cancelar">Cancelar</button>
        <button type="button" class="btn" data-pa="guardar" ${ocupado ? 'disabled' : ''}>${ocupado ? 'Guardando…' : ed.numero ? 'Guardar cambios' : 'Guardar y enviar a administración'}</button>
      </div>
    </div>`;
  }

  function refrescarCalculos(t, i) {
    const u = UI.find((x) => x[0] === t);
    if (u && u[3]) {
      const celda = root.querySelector(`[data-calc="${t}-${i}"]`);
      const v = u[3][1](ed.p[t][i]);
      if (celda) celda.textContent = v == null ? '—' : fmtN(v);
      const tot = root.querySelector(`[data-calc="${t}-total"]`);
      if (tot) tot.innerHTML = `<b>${fmtN(ed.p[t].reduce((a, r) => a + (u[3][1](r) || 0), 0))}</b>`;
    }
    const box = root.querySelector('#parteResumen');
    if (box) box.innerHTML = resumenHtml(ed.p);
  }

  // Al escribir un pedido conocido se completan cliente, producto y la ficha (colores, calibre,
  // proveedor) que estén vacíos — nunca se pisa lo que ya escribió la persona.
  function completarDesdePedido() {
    const cod = String(ed.p.pedido || '').trim().toUpperCase();
    const x = (opts.pedidos || []).find((y) => String(y.codigo).toUpperCase() === cod);
    if (!x) return false;
    let cambio = false;
    for (const [k, v] of Object.entries({ cliente: x.cliente, producto: x.producto, colorSup: x.colorSup, colorInf: x.colorInf, calibre: x.calibre, proveedorAcero: x.proveedorAcero })) {
      if (v && !ed.p[k]) { ed.p[k] = v; cambio = true; }
    }
    return cambio;
  }

  async function guardar() {
    if (ocupado) return;
    ocupado = true;
    const boton = root.querySelector('[data-pa="guardar"]');
    if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
    try {
      const r = await opts.guardar(ed.p, ed.numero || '');
      toast(r && r.demo ? `Demo: parte N° ${r.numero} ${r.actualizado ? 'actualizado' : 'creado'} (no se guarda en Drive).` : r.actualizado ? `Parte N° ${r.numero} actualizado.` : `Parte N° ${r.numero} enviado a administración.`);
      ocupado = false;
      selNumero = r.numero;
      await recargar();
      vista = 'ver';
      pintar();
    } catch (e) {
      ocupado = false;
      toast(errMsg(e), 'error');
      if (boton) { boton.disabled = false; boton.textContent = ed.numero ? 'Guardar cambios' : 'Guardar y enviar a administración'; }
    }
  }

  // ---------- Vista (solo lectura) ----------
  function pintarVer() {
    const x = lista.find((y) => y.numero === selNumero);
    if (!x) { vista = 'lista'; pintarLista(); return; }
    const p = x.parte;
    const dato = (l, v) => `<div><span class="l">${esc(l)}:</span>${esc(v || '—')}</div>`;
    root.innerHTML = `<div class="card parte-card">
      <div class="ped-panel-head">
        <h2 style="margin:0"><span class="dot"></span>Parte de producción N° ${esc(x.numero)}</h2>
        <div class="btnrow" style="margin:0">
          <button type="button" class="btn secondary small" data-pa="lista">← Lista</button>
          <button type="button" class="btn secondary small" data-pa="pdf">📄 PDF</button>
          ${x.estado === 'enviado' ? '<button type="button" class="btn secondary small" data-pa="editar">✎ Editar</button>' : ''}
        </div>
      </div>
      <div style="margin:8px 0">${pillEstado(x.estado)} <span class="hint">Enviado ${esc(fmtFechaHora(x.enviadoEn))}${x.enviadoPor ? ' por ' + esc(x.enviadoPor) : ''}${x.estado === 'procesado' ? ` · procesado ${esc(fmtFechaHora(x.procesadoEn))}${x.procesadoPor ? ' por ' + esc(x.procesadoPor) : ''}` : ''}</span></div>
      ${x.detalleDanado ? '<div class="ped-aviso">El detalle de este parte está dañado en la hoja (alguien editó la columna detalle_json): solo se muestran los datos de cabecera.</div>' : ''}
      <div class="doc-info ped-info">
        ${dato('Pedido', p.pedido)}${dato('Fecha', fmtFecha(p.fecha))}${dato('Obra o cliente', p.cliente)}${dato('Producto', p.producto)}
        ${dato('Material (proveedor)', p.proveedorAcero)}${dato('Calibre', p.calibre)}${dato('Color superior', p.colorSup)}${dato('Color inferior', p.colorInf)}
        ${dato('N° hoja en papel', p.hojaPapel)}
      </div>
      ${UI.slice(0, 4).map((u) => tablaHtml(u, p, false)).join('')}
      ${p.poliolKg !== '' || p.isocianatoKg !== '' ? `<div class="parte-bloque"><h3 class="ped-h3">Pega</h3><div class="hint" style="font-size:13px">Poliol: <b>${fmtN(p.poliolKg)} kg</b> · Isocianato: <b>${fmtN(p.isocianatoKg)} kg</b></div></div>` : ''}
      <div class="parte-col2">${UI.slice(4, 7).map((u) => tablaHtml(u, p, false)).join('')}</div>
      ${UI.slice(7).map((u) => tablaHtml(u, p, false)).join('')}
      <div class="doc-info ped-info" style="margin-top:10px">${FIRMAS.map(([k, l]) => dato(l.replace(/ \(.*\)$/, ''), p[k])).join('')}</div>
      ${p.observaciones ? `<div class="hint" style="margin-top:6px"><b>Observaciones:</b> ${esc(p.observaciones)}</div>` : ''}
      <div class="parte-bloque">${resumenHtml(p)}</div>
      <div class="btnrow" style="margin-top:14px">
        ${x.estado === 'enviado' ? '<button type="button" class="btn secondary small" data-pa="anular">Anular parte</button>' : ''}
        <span style="flex:1"></span>
        ${x.estado === 'enviado' ? '<button type="button" class="btn" data-pa="procesar">✔ Marcar como procesado por administración</button>' : ''}
        ${x.estado === 'procesado' ? '<button type="button" class="btn secondary small" data-pa="desprocesar">Desmarcar procesado</button>' : ''}
        ${x.estado === 'anulado' ? '<button type="button" class="btn secondary small" data-pa="desprocesar">Reactivar parte</button>' : ''}
      </div>
    </div>`;
  }

  async function cambiarEstado(estado, msg) {
    if (ocupado) return;
    ocupado = true;
    try {
      await opts.estado(selNumero, estado);
      toast(msg);
      ocupado = false;
      await recargar();
      pintar();
    } catch (e) {
      ocupado = false;
      toast(errMsg(e), 'error');
    }
  }

  // ---------- PDF (copia del parte, mismo orden que la hoja en papel) ----------
  function docImpresion(x) {
    const p = x.parte;
    const t = PartesCore.calcular(p);
    const emp = opts.empresa || {};
    const dato = (l, v) => (v ? `<div><span>${esc(l)}:</span> ${esc(v)}</div>` : '');
    const tabla = (u) => {
      const [k, titulo, cols, calc] = u;
      const filas = p[k] || [];
      if (!filas.length) return '';
      return `<h3>${esc(titulo)}</h3><table><thead><tr>${cols.map((c) => `<th class="${c[2] === 'num' ? 'r' : ''}">${esc(c[1])}</th>`).join('')}${calc ? `<th class="r">${esc(calc[0])}</th>` : ''}</tr></thead>
        <tbody>${filas.map((r) => `<tr>${cols.map((c) => `<td class="${c[2] === 'num' ? 'r' : ''}">${c[2] === 'num' ? (r[c[0]] === '' ? '' : fmtN(r[c[0]])) : esc(r[c[0]] || '')}</td>`).join('')}${calc ? `<td class="r">${calc[1](r) == null ? '—' : fmtN(calc[1](r))}</td>` : ''}</tr>`).join('')}</tbody></table>`;
    };
    return `<div class="ped-doc">
      <div class="ped-doc-head">
        <div class="ped-doc-logo"><img src="${esc(opts.logoSrc || '')}" alt="Grupo Centrolit"></div>
        <div class="ped-doc-titulo"><div class="t">Hoja de producción — Paneles</div><div class="s">Parte para administración</div></div>
        <div class="ped-doc-meta"><div><b>N° parte:</b> ${esc(x.numero)}</div>${p.hojaPapel ? `<div><b>N° hoja papel:</b> ${esc(p.hojaPapel)}</div>` : ''}<div><b>Fecha:</b> ${esc(fmtFecha(p.fecha))}</div></div>
      </div>
      <div class="ped-doc-info">
        ${dato('Pedido', p.pedido)}${dato('Obra o cliente', p.cliente)}${dato('Producto', p.producto)}${dato('Material', p.proveedorAcero)}
        ${dato('Calibre', p.calibre)}${dato('Color superior', p.colorSup)}${dato('Color inferior', p.colorInf)}
      </div>
      ${UI.slice(0, 4).map(tabla).join('')}
      <h3>Totales</h3>
      <table><tbody>
        <tr><td>Total metros</td><td class="r"><b>${fmtN(t.ml)} ml</b> (${fmtN(t.laminas, 0)} láminas)</td><td>Kg usados por ancho</td><td class="r">${Object.entries(t.kgPorAncho).map(([a, kg]) => `${esc(a)}: ${fmtN(kg)}`).join(' · ') || '—'}</td></tr>
        <tr><td>Total acero</td><td class="r"><b>${fmtN(t.kgAcero)} kg</b>${t.kgPorMl ? ` (${fmtN(t.kgPorMl)} kg/ml)` : ''}</td><td>Pega</td><td class="r">Poliol ${fmtN(t.poliolKg)} kg · Isocianato ${fmtN(t.isocianatoKg)} kg</td></tr>
        <tr><td>Anime</td><td class="r">${fmtN(t.animeLaminas, 0)} lám. · ${fmtN(t.animeM)} m</td><td>Scrap</td><td class="r">${fmtN(t.scrapKg)} kg</td></tr>
      </tbody></table>
      ${UI.slice(4).map(tabla).join('')}
      ${p.observaciones ? `<h3>Observaciones</h3><p class="obs">${esc(p.observaciones).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="ped-doc-firmas ped-doc-firmas-3"><div>Supervisor${p.supervisor ? `<br><b>${esc(p.supervisor)}</b>` : ''}</div><div>Operador${p.operador ? `<br><b>${esc(p.operador)}</b>` : ''}</div><div>Revisado por${p.revisadoPor ? `<br><b>${esc(p.revisadoPor)}</b>` : ''}</div></div>
      <div class="ped-doc-pie">${esc(emp.nombre || 'Grupo Centrolit')}${emp.rif ? ' · RIF ' + esc(emp.rif) : ''} — Parte N° ${esc(x.numero)} · ${esc(ESTADO[x.estado] ? ESTADO[x.estado][0] : '')}</div>
    </div>`;
  }

  async function imprimir() {
    const x = lista.find((y) => y.numero === selNumero);
    if (!x || !opts.imprimir) return;
    const host = document.createElement('div');
    host.id = 'docPedidoPrint';
    host.innerHTML = docImpresion(x);
    document.body.appendChild(host);
    document.body.classList.add('imprimiendo-pedido');
    try {
      await Promise.all(Array.from(host.querySelectorAll('img')).map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
      await new Promise((r) => setTimeout(r, 150));
      const r = await opts.imprimir(('Parte_' + x.numero + '_' + x.parte.pedido).replace(/[^\w\-]+/g, '_'));
      if (r && r.saved) toast('PDF guardado.');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      document.body.classList.remove('imprimiendo-pedido');
      host.remove();
    }
  }

  // ---------- Eventos ----------
  function pintar() {
    if (!res || !res.ok) { root.innerHTML = bloqueError(res || {}, true); return; }
    if (vista === 'editor' && ed) pintarEditor();
    else if (vista === 'ver') pintarVer();
    else pintarLista();
  }

  async function recargar() {
    if (!opts.recargar) return;
    const r = await opts.recargar();
    if (r) { res = r; lista = r.ok ? r.data : []; }
  }

  function alClick(e) {
    const pf = e.target.closest('[data-pf]');
    if (pf) { filtro = pf.dataset.pf; pintarLista(); return; }
    const fila = e.target.closest('tr[data-pn]');
    if (fila) { selNumero = fila.dataset.pn; vista = 'ver'; pintar(); return; }
    const b = e.target.closest('[data-pa]');
    if (!b) return;
    const a = b.dataset.pa;
    if (a === 'nuevo') return nuevo({});
    if (a === 'lista' || a === 'cancelar') { vista = selNumero && a === 'cancelar' && ed && ed.numero ? 'ver' : 'lista'; ed = null; pintar(); return; }
    if (a === 'fila') { (ed.p[b.dataset.t] = ed.p[b.dataset.t] || []).push({}); pintarEditor(); return; }
    if (a === 'quitar') { ed.p[b.dataset.t].splice(+b.dataset.i, 1); pintarEditor(); return; }
    if (a === 'guardar') return guardar();
    if (a === 'pdf') return imprimir();
    if (a === 'editar') {
      const x = lista.find((y) => y.numero === selNumero);
      const p = JSON.parse(JSON.stringify(x.parte));
      for (const [k] of UI) if (!Array.isArray(p[k])) p[k] = [];
      ed = { numero: x.numero, p };
      vista = 'editor';
      pintar();
      return;
    }
    if (a === 'procesar') return cambiarEstado('procesado', 'Parte marcado como procesado por administración.');
    if (a === 'desprocesar') return cambiarEstado('enviado', 'El parte vuelve a estar pendiente de administración.');
    if (a === 'anular') { if (confirm('¿Anular este parte? Queda en la hoja marcado como anulado (no se borra).')) cambiarEstado('anulado', 'Parte anulado.'); }
  }

  function alEscribir(e) {
    const el = e.target;
    if (el.id === 'qPartes') { q = el.value; const box = root.querySelector('.card'); pintarLista(); const qi = root.querySelector('#qPartes'); if (qi) { qi.focus(); qi.setSelectionRange(q.length, q.length); } return box; }
    if (!ed) return;
    if (el.dataset.h) {
      const k = el.dataset.h;
      ed.p[k] = k === 'pedido' ? el.value.toUpperCase() : el.value;
      if (k === 'pedido' && e.type === 'change' && completarDesdePedido()) { pintarEditor(); return; }
      refrescarCalculos();
      return;
    }
    if (el.dataset.t) {
      const fila = ed.p[el.dataset.t][+el.dataset.i];
      fila[el.dataset.k] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
      refrescarCalculos(el.dataset.t, +el.dataset.i);
    }
  }

  // ---------- API pública ----------
  function mount(container, r, o = {}) {
    root = container;
    opts = o;
    res = r;
    lista = r && r.ok ? r.data : [];
    if (vista === 'ver' && !lista.some((x) => x.numero === selNumero)) vista = 'lista';
    if (vista === 'editor' && !ed) vista = 'lista';
    pintar();
    root.onclick = alClick;
    root.oninput = (e) => { if (e.target.matches('input:not([type=date]), textarea')) alEscribir(e); };
    root.onchange = (e) => { if (e.target.matches('select, input')) alEscribir(e); };
  }

  // Abre un parte nuevo, opcionalmente con datos del pedido (pedido, cliente, producto, ficha técnica).
  function nuevo(prefill = {}) {
    ed = { numero: null, p: { ...vacio(), ...Object.fromEntries(Object.entries(prefill).filter(([, v]) => v)) } };
    vista = 'editor';
    pintar();
    root.scrollIntoView({ block: 'start' });
  }

  function ver(numero) {
    selNumero = numero;
    vista = 'ver';
    pintar();
  }

  return { mount, nuevo, ver };
})();

'use strict';
// Calculadora de láminas/correas y flashings — réplica de la pestaña real "Calculo SSA", ampliada
// con la 2ª ronda de feedback real del equipo comercial:
//   1) el tipo de lámina elegida (Standing Seam o Panel, del mismo catálogo que el Cotizador)
//      decide el ancho útil con el que se cuenta la cantidad de láminas.
//   2) Cant. láminas = ceil(fondo ÷ ancho útil) — ya no es manual.
//   3) Tornillos/clips = Cant. láminas × Correas × un múltiplo por cruce (AJUSTABLE: el equipo no
//      dio un número único todavía).
//   4) Cálculo de flashings aparte: piezas = ceil(longitud ÷ largo útil) y tornillos = piezas × un
//      múltiplo por pieza (ambos AJUSTABLES — largo útil 2,30 m dado por el equipo, distinto del
//      pieza_remate_m=2,40 que ya usa el Cotizador para remates estimados; no se unificaron).
// Herramienta aparte del Cotizador a propósito: se pueden usar ambas y comparar resultados.

const Calculadora = (() => {
  let root, onEnviar, cat = { categorias: {}, flashings: [] };
  let filasLam = [];
  let filasFlash = [];
  let params = { clipsPorCruce: 1, largoUtilFlashing: 2.3, tornillosPorFlashing: 4 };

  const rnd = () => Math.random().toString(36).slice(2, 8);

  function productosPlanos() {
    const out = [];
    for (const [catN, arr] of Object.entries(cat.categorias)) {
      arr.forEach((p, i) => out.push({ value: catN + '||' + i, label: catN + ' — ' + p.n, anchoFisico: p.anchoFisico ?? p.ancho ?? 0 }));
    }
    return out;
  }
  function productoPorValor(v) {
    const [catN, i] = String(v || '').split('||');
    return cat.categorias[catN] && cat.categorias[catN][+i];
  }
  function anchoFisicoDe(v) {
    const p = productoPorValor(v);
    return p ? (p.anchoFisico ?? p.ancho ?? 0) : 0;
  }
  // Distinto de anchoFisicoDe(): esto es el ancho útil REAL de precio (ancho_util), el mismo que
  // usa la lista de precios para dividir US$/ml → US$/m². Solo lo tienen los paneles (TP3/TP4/
  // SP50/Maxipanel/R-97...); Standing Seam no, aunque sí tenga un ancho físico para contar láminas.
  function anchoUtilPrecioDe(v) {
    const p = productoPorValor(v);
    return p ? (p.ancho || 0) : 0;
  }

  function nuevaFilaLam() {
    const pv = productosPlanos()[0]?.value || '';
    return { id: 'l' + rnd(), nombre: '', pv, largoLam: 0, fondo: 0, correas: 0 };
  }
  function nuevaFilaFlash() {
    return { id: 'f' + rnd(), nombre: '', fi: 0, longitud: 0 };
  }

  function calcularLam() {
    const entrada = filasLam.map((f) => ({ ...f, anchoUtil: anchoFisicoDe(f.pv), anchoUtilPrecio: anchoUtilPrecioDe(f.pv) }));
    return CotizadorEngine.calcularLaminas(entrada, { clipsPorCruce: params.clipsPorCruce });
  }
  function calcularFlash() {
    return CotizadorEngine.calcularFlashings(filasFlash, { largoUtilPieza: params.largoUtilFlashing, tornillosPorPieza: params.tornillosPorFlashing });
  }

  function pintar() {
    const rl = calcularLam();
    const rf = calcularFlash();
    const totalTornillos = rl.totalTornillos + rf.totalTornillos;
    root.innerHTML = `<div class="narrow">
      <div class="card">
        <h2><span class="dot"></span>Láminas y correas</h2>
        <div class="hint">Elige el tipo de lámina: su ancho útil decide la cantidad de láminas automáticamente (fórmula real confirmada por el equipo). Standing Seam calcula por m², Paneles por ml — ya viene del mismo catálogo del Cotizador.</div>
        <div id="lamLista"></div>
      </div>
      <div class="card">
        <h2><span class="dot"></span>Flashings</h2>
        <div class="hint">Cantidad de piezas = longitud total ÷ largo útil por pieza. Tornillos/remaches = piezas × un múltiplo ajustable.</div>
        <div id="flashLista"></div>
      </div>
      <div class="card">
        <h2><span class="dot"></span>Parámetros ajustables</h2>
        <div class="hint">El equipo no confirmó un valor único para estos tres — ajústalos según el caso; por defecto quedan en lo más conservador que se pudo inferir. Si cambian, se recalcula todo.</div>
        <div class="row2">
          <div><label>Clips/tornillos por cruce lámina×correa</label><input type="number" id="pClips" min="0" step="1" value="${params.clipsPorCruce}"></div>
          <div><label>Largo útil por pieza de flashing (m)</label><input type="number" id="pLargoFlash" min="0.01" step="0.01" value="${params.largoUtilFlashing}"></div>
        </div>
        <label>Tornillos/remaches por pieza de flashing</label><input type="number" id="pTornFlash" min="0" step="1" value="${params.tornillosPorFlashing}">
      </div>
      <div class="card">
        <h2><span class="dot"></span>Totales</h2>
        <dl class="kv" id="calcTotales">
          <dt>Total m² (láminas)</dt><dd id="outTotalM2">${fmt(rl.totalM2)} m²</dd>
          <dt>Total metros lineales (paneles)</dt><dd id="outTotalMl">${fmt(rl.totalMl)} ml</dd>
          <dt>Total láminas</dt><dd id="outTotalLam">${rl.totalLam.toLocaleString('es-VE')}</dd>
          <dt>Total piezas de flashing</dt><dd id="outTotalPiezas">${rf.totalPiezas.toLocaleString('es-VE')}</dd>
          <dt>Total tornillos (láminas + flashings)</dt><dd id="outTotalTornillos">${totalTornillos.toLocaleString('es-VE')}</dd>
        </dl>
        <div class="btnrow" style="margin-top:12px"><button class="btn" id="enviarCotizador">→ Enviar al Cotizador</button></div>
        <div class="hint">Lleva el área al Cotizador en el modo correcto según el tipo de lámina (ml para paneles, m² para Standing Seam), los tornillos a su "Cantidad manual" y los flashings al modo "Detallado" — úsalo para comparar contra lo que el Cotizador calcula por su cuenta.</div>
      </div>
    </div>`;
    pintarLam();
    pintarFlash();
  }

  function pintarLam() {
    const cont = root.querySelector('#lamLista');
    if (!cont) return;
    const opciones = productosPlanos();
    cont.innerHTML = filasLam.map((f, idx) => {
      const anchoUtil = anchoFisicoDe(f.pv);
      const cantLam = anchoUtil > 0 ? Math.ceil((parseFloat(f.fondo) || 0) / anchoUtil) : 0;
      const m2 = (parseFloat(f.largoLam) || 0) * (parseFloat(f.fondo) || 0);
      const correas = parseFloat(f.correas) || 0;
      const tornillos = cantLam > 0 && correas > 0 ? cantLam * correas * params.clipsPorCruce : 0;
      // Paneles se cotizan por metro lineal, Standing Seam por m² (confirmado por el equipo,
      // feedback Violeta nov 2026) — la medida principal cambia según el tipo de lámina elegido.
      const esPanel = anchoUtilPrecioDe(f.pv) > 0;
      const ml = esPanel ? cantLam * (parseFloat(f.largoLam) || 0) : 0;
      return `<div class="partida-row" data-idx="${idx}">
        <div class="row2">
          <div><label>Nombre del área</label><input type="text" class="l-nombre" data-idx="${idx}" value="${esc(f.nombre)}" placeholder="Techo, Pantallas…"></div>
          <div><label>Tipo de lámina</label><select class="l-producto" data-idx="${idx}">${opciones.map((p) => `<option value="${esc(p.value)}" ${p.value === f.pv ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
        </div>
        <div class="row2">
          <div><label>Largo (m)</label><input type="number" class="l-largo" data-idx="${idx}" value="${f.largoLam || 0}" min="0" step="0.01"></div>
          <div><label>Fondo / ancho a cubrir (m)</label><input type="number" class="l-fondo" data-idx="${idx}" value="${f.fondo || 0}" min="0" step="0.01"></div>
        </div>
        <div class="row2">
          <div><label>Ancho útil de la lámina</label><input type="text" class="l-out-ancho" data-idx="${idx}" value="${anchoUtil ? fmt(anchoUtil) + ' m' : '—'}" disabled></div>
          <div><label>Cant. láminas (auto)</label><input type="text" class="l-out-cantlam" data-idx="${idx}" value="${cantLam}" disabled></div>
        </div>
        <div class="row2 l-medida-principal" data-panel="${esPanel ? '1' : '0'}">
          <div><label>${esPanel ? 'Metros lineales (auto)' : 'm² (auto)'}</label><input type="text" class="l-out-medida" data-idx="${idx}" value="${esPanel ? fmt(ml) + ' ml' : fmt(m2) + ' m²'}" disabled></div>
          <div><label>Correas</label><input type="number" class="l-correas" data-idx="${idx}" value="${f.correas || 0}" min="0" step="1"></div>
        </div>
        <div class="hint l-out-secundaria">${esPanel ? `(referencia: ${fmt(m2)} m² totales)` : 'Standing Seam se cotiza por m², no aplica metros lineales.'}</div>
        <label>Tornillos/clips (auto)</label><input type="text" class="l-out-tornillos" data-idx="${idx}" value="${tornillos.toLocaleString('es-VE')}" disabled>
        <button type="button" class="link l-eliminar" data-idx="${idx}">eliminar ✕</button>
      </div>`;
    }).join('') + '<button type="button" class="btn" id="agregarLam">+ Agregar área</button>';
  }

  function pintarFlash() {
    const cont = root.querySelector('#flashLista');
    if (!cont) return;
    cont.innerHTML = filasFlash.map((f, idx) => {
      const piezas = (parseFloat(f.longitud) || 0) > 0 ? Math.ceil((parseFloat(f.longitud) || 0) / params.largoUtilFlashing) : 0;
      const tornillos = piezas * params.tornillosPorFlashing;
      return `<div class="partida-row" data-idx="${idx}">
        <div class="row2">
          <div><label>Nombre</label><input type="text" class="f-nombre" data-idx="${idx}" value="${esc(f.nombre)}" placeholder="Gotero, Cumbrera…"></div>
          <div><label>Tipo de flashing</label><select class="f-tipo" data-idx="${idx}">${cat.flashings.map((fl, fi) => `<option value="${fi}" ${fi === f.fi ? 'selected' : ''}>${esc(fl.codigo)} — ${esc(fl.descripcion)}</option>`).join('')}</select></div>
        </div>
        <div class="row2">
          <div><label>Longitud total necesaria (ml)</label><input type="number" class="f-longitud" data-idx="${idx}" value="${f.longitud || 0}" min="0" step="0.1"></div>
          <div><label>Piezas (auto)</label><input type="text" class="f-out-piezas" data-idx="${idx}" value="${piezas}" disabled></div>
        </div>
        <label>Tornillos/remaches (auto)</label><input type="text" class="f-out-tornillos" data-idx="${idx}" value="${tornillos.toLocaleString('es-VE')}" disabled>
        <button type="button" class="link f-eliminar" data-idx="${idx}">eliminar ✕</button>
      </div>`;
    }).join('') + '<button type="button" class="btn" id="agregarFlash">+ Agregar flashing</button>';
  }

  // Solo toca los campos auto (disabled) y los totales — nunca el campo que se está editando, así
  // no se pierde el foco mientras se escribe.
  function actualizarAuto() {
    const rl = calcularLam();
    const rf = calcularFlash();
    root.querySelectorAll('#lamLista .partida-row').forEach((div, idx) => {
      const r = rl.filas[idx];
      if (!r) return;
      div.querySelector('.l-out-ancho').value = r.anchoUtil ? fmt(r.anchoUtil) + ' m' : '—';
      div.querySelector('.l-out-cantlam').value = r.cantLam;
      div.querySelector('.l-medida-principal label').textContent = r.esPanel ? 'Metros lineales (auto)' : 'm² (auto)';
      div.querySelector('.l-out-medida').value = r.esPanel ? fmt(r.ml) + ' ml' : fmt(r.m2) + ' m²';
      div.querySelector('.l-out-secundaria').textContent = r.esPanel ? `(referencia: ${fmt(r.m2)} m² totales)` : 'Standing Seam se cotiza por m², no aplica metros lineales.';
      div.querySelector('.l-out-tornillos').value = r.tornillos.toLocaleString('es-VE');
    });
    root.querySelectorAll('#flashLista .partida-row').forEach((div, idx) => {
      const r = rf.filas[idx];
      if (!r) return;
      div.querySelector('.f-out-piezas').value = r.piezas;
      div.querySelector('.f-out-tornillos').value = r.tornillos.toLocaleString('es-VE');
    });
    const totalTornillos = rl.totalTornillos + rf.totalTornillos;
    $out('outTotalM2', fmt(rl.totalM2) + ' m²');
    $out('outTotalMl', fmt(rl.totalMl) + ' ml');
    $out('outTotalLam', rl.totalLam.toLocaleString('es-VE'));
    $out('outTotalPiezas', rf.totalPiezas.toLocaleString('es-VE'));
    $out('outTotalTornillos', totalTornillos.toLocaleString('es-VE'));
  }
  function $out(id, v) {
    const el = root.querySelector('#' + id);
    if (el) el.textContent = v;
  }

  function mount(container, { precios, irACotizador }) {
    root = container;
    onEnviar = irACotizador;
    cat = precios && precios.ok ? Cotizador.construirCatalogo(precios.data) : { categorias: {}, flashings: [] };
    if (filasLam.length === 0) filasLam.push(nuevaFilaLam());
    if (filasFlash.length === 0 && cat.flashings.length) filasFlash.push(nuevaFilaFlash());
    pintar();

    // Quita el "0" por defecto al entrar a un campo numérico (focusin burbujea, a diferencia de
    // focus). OJO: a diferencia de onclick/oninput, "onfocusin" como propiedad (root.onfocusin=...)
    // no funciona en Chromium/Electron — hace falta addEventListener. root se recrea en cada
    // mount(), pero este listener se añade una sola vez por módulo cargado, no se duplica.
    if (!root.dataset.focusinBound) {
      root.dataset.focusinBound = '1';
      root.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'number' && e.target.value === '0') e.target.value = '';
      });
    }

    root.oninput = (e) => {
      const t = e.target;
      const idx = t.dataset.idx;
      if (t.id === 'pClips') { params.clipsPorCruce = parseFloat(t.value) || 0; actualizarAuto(); return; }
      if (t.id === 'pLargoFlash') { params.largoUtilFlashing = parseFloat(t.value) || 0; actualizarAuto(); return; }
      if (t.id === 'pTornFlash') { params.tornillosPorFlashing = parseFloat(t.value) || 0; actualizarAuto(); return; }
      if (idx === undefined) return;
      if (filasLam[idx] && (t.classList.contains('l-nombre') || t.classList.contains('l-largo') || t.classList.contains('l-fondo') || t.classList.contains('l-correas'))) {
        const f = filasLam[idx];
        if (t.classList.contains('l-nombre')) f.nombre = t.value;
        else if (t.classList.contains('l-largo')) f.largoLam = t.value;
        else if (t.classList.contains('l-fondo')) f.fondo = t.value;
        else if (t.classList.contains('l-correas')) f.correas = t.value;
        actualizarAuto();
      } else if (filasFlash[idx] && (t.classList.contains('f-nombre') || t.classList.contains('f-longitud'))) {
        const f = filasFlash[idx];
        if (t.classList.contains('f-nombre')) f.nombre = t.value;
        else if (t.classList.contains('f-longitud')) f.longitud = t.value;
        actualizarAuto();
      }
    };

    root.onchange = (e) => {
      const t = e.target;
      const idx = t.dataset.idx;
      if (idx === undefined) return;
      if (t.classList.contains('l-producto') && filasLam[idx]) { filasLam[idx].pv = t.value; actualizarAuto(); }
      else if (t.classList.contains('f-tipo') && filasFlash[idx]) { filasFlash[idx].fi = +t.value; actualizarAuto(); }
    };

    root.onclick = (e) => {
      if (e.target.id === 'agregarLam') { filasLam.push(nuevaFilaLam()); pintarLam(); actualizarAuto(); return; }
      if (e.target.classList.contains('l-eliminar')) { filasLam.splice(+e.target.dataset.idx, 1); pintarLam(); actualizarAuto(); return; }
      if (e.target.id === 'agregarFlash') { filasFlash.push(nuevaFilaFlash()); pintarFlash(); actualizarAuto(); return; }
      if (e.target.classList.contains('f-eliminar')) { filasFlash.splice(+e.target.dataset.idx, 1); pintarFlash(); actualizarAuto(); return; }
      if (e.target.id === 'enviarCotizador') {
        const rl = calcularLam();
        const rf = calcularFlash();
        const tornillosCant = rl.totalTornillos + rf.totalTornillos;
        if (rl.totalM2 <= 0 && tornillosCant <= 0) { toast('No hay nada que enviar todavía.', 'error'); return; }
        // Una entrada por área con m² > 0 — el Cotizador decide con esto si aplica como ítem
        // único (1 área) o como varias secciones (2+), ver Cotizador.aplicarCalculoExterno().
        const secciones = rl.filas
          .map((r, i) => ({ nombre: r.nombre, areaM2: r.m2, pv: filasLam[i] ? filasLam[i].pv : '' }))
          .filter((s) => s.areaM2 > 0);
        // Flashings calculados aquí (punto 4 del feedback de Violeta) — antes no se mandaban,
        // así que el Cotizador se quedaba en modo "Estimado" con 0 ml / US$ 0.
        const flashings = rf.filas
          .map((r, i) => ({ codigo: cat.flashings[filasFlash[i] ? filasFlash[i].fi : 0]?.codigo, piezas: r.piezas }))
          .filter((f) => f.codigo && f.piezas > 0);
        onEnviar && onEnviar({ areaM2: rl.totalM2, tornillosCant, secciones, flashings });
        toast('Enviado al Cotizador.');
      }
    };
  }

  return { mount };
})();

'use strict';
// Calculadora de láminas/correas (Standing Seam / Centrolam SSA): réplica de la pestaña real
// "Calculo SSA" que ya usa el equipo — comprobado contra 3 cotizaciones reales (Nitroven): Cant
// Lam, Correas y Tornillos se llenan a mano, sin fórmula fija, así que esta calculadora solo
// ayuda a sumar y a pasar el resultado al Cotizador, sin reemplazar el criterio de quien cotiza.
// Es una herramienta aparte del Cotizador a propósito: se pueden usar ambas y comparar resultados.

const Calculadora = (() => {
  let root, onEnviar;
  let filas = [];

  const REF = [
    ['Ancho útil (SSA cal 26/24)', '0,45 m'],
    ['Máximo entre correas — cal 26', '1,80 m'],
    ['Máximo entre correas — cal 24', '2,20 m'],
  ];

  function nuevaFila() {
    return { id: 'c' + Math.random().toString(36).slice(2, 8), nombre: '', largoLam: 0, fondo: 0, cantLam: 0, correas: 0, tornillos: 0 };
  }

  function calcular() {
    return CotizadorEngine.calcularLaminas(filas);
  }

  function pintar() {
    const r = calcular();
    root.innerHTML = `<div class="narrow">
      <div class="card">
        <h2><span class="dot"></span>Referencia (Standing Seam)</h2>
        <div class="hint">Valores de referencia del sistema — no se usan para calcular nada aquí, Cant Lam/Correas/Tornillos se llenan a mano según el criterio de quien cotiza (confirmado con el equipo: no hay una fórmula fija, varía por obra).</div>
        <dl class="kv">${REF.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>
      <div class="card">
        <h2><span class="dot"></span>Cálculo por área</h2>
        <div id="calcLista"></div>
      </div>
      <div class="card">
        <h2><span class="dot"></span>Totales</h2>
        <dl class="kv" id="calcTotales">
          <dt>Total m²</dt><dd>${fmt(r.totalM2)} m²</dd>
          <dt>Total láminas</dt><dd>${r.totalLam.toLocaleString('es-VE')}</dd>
          <dt>Total tornillos</dt><dd>${r.totalTornillos.toLocaleString('es-VE')}</dd>
        </dl>
        <div class="btnrow" style="margin-top:12px"><button class="btn" id="enviarCotizador">→ Enviar al Cotizador</button></div>
        <div class="hint">Lleva Total m² al área del Cotizador y Total tornillos a su "Cantidad manual de tornillos" — úsalo para comparar contra lo que el Cotizador calcula por su cuenta.</div>
      </div>
    </div>`;
    pintarLista();
  }

  function pintarLista() {
    const cont = root.querySelector('#calcLista');
    if (!cont) return;
    cont.innerHTML = filas.map((f, idx) => {
      const m2 = (parseFloat(f.largoLam) || 0) * (parseFloat(f.fondo) || 0);
      return `<div class="partida-row" data-idx="${idx}">
        <div class="row2">
          <div><label>Área</label><input type="text" class="c-nombre" data-idx="${idx}" value="${esc(f.nombre)}" placeholder="Techo, Pantallas…"></div>
          <div><label>m² (= Largo Lam × Fondo)</label><input type="text" value="${fmt(m2)}" disabled></div>
        </div>
        <div class="row2">
          <div><label>Largo Lam (m)</label><input type="number" class="c-largo" data-idx="${idx}" value="${f.largoLam || 0}" min="0" step="0.01"></div>
          <div><label>Fondo / ancho (m)</label><input type="number" class="c-fondo" data-idx="${idx}" value="${f.fondo || 0}" min="0" step="0.01"></div>
        </div>
        <div class="row2">
          <div><label>Cant. láminas</label><input type="number" class="c-cantlam" data-idx="${idx}" value="${f.cantLam || 0}" min="0" step="1"></div>
          <div><label>Correas</label><input type="number" class="c-correas" data-idx="${idx}" value="${f.correas || 0}" min="0" step="1"></div>
        </div>
        <label>Tornillos</label><input type="number" class="c-tornillos" data-idx="${idx}" value="${f.tornillos || 0}" min="0" step="1">
        <button type="button" class="link c-eliminar" data-idx="${idx}">eliminar ✕</button>
      </div>`;
    }).join('') + '<button type="button" class="btn" id="agregarFila">+ Agregar área</button>';
  }

  function actualizarTotales() {
    const r = calcular();
    const dd = root.querySelectorAll('#calcTotales dd');
    if (dd.length === 3) {
      dd[0].textContent = fmt(r.totalM2) + ' m²';
      dd[1].textContent = r.totalLam.toLocaleString('es-VE');
      dd[2].textContent = r.totalTornillos.toLocaleString('es-VE');
    }
    // Recalcula el m² mostrado (deshabilitado) de cada fila sin repintar todo (perdería el foco).
    root.querySelectorAll('.partida-row').forEach((div, idx) => {
      const f = filas[idx];
      if (!f) return;
      const m2 = (parseFloat(f.largoLam) || 0) * (parseFloat(f.fondo) || 0);
      const campoM2 = div.querySelectorAll('input[disabled]')[0];
      if (campoM2) campoM2.value = fmt(m2);
    });
  }

  function mount(container, { irACotizador }) {
    root = container;
    onEnviar = irACotizador;
    if (filas.length === 0) filas.push(nuevaFila());
    pintar();

    root.oninput = (e) => {
      const t = e.target;
      const idx = t.dataset.idx;
      if (idx === undefined || !filas[idx]) return;
      const f = filas[idx];
      if (t.classList.contains('c-nombre')) f.nombre = t.value;
      else if (t.classList.contains('c-largo')) f.largoLam = t.value;
      else if (t.classList.contains('c-fondo')) f.fondo = t.value;
      else if (t.classList.contains('c-cantlam')) f.cantLam = t.value;
      else if (t.classList.contains('c-correas')) f.correas = t.value;
      else if (t.classList.contains('c-tornillos')) f.tornillos = t.value;
      else return;
      actualizarTotales();
    };

    root.onclick = (e) => {
      if (e.target.id === 'agregarFila') {
        filas.push(nuevaFila());
        pintarLista();
        actualizarTotales();
        return;
      }
      if (e.target.classList.contains('c-eliminar')) {
        filas.splice(+e.target.dataset.idx, 1);
        pintarLista();
        actualizarTotales();
        return;
      }
      if (e.target.id === 'enviarCotizador') {
        const r = calcular();
        if (r.totalM2 <= 0 && r.totalTornillos <= 0) { toast('No hay nada que enviar todavía — llena al menos un área.', 'error'); return; }
        onEnviar && onEnviar({ areaM2: r.totalM2, tornillosCant: r.totalTornillos });
        toast('Enviado al Cotizador.');
      }
    };
  }

  return { mount };
})();

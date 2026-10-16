'use strict';
// Módulo Cotizador. La lógica de cálculo vive en src/shared/cotizador-engine.js (pura y con tests);
// aquí solo hay UI: formulario, vista previa de la oferta y exportación.

const Cotizador = (() => {
  const TIPOS_OBRA_DEFECTO = ['Nave industrial / galpón', 'Centro comercial / local comercial', 'Institucional', 'Vivienda / residencial', 'Retechado', 'Otro'];

  let root, cat, params, textos, tiposObra, puedeInterna;
  let S = { pago: 'efectivo', modo: 'm2', vista: 'cliente', imagen: null, plano: null, autoComentario: '', autoNumero: '', secciones: [], remateModo: 'estimado', flashingsItems: [] };
  let ultima = null;

  const $ = (id) => root.querySelector('#' + id);
  const val = (id) => $(id).value;
  const chk = (id) => $(id).checked;

  // ---------- Catálogo a partir de la lista de precios ----------
  function construirCatalogo(data) {
    const out = {};
    const montaje = {};
    for (const p of data.productos) {
      (out[p.categoria] ??= []).push({ n: p.producto, ancho: p.ancho_util || null, efectivo: p.precio_efectivo, bcv: p.precio_bcv });
      if (p.montaje_m2 != null || p.montaje_ml != null) montaje[p.producto] = { m2: p.montaje_m2 ?? 0, ml: p.montaje_ml ?? 0 };
    }
    // Flashings (punto 4) y fijaciones (punto 5): catálogo real, opcional — vacío hasta que el
    // Sheet tenga esas pestañas o en datos antiguos sin ellas.
    const flashings = (data.flashings || []).map((f) => ({ codigo: f.codigo, descripcion: f.descripcion, desarrollo: f.desarrollo_cm, efectivo: f.precio_efectivo, bcv: f.precio_bcv }));
    const fijaciones = (data.fijaciones || []).map((f) => ({ nombre: f.nombre, efectivo: f.precio_efectivo, uso: f.uso }));
    return { categorias: out, montaje, flashings, fijaciones };
  }

  function productoActual() {
    return cat.categorias[val('categoria')][val('producto')];
  }

  function comentarioEstandar(prodName, tipoObra) {
    const info = textos.find((t) => t.producto === prodName);
    let texto;
    if (info) {
      texto = [info.descripcion, '', 'Notas:', ...info.notas.map((n, i) => `${i + 1}. ${n}`)].join('\n');
    } else {
      texto = `[Comentario estándar pendiente para "${prodName}" — todavía no hay una plantilla de oferta real para esta referencia. Se incorporará en cuanto el equipo comercial la aporte (pestaña "Textos" de la lista de precios); mientras tanto no se genera texto técnico/comercial inventado.]`;
    }
    if (tipoObra) texto += `\n\n(Tipo de obra: ${tipoObra} — ajustar el texto si aplica alguna condición particular de este tipo de proyecto.)`;
    return texto;
  }

  // ---------- Plantilla del formulario ----------
  function formHtml() {
    return `
    <div class="card"><h2><span class="dot"></span>Datos del proyecto</h2>
      <label>N° de oferta</label><input type="text" id="numOferta">
      <label>Cliente</label><input type="text" id="cliente" placeholder="Nombre o razón social">
      <label>RIF del cliente</label><input type="text" id="clienteRif" placeholder="J-00000000-0">
      <label>Obra / Proyecto</label><input type="text" id="proyecto">
      <label>Ubicación (ciudad / estado)</label><input type="text" id="ubicacion">
      <label>Dirección fiscal del cliente</label><input type="text" id="direccionFiscal">
      <label>Dirección de entrega (obra) <button type="button" class="link" id="copiarDireccion">usar la fiscal</button></label>
      <input type="text" id="direccionEntrega" placeholder="Casi nunca es la misma que la fiscal">
      <div class="row2">
        <div><label>Persona de contacto</label><input type="text" id="contactoNombre"></div>
        <div><label>Teléfono</label><input type="text" id="contactoTelefono"></div>
      </div>
      <label>Correo del contacto</label><input type="text" id="contactoCorreo">
    </div>

    <div class="card"><h2><span class="dot"></span>Especificación técnica</h2>
      <label class="chk"><input type="checkbox" id="incluirSecciones"> Cotizar por secciones (varias aguas, o techo + pantalla por separado)</label>
      <div class="hint">Úsalo cuando el techo tiene aguas de distinto tamaño, son varios techos que el cliente quiere ver por etapas, o hay techo y pantalla con sistemas distintos.</div>
      <div id="seccionUnicaBox">
        <label>Sistema</label><select id="categoria"></select>
        <label>Producto</label><select id="producto"></select>
        <label>Modo de medición</label>
        <div class="toggle" id="medidaToggle"><button data-v="m2" class="active">Área directa (m²)</button><button data-v="ml">Metros lineales</button></div>
        <div id="areaDirectaBox"><label>Área a cubrir (m²)</label><input type="number" id="area" value="0" min="0" step="1"></div>
        <div id="areaMlBox" hidden>
          <div class="row2">
            <div><label>Largo total (ml)</label><input type="number" id="mlLargo" min="0" step="0.1"></div>
            <div><label>Ancho de cobertura (m)</label><input type="number" id="mlAncho" min="0" step="0.01"></div>
          </div>
          <div class="hint">Área calculada: <strong id="mlAreaCalc">— m²</strong>. Confirma el ancho de cobertura real de la lámina/panel.</div>
        </div>
      </div>
      <div id="seccionesBox" hidden>
        <div id="seccionesLista"></div>
      </div>
      <label>Forma de pago</label>
      <div class="toggle" id="pagoToggle"><button data-v="efectivo" class="active">Efectivo USD</button><button data-v="bcv">Bs. a tasa BCV</button></div>
      <div class="hint">La lista de precios maneja dos tarifas según forma de pago; se aplica la que corresponda.</div>
      <label class="chk"><input type="checkbox" id="modPrecios"> Modificar precios de lista (caso a caso)</label>
      <div class="manual-box" id="preciosManualBox" hidden>
        <div class="row2">
          <div><label>Material (US$/m²)</label><input type="number" id="precioMaterialManual" step="0.01" min="0"></div>
          <div><label>Tornillo (US$/unid.)</label><input type="number" id="precioTornilloManual" step="0.01" min="0"></div>
        </div>
        <label>Remate (US$/ml)</label><input type="number" id="precioRemateManual" step="0.01" min="0">
        <div class="hint">Sustituyen a la lista oficial solo para esta oferta. En modo secciones se aplican a todas por igual.</div>
      </div>
    </div>

    <div class="card"><h2><span class="dot"></span>Ajustes de cálculo</h2>
      <div class="row2">
        <div><label>Desperdicio (%)</label><input type="number" id="desperdicio" min="0" max="30" step="0.5"></div>
        <div><label>Tornillos / m²</label><input type="number" id="tornillos" min="0" step="0.5"></div>
      </div>
      ${cat.fijaciones.length ? `
      <label>Fijación específica (catálogo real, opcional)</label>
      <select id="fijacionCatalogo"><option value="">— usar precio de tornillo general —</option>${cat.fijaciones.map((f, i) => `<option value="${i}">${esc(f.nombre)} — US$ ${fmt(f.efectivo)}</option>`).join('')}</select>
      <div class="hint" id="fijacionUsoHint"></div>` : ''}
      <div id="remateUnicoBox">
        <label>Remates / flashings</label>
        <div class="toggle" id="remateModoToggle"><button type="button" data-v="estimado" class="active">Estimado (ml)</button><button type="button" data-v="detallado">Detallado (piezas reales)</button></div>
        <div id="remateEstimadoBox">
          <label>Metros lineales</label><input type="number" id="remates" value="0" min="0" step="1">
          <div class="hint">Se venden por pieza de 2,40 m, a un precio promedio: se redondea hacia arriba al múltiplo más cercano.</div>
        </div>
        <div id="remateDetalladoBox" hidden>
          <div id="flashingsLista"></div>
          <div class="hint">Cada flashing del catálogo real tiene su propio desarrollo y precio — no se engloban en uno solo (punto 4 del feedback).</div>
        </div>
      </div>
      <div class="hint" id="remateSeccionesHint" hidden>Los remates de cada sección se ingresan en "Secciones", dentro de cada una.</div>
      <label class="chk"><input type="checkbox" id="incluirMontaje"> Incluir montaje en esta oferta</label>
      <div class="manual-box" id="montajeBox" hidden>
        <div class="row2">
          <div><label>Montaje techo (US$/m²)</label><input type="number" id="precioMontajeM2" step="0.01" min="0" value="0"></div>
          <div><label>Montaje remates (US$/ml)</label><input type="number" id="precioMontajeMl" step="0.01" min="0" value="0"></div>
        </div>
        <div class="hint">Precargado solo para productos con precio de montaje en la lista. Si no, se ingresa a mano.</div>
        <div class="row2">
          <div><label>Días de grúa</label><input type="number" id="montajeDiasGrua" step="1" min="0" value="0"></div>
          <div><label>Precio grúa (US$/día)</label><input type="number" id="montajePrecioGruaDia" step="1" min="0" value="0"></div>
        </div>
        <div class="row2">
          <div><label>Andamios especiales (US$)</label><input type="number" id="montajeAndamios" step="1" min="0" value="0"></div>
          <div><label>Supervisor fijo en obra (US$)</label><input type="number" id="montajeSupervisor" step="1" min="0" value="0"></div>
        </div>
        <div class="hint">Días de grúa (p. ej. izado en standing seam), andamios especiales y supervisor fijo: solo cuando esta obra lo requiera.</div>
      </div>
      <label class="chk"><input type="checkbox" id="incluirFlete"> Incluir flete en esta oferta</label>
      <div class="manual-box" id="fleteBox" hidden>
        <label>Flete (US$, estimado para este despacho)</label><input type="number" id="precioFlete" step="1" min="0" value="0">
        <div class="hint">El flete varía por destino: se ingresa caso a caso.</div>
      </div>
      <div class="row2">
        <div><label>IVA (%)</label><input type="number" id="iva" min="0" step="0.5"></div>
        <div><label>Tasa BCV (Bs/US$)</label><input type="number" id="tasabcv" placeholder="Tasa del día"></div>
      </div>
      <div class="hint">Verifica IVA y tasa BCV vigentes al cotizar.</div>
    </div>

    <div class="card"><h2><span class="dot"></span>Comentarios para el cliente</h2>
      <label>Tipo de obra</label><select id="tipoObra"></select>
      <label>Comentario / alcance (editable) <button type="button" class="link" id="restaurarComentario">↺ restaurar estándar</button></label>
      <textarea id="comentarios" rows="6"></textarea>
    </div>

    <div class="card"><h2><span class="dot"></span>Imagen del proyecto (opcional)</h2>
      <label class="chk"><input type="checkbox" id="incluirImagen"> Incluir imagen / render en la propuesta</label>
      <div id="imagenUploadBox" hidden style="margin-top:10px"><input type="file" id="imagenInput" accept="image/*"></div>
    </div>

    <div class="card"><h2><span class="dot"></span>Plano del cliente (uso interno, opcional)</h2>
      <label class="chk"><input type="checkbox" id="incluirPlano"> Adjuntar el plano/archivo que suministró el cliente</label>
      <div id="planoUploadBox" hidden style="margin-top:10px">
        <input type="file" id="planoInput" accept=".pdf,.jpg,.jpeg,.png,.dwg,.dxf">
        <div class="hint" id="planoActual"></div>
      </div>
      <div class="hint">Se guarda junto con la oferta (botón "Guardar oferta" abajo). No se incluye en el PDF ni el Excel del cliente.</div>
    </div>

    ${puedeInterna ? `
    <div class="card"><h2><span class="dot" style="background:var(--brown)"></span>Costes y márgenes (uso interno — Dirección)</h2>
      <label class="chk"><input type="checkbox" id="incluirMargen"> Habilitar vista interna con costos y márgenes</label>
      <div class="margin-box" id="margenBox" hidden>
        <div class="row2">
          <div><label>Costo material (US$/m²)</label><input type="number" id="costoMaterial" step="0.01" min="0" value="0"></div>
          <div><label>Costo tornillo (US$/unid.)</label><input type="number" id="costoTornillo" step="0.01" min="0" value="0"></div>
        </div>
        <div class="row2">
          <div><label>Costo remate (US$/ml)</label><input type="number" id="costoRemate" step="0.01" min="0" value="0"></div>
          <div><label>Costo real montaje + flete (US$)</label><input type="number" id="costoOtros" step="0.01" min="0" value="0"></div>
        </div>
        <div class="hint">Costos reales de esta obra; no se estiman.</div>
      </div>
    </div>` : ''}

    <div class="btnrow">
      <button class="btn" data-act="pdf-cliente">📄 PDF Vista Cliente</button>
      ${puedeInterna ? '<button class="btn brown" data-act="pdf-interna">📄 PDF Vista Interna</button>' : ''}
    </div>
    <div class="btnrow"><button class="btn navy" data-act="xlsx">📊 Exportar a Excel</button></div>
    <div class="btnrow">
      <button class="btn" data-act="guardar-oferta">💾 Guardar oferta</button>
      <button class="btn" data-act="ofertas-guardadas">📂 Ofertas guardadas</button>
    </div>
    <div class="hint">Guardado solo en este equipo (ver "Plano del cliente" arriba). Permite reabrir y seguir editando una oferta más tarde.</div>`;
  }

  function docHtml() {
    return `
    <div class="doc" id="doc" data-vista="cliente">
      <div class="interna-only-flag" id="confidencialFlag">CONFIDENCIAL — USO INTERNO GRUPO CENTROLIT</div>
      <div class="doc-head">
        <div class="doc-head-logo"><img src="${S.logoSrc}" alt="Centrolit">
          <div class="doc-head-info" id="empresaInfo"></div></div>
        <div class="meta"><div class="numoferta" id="docNum"></div><div id="docFecha"></div><div>Validez: 7 días</div></div>
      </div>
      <div class="doc-title">Propuesta Técnico-Comercial</div>
      <div class="doc-sub">Suministro de sistema de cubierta</div>
      <div class="doc-info" id="docInfo"></div>
      <div class="doc-comentarios" id="comentariosBox" hidden></div>
      <div class="doc-image" id="imagenBox" hidden></div>
      <div class="screen-only-note">Nota interna (no se imprime): las etiquetas "calculado", "estimado", "valor de lista", etc. solo se ven en pantalla; en el PDF de la Vista Cliente no aparecen.</div>
      <table class="items"><thead><tr><th>Concepto</th><th>Detalle</th><th class="r">Cantidad</th><th class="r">Precio unit.</th><th class="r">Importe (US$)</th></tr></thead><tbody id="itemsBody"></tbody></table>
      <div class="totals" id="totalsBox"></div>
      <div id="internaSection" hidden>
        <div class="interna-flag">VISTA INTERNA — SOLO DIRECCIÓN, NO ENTREGAR AL CLIENTE</div>
        <table class="margins"><thead><tr><th>Concepto</th><th class="r">Precio venta</th><th class="r">Costo</th><th class="r">Ganancia</th><th class="r">Margen bruto</th><th class="r">Markup</th></tr></thead><tbody id="marginBody"></tbody></table>
        <div class="margin-summary" id="marginSummaryBox"></div>
      </div>
      <div class="notes" id="notesBox"></div>
      <div class="sign-note">Firma no obligatoria en esta etapa — es una oferta, no un contrato.</div>
      <div class="sign"><div class="line">Por Grupo Centrolit (opcional)</div><div class="line">Aceptación del cliente (opcional)</div></div>
      <div class="doc-foot" id="docFoot"></div>
    </div>`;
  }

  // ---------- Montaje / UI ----------
  // logoSrc: ruta del logo relativa a la página que llama (escritorio y web sirven los
  // mismos ficheros desde carpetas distintas, por eso no se puede hardcodear aquí).
  function mount(container, { precios, acceso, empresa, logoSrc }) {
    const previo = root ? snapshot() : null;
    root = container;
    const d = precios.data;
    cat = construirCatalogo(d);
    params = d.parametros;
    textos = d.textos;
    tiposObra = d.tiposObra.length ? d.tiposObra : TIPOS_OBRA_DEFECTO;
    puedeInterna = !!acceso?.visible;
    S.empresa = empresa || {};
    S.logoSrc = logoSrc || '../../assets/logo.png';

    root.innerHTML = `<div class="cot-grid">
      <div class="cot-form">${formHtml()}</div>
      <div>${puedeInterna ? `<div class="viewToggle" id="viewToggle"><button data-v="cliente" class="active cliente">Vista Cliente</button><button data-v="interna" class="interna">Vista Interna (Dirección)</button></div>` : ''}${docHtml()}</div>
    </div>`;

    $('categoria').innerHTML = Object.keys(cat.categorias).map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    $('tipoObra').innerHTML = tiposObra.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    poblarProductos();

    // Valores por defecto desde la lista de precios (solo la primera vez)
    $('desperdicio').value = params.desperdicio_defecto ?? 7;
    $('tornillos').value = params.tornillos_m2_defecto ?? 7;
    $('iva').value = params.iva_defecto ?? 16;
    $('numOferta').value = S.autoNumero = siguienteNumero();

    bind();
    if (previo) restaurar(previo);
    aplicarComentarioAuto();
    actualizarPlanoHint();
    calcular();
  }

  // Sin precio_efectivo NI precio_bcv en la lista: referencia pendiente de confirmar (punto 2 del
  // feedback — p. ej. láminas translúcidas/climatizadas). No se puede seleccionar para cotizar.
  const sinPrecio = (p) => p.efectivo == null && p.bcv == null;
  const etiquetaProducto = (p) => p.n + (sinPrecio(p) ? ' — PRECIO PENDIENTE (no disponible)' : '');

  function poblarProductos() {
    $('producto').innerHTML = cat.categorias[val('categoria')].map((p, i) => `<option value="${i}" ${sinPrecio(p) ? 'disabled' : ''}>${esc(etiquetaProducto(p))}</option>`).join('');
  }

  // ---------- Secciones (varias aguas / techo + pantalla — punto 3 del feedback) ----------
  function productosPlanos() {
    const out = [];
    for (const catN of Object.keys(cat.categorias)) {
      cat.categorias[catN].forEach((p, i) => out.push({ value: catN + '||' + i, label: `${catN} — ${etiquetaProducto(p)}`, producto: p, sinPrecio: sinPrecio(p) }));
    }
    return out;
  }
  function productoPorValor(v) {
    const [catN, i] = v.split('||');
    return cat.categorias[catN] && cat.categorias[catN][+i];
  }

  function nuevaSeccion() {
    return { id: 's' + Math.random().toString(36).slice(2, 8), nombre: '', pv: productosPlanos()[0]?.value || '', modo: 'm2', area: 0, mlLargo: 0, mlAncho: 0, rematesMl: 0 };
  }

  function renderSecciones() {
    const cont = $('seccionesLista');
    if (!cont) return;
    const planos = productosPlanos();
    cont.innerHTML = S.secciones.map((s, idx) => `
      <div class="seccion-row" data-idx="${idx}">
        <div class="seccion-row-head"><strong>Sección ${idx + 1}</strong><button type="button" class="link sec-eliminar" data-idx="${idx}">eliminar ✕</button></div>
        <div class="row2">
          <div><label>Nombre</label><input type="text" class="sec-nombre" data-idx="${idx}" value="${esc(s.nombre)}" placeholder="Agua 1, Pantalla norte…"></div>
          <div><label>Sistema / producto</label><select class="sec-producto" data-idx="${idx}">${planos.map((pp) => `<option value="${esc(pp.value)}" ${pp.value === s.pv ? 'selected' : ''} ${pp.sinPrecio ? 'disabled' : ''}>${esc(pp.label)}</option>`).join('')}</select></div>
        </div>
        <div class="toggle sec-modo" data-idx="${idx}">
          <button type="button" data-v="m2" class="${s.modo !== 'ml' ? 'active' : ''}">m²</button>
          <button type="button" data-v="ml" class="${s.modo === 'ml' ? 'active' : ''}">ml</button>
        </div>
        ${s.modo === 'ml' ? `
          <div class="row2">
            <div><label>Largo (ml)</label><input type="number" class="sec-largo" data-idx="${idx}" value="${s.mlLargo || 0}" min="0" step="0.1"></div>
            <div><label>Ancho de cobertura (m)</label><input type="number" class="sec-ancho" data-idx="${idx}" value="${s.mlAncho || 0}" min="0" step="0.01"></div>
          </div>` : `<label>Área (m²)</label><input type="number" class="sec-area" data-idx="${idx}" value="${s.area || 0}" min="0" step="1">`}
        <label>Remates/flashings de esta sección (ml)</label><input type="number" class="sec-remates" data-idx="${idx}" value="${s.rematesMl || 0}" min="0" step="1">
      </div>`).join('') + '<button type="button" class="btn" id="agregarSeccion">+ Agregar sección</button>';
  }

  function areaSeccion(s) {
    return s.modo === 'ml' ? (parseFloat(s.mlLargo) || 0) * (parseFloat(s.mlAncho) || 0) : parseFloat(s.area) || 0;
  }

  // ---------- Flashings detallados (catálogo real, punto 4 del feedback) ----------
  function nuevoFlashingItem() {
    return { id: 'f' + Math.random().toString(36).slice(2, 8), idx: 0, piezas: 0 };
  }
  function renderFlashings() {
    const cont = $('flashingsLista');
    if (!cont) return;
    cont.innerHTML = S.flashingsItems.map((it, i) => `
      <div class="row2 flashing-row" data-idx="${i}">
        <div><label>Flashing</label><select class="fl-codigo" data-idx="${i}">${cat.flashings.map((f, fi) => `<option value="${fi}" ${fi === it.idx ? 'selected' : ''}>${esc(f.codigo)} — ${esc(f.descripcion)} (desarrollo ${esc(f.desarrollo)} cm) — US$ ${fmt(f.efectivo)}</option>`).join('')}</select></div>
        <div><label>Piezas</label><input type="number" class="fl-piezas" data-idx="${i}" value="${it.piezas || 0}" min="0" step="1"></div>
      </div>`).join('') + '<button type="button" class="link" id="agregarFlashing">+ agregar otro flashing</button>';
  }

  // Conserva lo escrito en el formulario cuando se refrescan los precios.
  function snapshot() {
    const s = {};
    root.querySelectorAll('input[id],select[id],textarea[id]').forEach((el) => {
      if (el.type === 'file') return;
      s[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return s;
  }
  function restaurar(s) {
    const orden = ['categoria', 'producto'];
    const set = (id) => {
      const el = $(id);
      if (!el || !(id in s)) return;
      if (el.type === 'checkbox') el.checked = s[id];
      else if (el.tagName !== 'SELECT' || [...el.options].some((o) => o.value === s[id])) el.value = s[id];
      if (id === 'categoria') poblarProductos();
    };
    orden.forEach(set);
    Object.keys(s).filter((k) => !orden.includes(k)).forEach(set);
    ['modPrecios', 'incluirMontaje', 'incluirFlete', 'incluirImagen', 'incluirPlano', 'incluirMargen'].forEach((id) => $(id) && toggleBox(id));
    $('areaDirectaBox').hidden = S.modo !== 'm2';
    $('areaMlBox').hidden = S.modo !== 'ml';
    marcar('medidaToggle', S.modo);
    marcar('pagoToggle', S.pago);
    toggleSecciones();
    if ($('remateModoToggle')) {
      marcar('remateModoToggle', S.remateModo);
      $('remateEstimadoBox').hidden = S.remateModo !== 'estimado';
      $('remateDetalladoBox').hidden = S.remateModo !== 'detallado';
      if (S.remateModo === 'detallado') renderFlashings();
    }
  }

  const boxDe = { modPrecios: 'preciosManualBox', incluirMontaje: 'montajeBox', incluirFlete: 'fleteBox', incluirImagen: 'imagenUploadBox', incluirPlano: 'planoUploadBox', incluirMargen: 'margenBox' };
  const toggleBox = (id) => { if ($(boxDe[id])) $(boxDe[id]).hidden = !chk(id); };
  const marcar = (toggleId, v) => $(toggleId).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));

  function toggleSecciones() {
    if (!$('incluirSecciones')) return;
    const on = chk('incluirSecciones');
    $('seccionUnicaBox').hidden = on;
    $('seccionesBox').hidden = !on;
    $('remateUnicoBox').hidden = on;
    $('remateSeccionesHint').hidden = !on;
    if (on && S.secciones.length === 0) S.secciones.push(nuevaSeccion());
    if (on) renderSecciones();
  }

  function bind() {
    const grid = root.querySelector('.cot-grid'); // se recrea en cada mount: evita listeners duplicados
    grid.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'comentarios' || t.type === 'file') return;
      const idx = t.dataset.idx;
      if (idx !== undefined && t.classList.contains('fl-piezas')) {
        if (S.flashingsItems[idx]) S.flashingsItems[idx].piezas = t.value;
      } else if (idx !== undefined && S.secciones[idx]) {
        const s = S.secciones[idx];
        if (t.classList.contains('sec-nombre')) s.nombre = t.value;
        else if (t.classList.contains('sec-area')) s.area = t.value;
        else if (t.classList.contains('sec-largo')) s.mlLargo = t.value;
        else if (t.classList.contains('sec-ancho')) s.mlAncho = t.value;
        else if (t.classList.contains('sec-remates')) s.rematesMl = t.value;
      }
      calcular();
    });
    grid.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'incluirSecciones') { toggleSecciones(); calcular(); return; }
      if (e.target.classList.contains('sec-producto')) {
        const idx = e.target.dataset.idx;
        if (S.secciones[idx]) S.secciones[idx].pv = e.target.value;
        calcular();
        return;
      }
      if (e.target.classList.contains('fl-codigo')) {
        const idx = e.target.dataset.idx;
        if (S.flashingsItems[idx]) S.flashingsItems[idx].idx = +e.target.value;
        calcular();
        return;
      }
      if (id === 'fijacionCatalogo') {
        const f = cat.fijaciones[e.target.value];
        if (f) {
          if (!chk('modPrecios')) { $('modPrecios').checked = true; toggleBox('modPrecios'); precargarManuales(); }
          $('precioTornilloManual').value = f.efectivo.toFixed(2);
          $('fijacionUsoHint').textContent = f.uso ? `Uso habitual: ${f.uso}` : '';
        } else {
          $('fijacionUsoHint').textContent = '';
        }
        calcular();
        return;
      }
      if (id === 'categoria') { poblarProductos(); onProducto(); }
      else if (id === 'producto') onProducto();
      else if (id === 'tipoObra') aplicarComentarioAuto();
      else if (boxDe[id]) {
        toggleBox(id);
        if (id === 'modPrecios' && chk(id)) precargarManuales();
        if (id === 'incluirMontaje' && chk(id)) precargarMontaje();
        if (id === 'incluirImagen' && !chk(id)) S.imagen = null;
        if (id === 'incluirPlano' && !chk(id)) { S.plano = null; actualizarPlanoHint(); }
        if (id === 'incluirMargen' && !chk(id)) setVista('cliente');
      } else if (id === 'imagenInput') {
        const f = e.target.files[0];
        if (!f) { S.imagen = null; calcular(); return; }
        const r = new FileReader();
        r.onload = (ev) => { S.imagen = ev.target.result; calcular(); };
        r.readAsDataURL(f);
        return;
      } else if (id === 'planoInput') {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = (ev) => { S.plano = { nombre: f.name, tipo: f.type, data: ev.target.result }; actualizarPlanoHint(); };
        r.readAsDataURL(f);
        return;
      }
      calcular();
    });
    grid.addEventListener('click', (e) => {
      const remateModoBtn = e.target.closest('#remateModoToggle button');
      if (remateModoBtn) {
        S.remateModo = remateModoBtn.dataset.v;
        marcar('remateModoToggle', S.remateModo);
        $('remateEstimadoBox').hidden = S.remateModo !== 'estimado';
        $('remateDetalladoBox').hidden = S.remateModo !== 'detallado';
        if (S.remateModo === 'detallado' && S.flashingsItems.length === 0) S.flashingsItems.push(nuevoFlashingItem());
        if (S.remateModo === 'detallado') renderFlashings();
        calcular();
        return;
      }
      if (e.target.id === 'agregarFlashing') {
        S.flashingsItems.push(nuevoFlashingItem());
        renderFlashings();
        calcular();
        return;
      }
      const secModoBtn = e.target.closest('.sec-modo button');
      if (secModoBtn) {
        const idx = secModoBtn.closest('.sec-modo').dataset.idx;
        if (S.secciones[idx]) S.secciones[idx].modo = secModoBtn.dataset.v;
        renderSecciones();
        calcular();
        return;
      }
      if (e.target.classList.contains('sec-eliminar')) {
        S.secciones.splice(+e.target.dataset.idx, 1);
        renderSecciones();
        calcular();
        return;
      }
      if (e.target.id === 'agregarSeccion') {
        S.secciones.push(nuevaSeccion());
        renderSecciones();
        calcular();
        return;
      }
      const tg = e.target.closest('.toggle button');
      if (tg) {
        const box = tg.parentElement.id;
        if (box === 'pagoToggle') { S.pago = tg.dataset.v; if (chk('modPrecios')) precargarManuales(); }
        if (box === 'medidaToggle') {
          S.modo = tg.dataset.v;
          $('areaDirectaBox').hidden = S.modo !== 'm2';
          $('areaMlBox').hidden = S.modo !== 'ml';
          prefillAncho();
        }
        marcar(box, tg.dataset.v);
        calcular();
        return;
      }
      const vt = e.target.closest('#viewToggle button');
      if (vt) return setVista(vt.dataset.v);
      if (e.target.id === 'restaurarComentario') { aplicarComentarioAuto(true); return; }
      if (e.target.id === 'copiarDireccion') { $('direccionEntrega').value = val('direccionFiscal'); calcular(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'pdf-cliente') exportarPdf('cliente');
      if (act === 'pdf-interna') exportarPdf('interna');
      if (act === 'xlsx') exportarExcel();
      if (act === 'guardar-oferta') guardarOferta();
      if (act === 'ofertas-guardadas') abrirPanelOfertas();
    });
  }

  function actualizarPlanoHint() {
    const el = $('planoActual');
    if (el) el.textContent = S.plano ? `Adjunto: ${S.plano.nombre}` : 'Sin archivo adjunto todavía.';
  }

  function onProducto() {
    aplicarComentarioAuto();
    if (S.modo === 'ml') { $('mlAncho').value = ''; prefillAncho(); }
    if (chk('modPrecios')) precargarManuales();
    if (chk('incluirMontaje')) precargarMontaje(true);
  }

  function prefillAncho() {
    const p = productoActual();
    if (S.modo === 'ml' && p.ancho && !val('mlAncho')) $('mlAncho').value = p.ancho;
  }

  function precargarManuales() {
    const p = productoActual();
    $('precioMaterialManual').value = CotizadorEngine.precioM2Lista(p, S.pago).toFixed(2);
    $('precioTornilloManual').value = Number(params['tornillo_' + S.pago]).toFixed(2);
    $('precioRemateManual').value = Number(params['remate_' + S.pago]).toFixed(2);
  }

  function precargarMontaje(forzar) {
    const def = cat.montaje[productoActual().n];
    if (!def) { if (forzar) { $('precioMontajeM2').value = 0; $('precioMontajeMl').value = 0; } return; }
    if (forzar || !parseFloat(val('precioMontajeM2'))) $('precioMontajeM2').value = def.m2;
    if (forzar || !parseFloat(val('precioMontajeMl'))) $('precioMontajeMl').value = def.ml;
  }

  function aplicarComentarioAuto(forzar) {
    const nuevo = comentarioEstandar(productoActual().n, val('tipoObra'));
    const ta = $('comentarios');
    if (forzar || ta.value.trim() === '' || ta.value === S.autoComentario) ta.value = nuevo;
    S.autoComentario = nuevo;
    if (forzar) calcular();
  }

  function setVista(v) {
    S.vista = v;
    root.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
    calcular();
  }

  // ---------- Numeración local de ofertas ----------
  function contador() {
    try { return parseInt(localStorage.getItem('centrolit.contadorOferta') || '1', 10); } catch { return 1; }
  }
  function siguienteNumero() {
    const pref = S.empresa?.prefijoOferta || 'CTL';
    return `${pref}-${new Date().getFullYear()}-${String(contador()).padStart(4, '0')}`;
  }
  function avanzarNumero() {
    try { localStorage.setItem('centrolit.contadorOferta', String(contador() + 1)); } catch {}
    if (val('numOferta') === S.autoNumero) $('numOferta').value = S.autoNumero = siguienteNumero();
    calcular();
  }

  // ---------- Cálculo + render ----------
  function area() {
    if (S.modo === 'ml') {
      const a = (parseFloat(val('mlLargo')) || 0) * (parseFloat(val('mlAncho')) || 0);
      $('mlAreaCalc').textContent = a ? fmt(a) + ' m²' : '— m²';
      return a;
    }
    return parseFloat(val('area')) || 0;
  }

  function calcular() {
    if (!root) return;
    const p = productoActual();
    const categoria = val('categoria');
    const modPrecios = chk('modPrecios');
    const margen = puedeInterna && chk('incluirMargen');
    const multi = chk('incluirSecciones') && S.secciones.length > 0;
    const seccionesEntrada = multi ? S.secciones.map((s) => {
      const prod = productoPorValor(s.pv);
      return {
        nombre: (s.nombre ? s.nombre + ' — ' : '') + (prod ? prod.n : ''),
        producto: prod,
        area: areaSeccion(s),
        desperdicioPct: val('desperdicio'),
        tornillosPorM2: val('tornillos'),
        rematesMl: s.rematesMl,
      };
    }) : null;
    const rematesDetalle = (!multi && S.remateModo === 'detallado')
      ? S.flashingsItems.map((it) => {
          const f = cat.flashings[it.idx];
          return { codigo: f ? f.codigo : '', piezas: it.piezas, precioUnit: f ? f[S.pago] : 0 };
        })
      : null;
    const entradas = {
      producto: multi ? null : p, pago: S.pago, area: multi ? 0 : area(),
      desperdicioPct: val('desperdicio'), tornillosPorM2: val('tornillos'), rematesMl: multi ? 0 : val('remates'),
      secciones: seccionesEntrada,
      rematesDetalle,
      ivaPct: val('iva'), tasaBcv: val('tasabcv'),
      preciosManuales: modPrecios ? { material: val('precioMaterialManual'), tornillo: val('precioTornilloManual'), remate: val('precioRemateManual') } : null,
      montaje: {
        incluir: chk('incluirMontaje'), m2: val('precioMontajeM2'), ml: val('precioMontajeMl'),
        diasGrua: val('montajeDiasGrua'), precioGruaDia: val('montajePrecioGruaDia'),
        andamios: val('montajeAndamios'), supervisor: val('montajeSupervisor'),
      },
      flete: { incluir: chk('incluirFlete'), monto: val('precioFlete') },
      margen: margen ? { costoMaterial: val('costoMaterial'), costoTornillo: val('costoTornillo'), costoRemate: val('costoRemate'), costoOtros: val('costoOtros') } : null,
    };
    const r = CotizadorEngine.calcularOferta(entradas, {
      tornillo: { efectivo: params.tornillo_efectivo, bcv: params.tornillo_bcv },
      remate: { efectivo: params.remate_efectivo, bcv: params.remate_bcv },
      piezaRemateM: params.pieza_remate_m,
    });
    const pagoTxt = S.pago === 'efectivo' ? 'Contado, efectivo USD' : 'Bolívares a tasa BCV';
    const hoy = new Date().toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nombreTornillo = params.tornillo_nombre || 'Tornillo autotaladrante — fijación estándar';
    const nombreRemate = params.remate_nombre || 'Flashing/remate perimetral';
    const montajeDef = !multi && !!cat.montaje[p.n];

    const contacto = [val('contactoNombre'), val('contactoTelefono'), val('contactoCorreo')].filter((x) => x && x.trim()).join(' · ');
    ultima = {
      ...r,
      docNum: `OFERTA N° ${val('numOferta') || '—'}`, fecha: hoy,
      cliente: val('cliente') || '—', proyecto: val('proyecto') || '—', ubicacion: val('ubicacion') || '—',
      clienteRif: val('clienteRif') || '', direccionFiscal: val('direccionFiscal') || '', direccionEntrega: val('direccionEntrega') || '',
      contactoNombre: val('contactoNombre') || '', contactoTelefono: val('contactoTelefono') || '', contactoCorreo: val('contactoCorreo') || '', contacto,
      pago: pagoTxt, tipoObra: val('tipoObra') || '—', comentarios: val('comentarios').trim(),
      productoNombre: multi ? `Varias secciones (${r.secciones.length})` : p.n,
      catLabel: multi ? 'Secciones' : categoria, ancho: multi ? null : p.ancho,
    };

    const emp = S.empresa;
    $('empresaInfo').innerHTML = `RIF: ${esc(emp.rif)}<br>${esc(emp.direccion)}`;
    $('docFoot').innerHTML = `<span>${esc(emp.nombre)} · Centrolit / Centrolam / Plasticorp / Paneles Aislados</span><span>${esc(emp.web)}</span>`;
    $('docNum').textContent = ultima.docNum;
    $('docFecha').textContent = 'Fecha: ' + hoy;
    $('docInfo').innerHTML = [
      ['Cliente', ultima.cliente], ['RIF', ultima.clienteRif || '—'], ['Ubicación', ultima.ubicacion], ['Proyecto', ultima.proyecto],
      ['Dirección fiscal', ultima.direccionFiscal || '—'], ['Dirección de entrega', ultima.direccionEntrega || '—'],
      ['Forma de pago', pagoTxt], ['Tipo de obra', ultima.tipoObra], ['Contacto', ultima.contacto || '—'],
    ].map(([l, v]) => `<div><span class="l">${l}:</span>${esc(v)}</div>`).join('');

    const sub = (t) => `<div class="sub-line">${esc(t)}</div>`;
    const filas = [];
    if (r.precioFaltante) {
      filas.push('<tr class="seccion-head-row" style="background:var(--red) !important"><td colspan="5"><strong>⚠ Un producto no tiene precio de lista confirmado — no se puede exportar ni entregar esta oferta hasta corregirlo.</strong></td></tr>');
    }
    if (multi) {
      r.secciones.forEach((s) => {
        const subtotalSeccion = s.materialImporte + s.tornillosImporte + s.rematesImporte;
        filas.push(`<tr class="seccion-head-row"><td colspan="5"><strong>— ${esc(s.nombre)} —</strong></td></tr>`);
        filas.push(`<tr><td>Material${sub('')}</td>
          <td>${s.area.toLocaleString('es-VE')} m² + ${s.desperdicioPct}% desperdicio<span class="badge-est">calculado</span></td>
          <td class="r">${s.areaConDesp.toFixed(2)} m²</td><td class="r">US$ ${fmt(s.precioM2)}/m²</td><td class="r">US$ ${fmt(s.materialImporte)}</td></tr>`);
        filas.push(`<tr><td>Fijaciones${sub(nombreTornillo)}</td>
          <td>${s.tornillosPorM2} unid./m²<span class="badge-est">estimado</span></td>
          <td class="r">${s.tornillosCant.toLocaleString('es-VE')} unid.</td><td class="r">US$ ${fmt(s.tornilloPrecio)}</td><td class="r">US$ ${fmt(s.tornillosImporte)}</td></tr>`);
        filas.push(`<tr><td>Remates / Flashings${sub(nombreRemate)}</td>
          <td>${s.rematesMl.toLocaleString('es-VE')} ml → ${s.piezasRemate} pieza(s)<span class="badge-est">estimado</span></td>
          <td class="r">${s.rematesMlFacturable.toLocaleString('es-VE')} ml</td><td class="r">US$ ${fmt(s.rematePrecio)}</td><td class="r">US$ ${fmt(s.rematesImporte)}</td></tr>`);
        filas.push(`<tr class="seccion-subtotal-row"><td colspan="4">Subtotal de esta sección (sin montaje ni flete, prorrateables)</td><td class="r">US$ ${fmt(subtotalSeccion)}</td></tr>`);
      });
    } else {
      filas.push(
        `<tr><td><strong>${esc(p.n)}</strong>${sub(categoria + (p.ancho ? ' · ancho útil ' + p.ancho + ' m' : ''))}</td>
          <td>${r.area.toLocaleString('es-VE')} m² + ${r.desperdicioPct}% desperdicio<span class="badge-est">${modPrecios ? 'precio modificado' : 'calculado'}</span></td>
          <td class="r">${r.areaConDesp.toFixed(2)} m²</td><td class="r">US$ ${fmt(r.precioM2)}/m²</td><td class="r">US$ ${fmt(r.materialImporte)}</td></tr>`,
        `<tr><td><strong>Fijaciones</strong>${sub(nombreTornillo)}</td>
          <td>${r.tornillosPorM2} unid./m²<span class="badge-est">estimado</span></td>
          <td class="r">${r.tornillosCant.toLocaleString('es-VE')} unid.</td><td class="r">US$ ${fmt(r.tornilloPrecio)}</td><td class="r">US$ ${fmt(r.tornillosImporte)}</td></tr>`
      );
      if (r.rematesDetalle) {
        r.rematesDetalle.forEach((d) => {
          const f = cat.flashings.find((x) => x.codigo === d.codigo);
          filas.push(`<tr><td><strong>Flashing ${esc(d.codigo)}</strong>${sub(f ? f.descripcion + ' — desarrollo ' + f.desarrollo + ' cm' : '')}</td>
            <td>Catálogo real<span class="badge-est">pieza exacta</span></td>
            <td class="r">${d.piezas}</td><td class="r">US$ ${fmt(d.precioUnit)}</td><td class="r">US$ ${fmt(d.piezas * d.precioUnit)}</td></tr>`);
        });
      } else {
        filas.push(`<tr><td><strong>Remates / Flashings</strong>${sub(nombreRemate + ' — se vende por pieza de 2,40 m')}</td>
          <td>Perímetro estimado: ${r.rematesMl.toLocaleString('es-VE')} ml → ${r.piezasRemate} pieza(s) de 2,40 m<span class="badge-est">estimado</span></td>
          <td class="r">${r.rematesMlFacturable.toLocaleString('es-VE')} ml</td><td class="r">US$ ${fmt(r.rematePrecio)}</td><td class="r">US$ ${fmt(r.rematesImporte)}</td></tr>`);
      }
    }
    if (r.incluirMontaje) {
      filas.push(`<tr><td><strong>Montaje</strong>${sub('Instalación de techo/pantalla y remates — cuadrillas propias')}</td>
        <td>${r.areaConDesp.toFixed(2)} m² + ${r.rematesMlFacturable.toLocaleString('es-VE')} ml<span class="badge-est">${montajeDef ? 'valor de lista' : 'ingresado manualmente'}</span></td>
        <td class="r">—</td><td class="r">US$ ${fmt(r.precioMontajeM2)}/m² + US$ ${fmt(r.precioMontajeMl)}/ml</td><td class="r">US$ ${fmt(r.montajeImporte)}</td></tr>`);
      if (r.gruaImporte > 0) {
        filas.push(`<tr><td><strong>Grúa de montaje</strong>${sub('Izaje — p. ej. standing seam')}</td>
          <td>${r.diasGrua} día(s)<span class="badge-est">ingresado manualmente</span></td>
          <td class="r">${r.diasGrua}</td><td class="r">US$ ${fmt(r.precioGruaDia)}/día</td><td class="r">US$ ${fmt(r.gruaImporte)}</td></tr>`);
      }
      if (r.andamios > 0) {
        filas.push(`<tr><td><strong>Andamios especiales</strong>${sub('Montaje de esta obra')}</td>
          <td>Estimado caso a caso<span class="badge-est">ingresado manualmente</span></td><td class="r">—</td><td class="r">—</td><td class="r">US$ ${fmt(r.andamios)}</td></tr>`);
      }
      if (r.supervisor > 0) {
        filas.push(`<tr><td><strong>Supervisor fijo en obra</strong>${sub('Montaje de esta obra')}</td>
          <td>Estimado caso a caso<span class="badge-est">ingresado manualmente</span></td><td class="r">—</td><td class="r">—</td><td class="r">US$ ${fmt(r.supervisor)}</td></tr>`);
      }
    }
    if (r.incluirFlete) {
      filas.push(`<tr><td><strong>Flete</strong>${sub('Transporte estimado para este despacho')}</td>
        <td>Estimado caso a caso<span class="badge-est">ingresado manualmente</span></td><td class="r">—</td><td class="r">—</td><td class="r">US$ ${fmt(r.fleteImporte)}</td></tr>`);
    }
    $('itemsBody').innerHTML = filas.join('');

    $('totalsBox').innerHTML = `
      <div class="r"><span>Subtotal</span><span>US$ ${fmt(r.subtotal)}</span></div>
      <div class="r"><span>IVA (${r.ivaPct}%)</span><span>US$ ${fmt(r.iva)}</span></div>
      <div class="r total"><span>Total</span><span>US$ ${fmt(r.total)}</span></div>
      ${r.totalBs ? `<div class="r bs"><span>Equivalente en Bs (tasa BCV ${fmt(r.tasaBcv)})</span><span>Bs ${fmt(r.totalBs)}</span></div>` : ''}`;

    const incl = r.incluirMontaje && r.incluirFlete ? 'Incluyen montaje y flete, según lo indicado en esta oferta.'
      : r.incluirMontaje ? 'Incluyen montaje; no incluyen flete — se cotiza por separado.'
      : r.incluirFlete ? 'Incluyen flete; no incluyen montaje — se cotiza por separado.'
      : 'No incluyen flete ni montaje — se cotizan por separado, caso a caso.';
    $('notesBox').innerHTML = `<strong>Notas:</strong> Precios ${S.pago === 'efectivo' ? 'de contado en efectivo USD' : 'en bolívares a tasa oficial BCV del día'}, sujetos a variación sin previo aviso. ${incl} Izaje/grúa no está incluido en ningún caso. Las cantidades de fijaciones y remates son estimadas: confirmar con el despiece técnico final antes de la orden de compra. Esta oferta no es un contrato.`;

    const cb = $('comentariosBox');
    cb.hidden = !ultima.comentarios;
    cb.innerHTML = `<strong>Comentarios / alcance:</strong>\n${esc(ultima.comentarios)}`;

    const ib = $('imagenBox');
    const conImagen = chk('incluirImagen') && S.imagen;
    ib.hidden = !conImagen;
    ib.innerHTML = conImagen ? `<img src="${S.imagen}" alt="Imagen del proyecto"><div class="cap">Visualización conceptual — no constituye plano técnico ni proyecto de ejecución.</div>` : '';

    // Vista interna
    const interna = puedeInterna && S.vista === 'interna';
    $('doc').dataset.vista = interna ? 'interna' : 'cliente';
    $('internaSection').hidden = !interna;
    $('confidencialFlag').style.display = interna ? 'block' : 'none';
    if (interna && !r.margenData) {
      $('marginBody').innerHTML = '';
      $('marginSummaryBox').innerHTML = '<div class="hint">Aún no hay costos cargados. Marca "Habilitar vista interna con costos y márgenes" e ingresa los costos de la obra.</div>';
    } else if (interna) {
      const m = r.margenData;
      $('marginBody').innerHTML = m.filas.map((f) => `<tr><td>${esc(f.nombre)}</td><td class="r">US$ ${fmt(f.venta)}</td><td class="r">US$ ${fmt(f.costo)}</td><td class="r">US$ ${fmt(f.margen)}</td><td class="r">${fmt(f.margenPct)}%</td><td class="r">${fmt(f.markupPct)}%</td></tr>`).join('');
      $('marginSummaryBox').innerHTML = `
        <div class="r"><span>Precio de venta (antes de IVA)</span><span>US$ ${fmt(m.subtotal)}</span></div>
        <div class="r"><span>Costo total de la obra</span><span>US$ ${fmt(m.costoTotal)}</span></div>
        <div class="r"><span>Ganancia</span><span>US$ ${fmt(m.margenUSD)}</span></div>
        <div class="r total"><span>Margen bruto (sobre venta)</span><span>${fmt(m.margenPct)}%</span></div>
        <div class="r total" style="border-top:none;padding-top:2px"><span>Markup (sobre costo)</span><span>${fmt(m.markupPct)}%</span></div>
        <div class="hint">Margen bruto = ganancia ÷ venta. Markup = ganancia ÷ costo.</div>`;
    }
  }

  // ---------- Exportar ----------
  function nombreArchivo() {
    const cliente = (ultima.cliente || 'oferta').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40);
    const codigo = (val('numOferta') || 'oferta').replace(/[^a-zA-Z0-9-]+/g, '_');
    return `Oferta_${cliente}_${codigo}`;
  }

  async function exportarPdf(vista) {
    if (ultima.precioFaltante) {
      toast('Hay un producto sin precio de lista confirmado — no se puede generar la oferta todavía.', 'error');
      return;
    }
    if (vista === 'interna' && !chk('incluirMargen')) {
      toast('Primero activa "Habilitar vista interna" e ingresa los costos de la obra.', 'error');
      return;
    }
    const anterior = S.vista;
    setVista(vista);
    if (window.centrolit) {
      // Escritorio: PDF real a disco vía Electron (printToPDF + diálogo de guardar).
      try {
        const r = await window.centrolit.exportarPdf({ nombre: nombreArchivo() + (vista === 'interna' ? '_INTERNA' : '') });
        if (r.saved) { toast('PDF guardado.'); if (vista === 'cliente') avanzarNumero(); }
      } catch (e) {
        toast('No se pudo generar el PDF: ' + e.message, 'error');
      } finally {
        setVista(anterior);
      }
      return;
    }
    // Web: diálogo de impresión del navegador (el usuario elige "Guardar como PDF"). El CSS de
    // impresión ya oculta todo salvo el documento de la oferta. No hay confirmación de guardado,
    // así que aquí no se avanza el número de oferta automáticamente.
    setTimeout(() => window.print(), 50);
    window.addEventListener('afterprint', () => setVista(anterior), { once: true });
  }

  // ---------- Exportar a Excel en el navegador (sin librerías) ----------
  // Mismo formato SpreadsheetML que usaba el cotizador original: un XML que Excel abre de forma
  // nativa (puede avisar de que "el formato no coincide con la extensión"; es normal, se acepta).
  // En escritorio se prefiere un .xlsx real vía Electron+exceljs (ver exportarExcel()).
  function xmlEsc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function xCell(value, styleId, type) {
    const t = type || (typeof value === 'number' ? 'Number' : 'String');
    const val = t === 'Number' ? (isFinite(value) ? value : 0) : xmlEsc(value).replace(/\n/g, '&#10;');
    return `<Cell${styleId ? ` ss:StyleID="${styleId}"` : ''}><Data ss:Type="${t}">${val}</Data></Cell>`;
  }
  const xRow = (cells) => `<Row>${cells.join('')}</Row>`;

  function exportarExcelNavegador(d) {
    const rows = [];
    rows.push(xRow([xCell('Grupo Centrolit — Propuesta Técnico-Comercial', 'sTitle')]));
    rows.push(xRow([xCell(d.docNum, 'sBold')]));
    rows.push(xRow([]));
    rows.push(xRow([xCell('Cliente:', 'sLabel'), xCell(d.cliente), xCell('RIF:', 'sLabel'), xCell(d.clienteRif)]));
    rows.push(xRow([xCell('Ubicación:', 'sLabel'), xCell(d.ubicacion), xCell('Proyecto:', 'sLabel'), xCell(d.proyecto)]));
    rows.push(xRow([xCell('Dirección fiscal:', 'sLabel'), xCell(d.direccionFiscal), xCell('Dirección de entrega:', 'sLabel'), xCell(d.direccionEntrega)]));
    rows.push(xRow([xCell('Forma de pago:', 'sLabel'), xCell(d.pago), xCell('Tipo de obra:', 'sLabel'), xCell(d.tipoObra)]));
    rows.push(xRow([xCell('Contacto:', 'sLabel'), xCell(d.contacto), xCell('Fecha:', 'sLabel'), xCell(d.fecha)]));
    rows.push(xRow([]));
    if (d.comentarios) {
      rows.push(xRow([xCell('Comentarios / alcance:', 'sBold')]));
      rows.push(xRow([xCell(d.comentarios, 'sWrap')]));
      rows.push(xRow([]));
    }
    rows.push(xRow(['Concepto', 'Detalle', 'Cantidad', 'Precio unit. (US$)', 'Importe (US$)'].map((h) => xCell(h, 'sHeader'))));
    if (d.secciones) {
      d.secciones.forEach((s) => {
        rows.push(xRow([xCell('— ' + s.nombre + ' —', 'sBold')]));
        rows.push(xRow([xCell('Material'), xCell(''), xCell(`${s.areaConDesp.toFixed(2)} m²`), xCell(s.precioM2, 'sMoney', 'Number'), xCell(s.materialImporte, 'sMoney', 'Number')]));
        rows.push(xRow([xCell('Fijaciones'), xCell(''), xCell(`${s.tornillosCant} unid.`), xCell(s.tornilloPrecio, 'sMoney', 'Number'), xCell(s.tornillosImporte, 'sMoney', 'Number')]));
        rows.push(xRow([xCell('Remates / Flashings'), xCell(''), xCell(`${s.rematesMlFacturable} ml`), xCell(s.rematePrecio, 'sMoney', 'Number'), xCell(s.rematesImporte, 'sMoney', 'Number')]));
        rows.push(xRow([xCell(''), xCell(''), xCell(''), xCell('Subtotal de esta sección', 'sLabel'), xCell(s.materialImporte + s.tornillosImporte + s.rematesImporte, 'sMoney', 'Number')]));
      });
    } else {
      rows.push(xRow([
        xCell(d.productoNombre), xCell(`${d.catLabel}${d.ancho ? ' · ancho útil ' + d.ancho + ' m' : ''}`),
        xCell(`${d.areaConDesp.toFixed(2)} m²`), xCell(d.precioM2, 'sMoney', 'Number'), xCell(d.materialImporte, 'sMoney', 'Number'),
      ]));
      rows.push(xRow([
        xCell('Fijaciones'), xCell('Tornillo autotaladrante — fijación estándar'),
        xCell(`${d.tornillosCant} unid.`), xCell(d.tornilloPrecio, 'sMoney', 'Number'), xCell(d.tornillosImporte, 'sMoney', 'Number'),
      ]));
      if (d.rematesDetalle) {
        d.rematesDetalle.forEach((f) => {
          rows.push(xRow([xCell('Flashing ' + f.codigo), xCell('Catálogo real'), xCell(f.piezas), xCell(f.precioUnit, 'sMoney', 'Number'), xCell(f.piezas * f.precioUnit, 'sMoney', 'Number')]));
        });
      } else {
        rows.push(xRow([
          xCell('Remates / Flashings'), xCell(`${d.rematesMl} ml → ${d.piezasRemate} pieza(s) de 2,40 m`),
          xCell(`${d.rematesMlFacturable} ml`), xCell(d.rematePrecio, 'sMoney', 'Number'), xCell(d.rematesImporte, 'sMoney', 'Number'),
        ]));
      }
    }
    if (d.incluirMontaje) {
      rows.push(xRow([
        xCell('Montaje'), xCell('Instalación de techo/pantalla y remates — cuadrillas propias'),
        xCell(`${d.areaConDesp.toFixed(2)} m² + ${d.rematesMlFacturable} ml`), xCell(''), xCell(d.montajeImporte, 'sMoney', 'Number'),
      ]));
      if (d.gruaImporte > 0) {
        rows.push(xRow([
          xCell('Grúa de montaje'), xCell('Izaje — p. ej. standing seam'),
          xCell(`${d.diasGrua} día(s)`), xCell(d.precioGruaDia, 'sMoney', 'Number'), xCell(d.gruaImporte, 'sMoney', 'Number'),
        ]));
      }
      if (d.andamios > 0) {
        rows.push(xRow([xCell('Andamios especiales'), xCell('Montaje de esta obra'), xCell('Estimado caso a caso'), xCell(''), xCell(d.andamios, 'sMoney', 'Number')]));
      }
      if (d.supervisor > 0) {
        rows.push(xRow([xCell('Supervisor fijo en obra'), xCell('Montaje de esta obra'), xCell('Estimado caso a caso'), xCell(''), xCell(d.supervisor, 'sMoney', 'Number')]));
      }
    }
    if (d.incluirFlete) {
      rows.push(xRow([
        xCell('Flete'), xCell('Transporte estimado para este despacho'),
        xCell('Estimado caso a caso'), xCell(''), xCell(d.fleteImporte, 'sMoney', 'Number'),
      ]));
    }
    rows.push(xRow([]));
    rows.push(xRow([xCell(''), xCell(''), xCell(''), xCell('Subtotal', 'sLabel'), xCell(d.subtotal, 'sMoney', 'Number')]));
    rows.push(xRow([xCell(''), xCell(''), xCell(''), xCell(`IVA (${d.ivaPct}%)`, 'sLabel'), xCell(d.iva, 'sMoney', 'Number')]));
    rows.push(xRow([xCell(''), xCell(''), xCell(''), xCell('TOTAL', 'sBold'), xCell(d.total, 'sMoneyBold', 'Number')]));
    if (d.totalBs) {
      rows.push(xRow([xCell(''), xCell(''), xCell(''), xCell(`Equivalente en Bs (tasa BCV ${d.tasaBcv})`, 'sLabel'), xCell(d.totalBs, 'sMoney', 'Number')]));
    }
    rows.push(xRow([]));
    rows.push(xRow([xCell('Precios sujetos a variación sin previo aviso. Izaje/grúa nunca incluido. Cantidades de fijaciones y remates son estimadas — confirmar con el despiece técnico final antes de la orden de compra. Esta oferta no es un contrato.', 'sWrap')]));

    const sheetCliente = `<Worksheet ss:Name="Cliente"><Table ss:DefaultColumnWidth="130">
      <Column ss:Width="180"/><Column ss:Width="260"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="110"/>
      ${rows.join('\n')}</Table></Worksheet>`;

    let sheetInterna = '';
    if (d.incluirMargen && d.margenData) {
      const m = d.margenData;
      const irows = [];
      irows.push(xRow([xCell('CONFIDENCIAL — USO INTERNO GRUPO CENTROLIT — NO ENTREGAR AL CLIENTE', 'sConfid')]));
      irows.push(xRow([]));
      irows.push(xRow(['Concepto', 'Precio venta (US$)', 'Costo (US$)', 'Ganancia (US$)', 'Margen bruto (%)', 'Markup (%)'].map((h) => xCell(h, 'sHeaderInterna'))));
      m.filas.forEach((f) => {
        irows.push(xRow([
          xCell(f.nombre), xCell(f.venta, 'sMoney', 'Number'), xCell(f.costo, 'sMoney', 'Number'),
          xCell(f.margen, 'sMoney', 'Number'), xCell(f.margenPct / 100, 'sPct', 'Number'), xCell(f.markupPct / 100, 'sPct', 'Number'),
        ]));
      });
      irows.push(xRow([]));
      irows.push(xRow([xCell('Precio de venta (subtotal antes de IVA)', 'sLabel'), xCell(m.subtotal, 'sMoney', 'Number')]));
      irows.push(xRow([xCell('Costo total de la obra', 'sLabel'), xCell(m.costoTotal, 'sMoney', 'Number')]));
      irows.push(xRow([xCell('Ganancia (US$)', 'sLabel'), xCell(m.margenUSD, 'sMoney', 'Number')]));
      irows.push(xRow([xCell('Margen bruto (sobre venta)', 'sBold'), xCell(m.margenPct / 100, 'sPctBold', 'Number')]));
      irows.push(xRow([xCell('Markup (sobre costo)', 'sBold'), xCell(m.markupPct / 100, 'sPctBold', 'Number')]));
      irows.push(xRow([]));
      irows.push(xRow([xCell('Margen bruto = ganancia ÷ precio de venta. Markup = ganancia ÷ costo. Son fórmulas distintas sobre la misma ganancia en US$.', 'sWrap')]));
      sheetInterna = `<Worksheet ss:Name="Interna (Confidencial)"><Table ss:DefaultColumnWidth="130">
        <Column ss:Width="260"/><Column ss:Width="120"/><Column ss:Width="120"/><Column ss:Width="120"/><Column ss:Width="120"/><Column ss:Width="100"/>
        ${irows.join('\n')}</Table></Worksheet>`;
    }

    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>
  <Style ss:ID="sTitle"><Font ss:FontName="Cambria" ss:Size="14" ss:Bold="1" ss:Color="#1B2A3A"/></Style>
  <Style ss:ID="sBold"><Font ss:Bold="1"/></Style>
  <Style ss:ID="sLabel"><Font ss:Bold="1" ss:Color="#5C6B77"/></Style>
  <Style ss:ID="sWrap"><Alignment ss:WrapText="1" ss:Vertical="Top"/></Style>
  <Style ss:ID="sHeader"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1B2A3A" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sHeaderInterna"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7A4D16" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sConfid"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7A4D16" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sMoney"><NumberFormat ss:Format="&quot;US$&quot; #,##0.00"/></Style>
  <Style ss:ID="sMoneyBold"><Font ss:Bold="1"/><NumberFormat ss:Format="&quot;US$&quot; #,##0.00"/></Style>
  <Style ss:ID="sPct"><NumberFormat ss:Format="0.00%"/></Style>
  <Style ss:ID="sPctBold"><Font ss:Bold="1" ss:Color="#7A4D16"/><NumberFormat ss:Format="0.00%"/></Style>
 </Styles>
 ${sheetCliente}
 ${sheetInterna}
</Workbook>`;

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo() + '.xls';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportarExcel() {
    calcular();
    if (ultima.precioFaltante) {
      toast('Hay un producto sin precio de lista confirmado — no se puede generar la oferta todavía.', 'error');
      return;
    }
    if (window.centrolit) {
      // Escritorio: .xlsx real vía Electron+exceljs (diálogo de guardar nativo).
      try {
        const r = await window.centrolit.exportarXlsx({ nombre: nombreArchivo(), oferta: ultima });
        if (r.saved) { toast('Excel guardado.'); avanzarNumero(); }
      } catch (e) {
        toast('No se pudo generar el Excel: ' + e.message, 'error');
      }
      return;
    }
    // Web: igual que el cotizador original — XML SpreadsheetML generado en el navegador, sin
    // librerías ni servidor, descargado directamente como .xls.
    try {
      exportarExcelNavegador(ultima);
      toast('Excel descargado.');
    } catch (e) {
      toast('No se pudo generar el Excel: ' + e.message, 'error');
    }
  }

  // ---------- Guardado local de ofertas (reabrir/editar más tarde — puntos 6 y 8 del feedback) ----------
  // Decisión 2026-10-15: local por ahora (no Drive/Sheet). Escritorio: fichero JSON por oferta en
  // userData/ofertas. Web: localStorage (sin backend); limitado por la cuota del navegador (~5-10 MB).
  const LS_OFERTAS = 'centrolit.ofertasGuardadas';
  function lsLeerOfertas() {
    try { return JSON.parse(localStorage.getItem(LS_OFERTAS) || '[]'); } catch { return []; }
  }
  function lsEscribirOfertas(arr) {
    try { localStorage.setItem(LS_OFERTAS, JSON.stringify(arr)); } catch { throw new Error('Memoria local del navegador llena o no disponible.'); }
  }
  async function ofertasListarImpl() {
    if (window.centrolit) return window.centrolit.ofertasListar();
    return lsLeerOfertas().map(({ id, numOferta, cliente, proyecto, guardadoEn }) => ({ id, numOferta, cliente, proyecto, guardadoEn }));
  }
  async function ofertasCargarImpl(id) {
    if (window.centrolit) return window.centrolit.ofertasCargar(id);
    const r = lsLeerOfertas().find((x) => x.id === id);
    if (!r) throw new Error('Esa oferta ya no existe.');
    return r;
  }
  async function ofertasGuardarImpl(record) {
    if (window.centrolit) return window.centrolit.ofertasGuardar(record);
    const arr = lsLeerOfertas();
    const id = record.id || `o_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const full = { ...record, id, guardadoEn: new Date().toISOString() };
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr[i] = full; else arr.push(full);
    lsEscribirOfertas(arr);
    return { id, guardadoEn: full.guardadoEn };
  }
  async function ofertasEliminarImpl(id) {
    if (window.centrolit) return window.centrolit.ofertasEliminar(id);
    lsEscribirOfertas(lsLeerOfertas().filter((x) => x.id !== id));
    return true;
  }

  async function guardarOferta() {
    try {
      const record = {
        id: S.ofertaId || undefined,
        numOferta: val('numOferta'), cliente: val('cliente') || '(sin nombre)', proyecto: val('proyecto') || '',
        campos: snapshot(), modo: S.modo, pago: S.pago, imagen: S.imagen, plano: S.plano, secciones: S.secciones,
        remateModo: S.remateModo, flashingsItems: S.flashingsItems,
      };
      const r = await ofertasGuardarImpl(record);
      S.ofertaId = r.id;
      toast('Oferta guardada en este equipo.');
    } catch (e) {
      toast('No se pudo guardar la oferta: ' + e.message, 'error');
    }
  }

  async function cargarOfertaEnFormulario(id) {
    try {
      const r = await ofertasCargarImpl(id);
      S.modo = r.modo || 'm2';
      S.pago = r.pago || 'efectivo';
      S.secciones = r.secciones || [];
      S.remateModo = r.remateModo || 'estimado';
      S.flashingsItems = r.flashingsItems || [];
      restaurar(r.campos || {});
      S.imagen = r.imagen || null;
      S.plano = r.plano || null;
      S.ofertaId = r.id;
      actualizarPlanoHint();
      calcular();
      toast('Oferta cargada — puedes seguir editándola.');
    } catch (e) {
      toast('No se pudo abrir la oferta: ' + e.message, 'error');
    }
  }

  async function eliminarOfertaGuardada(id) {
    try {
      await ofertasEliminarImpl(id);
      if (S.ofertaId === id) S.ofertaId = null;
      toast('Oferta eliminada.');
    } catch (e) {
      toast('No se pudo eliminar: ' + e.message, 'error');
    }
  }

  function cerrarPanelOfertas() {
    document.getElementById('ofertasOverlay')?.remove();
  }

  async function abrirPanelOfertas() {
    let ofertas;
    try {
      ofertas = await ofertasListarImpl();
    } catch (e) {
      toast('No se pudieron listar las ofertas guardadas: ' + e.message, 'error');
      return;
    }
    cerrarPanelOfertas();
    const overlay = document.createElement('div');
    overlay.id = 'ofertasOverlay';
    overlay.className = 'ofertas-overlay';
    overlay.innerHTML = `<div class="ofertas-panel">
      <div class="ofertas-panel-head"><h3>Ofertas guardadas en este equipo</h3><button type="button" class="link" id="ofertasCerrar">cerrar ✕</button></div>
      ${ofertas.length ? `<div class="ofertas-lista">${ofertas.map((o) => `
        <div class="ofertas-fila">
          <div><strong>${esc(o.cliente || '(sin cliente)')}</strong><div class="sub-line">${esc(o.numOferta || '')}${o.proyecto ? ' · ' + esc(o.proyecto) : ''} · ${esc(fmtFechaHora(o.guardadoEn))}</div></div>
          <div><button type="button" class="btn" data-abrir="${esc(o.id)}">Abrir</button> <button type="button" class="btn" data-eliminar="${esc(o.id)}">Eliminar</button></div>
        </div>`).join('')}</div>` : '<div class="hint">Todavía no hay ninguna oferta guardada en este equipo.</div>'}
    </div>`;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.id === 'ofertasCerrar') { cerrarPanelOfertas(); return; }
      const abrirId = e.target.dataset.abrir;
      if (abrirId) { cerrarPanelOfertas(); cargarOfertaEnFormulario(abrirId); return; }
      const delId = e.target.dataset.eliminar;
      if (delId && confirm('¿Eliminar esta oferta guardada? No se puede deshacer.')) {
        eliminarOfertaGuardada(delId).then(abrirPanelOfertas);
      }
    });
    document.body.appendChild(overlay);
  }

  return { mount };
})();

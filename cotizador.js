'use strict';
// Módulo Cotizador. La lógica de cálculo vive en src/shared/cotizador-engine.js (pura y con tests);
// aquí solo hay UI: formulario, vista previa de la oferta y exportación.

const Cotizador = (() => {
  const TIPOS_OBRA_DEFECTO = ['Nave industrial / galpón', 'Centro comercial / local comercial', 'Institucional', 'Vivienda / residencial', 'Retechado', 'Otro'];

  let root, cat, params, textos, tiposObra, puedeInterna;
  let S = { pago: 'efectivo', modo: 'm2', vista: 'cliente', imagen: null, plano: null, autoComentario: '', autoNumero: '', secciones: [], remateModo: 'estimado', flashingsItems: [], partidas: [], fletes: [], despiece: null };
  let ultima = null;

  const $ = (id) => root.querySelector('#' + id);
  const val = (id) => $(id).value;
  const chk = (id) => $(id).checked;

  // ---------- Catálogo a partir de la lista de precios ----------
  function construirCatalogo(data) {
    const out = {};
    const montaje = {};
    for (const p of data.productos) {
      (out[p.categoria] ??= []).push({ n: p.producto, ancho: p.ancho_util || null, anchoFisico: p.ancho_fisico || null, efectivo: p.precio_efectivo, bcv: p.precio_bcv });
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

  // Separa el párrafo de alcance ("A continuación...") de las notas numeradas (forma de pago,
  // despacho, etc.) — pedido real, nov 2026: el alcance va arriba sin título "Comentarios/alcance",
  // las notas numeradas se muestran al final junto con "Notas". Si el texto no trae el marcador
  // "Notas:" (p. ej. el usuario lo borró al editar), todo se trata como alcance, como antes.
  function splitComentario(texto) {
    const marcador = '\nNotas:\n';
    const idx = (texto || '').indexOf(marcador);
    if (idx === -1) return { alcance: (texto || '').trim(), notas: '' };
    return { alcance: texto.slice(0, idx).trim(), notas: texto.slice(idx + marcador.length).trim() };
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
      <div id="calcOrigenHint" class="hint" hidden style="background:#eef6ff;border:1px solid #bcd8f5;border-radius:6px;padding:8px;margin-bottom:10px">
        📐 Estos valores vinieron de la Calculadora. El modo (m²/metros lineales) ya se ajustó solo
        según el producto elegido — no hace falta tocarlo, solo revisa el resultado abajo.
        <button type="button" class="link" id="calcOrigenCerrar" style="margin-left:6px">cerrar</button>
      </div>
      <label class="chk"><input type="checkbox" id="incluirSecciones"> Cotizar por secciones (varias aguas, o techo + pantalla por separado)</label>
      <div class="hint">Úsalo cuando el techo tiene aguas de distinto tamaño, son varios techos que el cliente quiere ver por etapas, o hay techo y pantalla con sistemas distintos.</div>
      <div id="seccionUnicaBox">
        <label>Sistema</label><select id="categoria"></select>
        <label>Producto</label><select id="producto"></select>
        <label>Nombre del producto en la oferta (opcional, vacío = usa el nombre del catálogo)</label>
        <input type="text" id="nombreProductoManual" placeholder="auto">
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
          <div><label id="precioMaterialManualLabel">Material (US$/m²)</label><input type="number" id="precioMaterialManual" step="0.01" min="0"></div>
          <div><label>Kit de fijación (US$/unid.)</label><input type="number" id="precioTornilloManual" step="0.01" min="0"></div>
        </div>
        <label>Remate — modo Estimado (US$/ml)</label><input type="number" id="precioRemateManual" step="0.01" min="0">
        <div class="hint" id="precioRemateManualHint">Solo aplica si "Remates/flashings" está en modo Estimado (ml). En modo Detallado, cada flashing tiene su propio precio editable en su propia lista.</div>
        <div class="hint">Sustituyen a la lista oficial solo para esta oferta. En modo secciones se aplican a todas por igual.</div>
      </div>
    </div>

    <div class="card"><h2><span class="dot"></span>Ajustes de cálculo</h2>
      <div class="row2">
        <div><label>Desperdicio (%)</label><input type="number" id="desperdicio" min="0" max="30" step="0.5"></div>
        <div><label>Tornillos / m²</label><input type="number" id="tornillos" min="0" step="0.5"></div>
      </div>
      <div id="tornillosManualWrap">
        <label class="chk"><input type="checkbox" id="tornillosManualChk"> Cantidad manual de tornillos (ignora el área — varía por estructura, no siempre es proporcional)</label>
        <div class="manual-box" id="tornillosManualBox" hidden>
          <label>Cantidad de tornillos</label><input type="number" id="tornillosCantManual" min="0" step="1" value="0">
        </div>
      </div>
      ${cat.fijaciones.length ? `
      <label>Fijación específica (catálogo real, opcional)</label>
      <select id="fijacionCatalogo"><option value="">— usar precio de tornillo general —</option>${cat.fijaciones.map((f, i) => `<option value="${i}">${esc(f.nombre)}${f.uso ? ' — ' + esc(f.uso) : ''} — US$ ${fmt(f.efectivo)}</option>`).join('')}</select>
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
      <div class="hint" id="remateSeccionesHint" hidden>Con "Cotizar por secciones" activo: el remate "Estimado (ml)" se ingresa dentro de cada sección (más abajo). Los flashings del catálogo real de arriba aplican a TODA la oferta (no por sección) y, si los usas, reemplazan el estimado de cada sección — no se suman ambos.</div>
      <label class="chk"><input type="checkbox" id="incluirMontaje"> Incluir montaje en esta oferta</label>
      <div class="manual-box" id="montajeBox" hidden>
        <div class="row2">
          <div><label>Montaje techo (US$/m²)</label><input type="number" id="precioMontajeM2" step="0.01" min="0" value="0"></div>
          <div><label>Montaje remates (US$/ml)</label><input type="number" id="precioMontajeMl" step="0.01" min="0" value="0"></div>
        </div>
        <div class="hint">Precargado solo para productos con precio de montaje en la lista. Si no, se ingresa a mano.</div>
        <label>m² de montaje — manual (opcional, vacío = usa el área calculada del material)</label>
        <input type="number" id="montajeAreaManual" step="1" min="0" placeholder="auto">
        <div class="hint">Úsalo cuando en obra hay que cortar una lámina para que quede a ras de la estructura — el m² real de montaje puede no coincidir con el calculado. No afecta el precio del material, solo el de montaje.</div>
        <label>ml de montaje de remates — manual (opcional, vacío = usa el ml estimado/detallado de arriba)</label>
        <input type="number" id="montajeRematesMlManual" step="1" min="0" placeholder="auto">
        <div class="hint">Igual que el m² de montaje de arriba, pero para los flashings: úsalo cuando el ml real instalado no coincide con el calculado. No afecta el costo de los flashings en sí, solo el de su montaje.</div>
        <div class="row2">
          <div><label>m² de pantalla (opcional)</label><input type="number" id="montajePantallaArea" step="1" min="0" value="0"></div>
          <div><label>Montaje pantalla (US$/m²)</label><input type="number" id="montajePantallaPrecioM2" step="0.01" min="0" value="0"></div>
        </div>
        <div class="hint">Para obras con techo y pantalla cotizados juntos, cuando el montaje de la pantalla se factura aparte del techo. Solo aparece en la oferta si pones m² aquí.</div>
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
        <div id="fletesLista"></div>
        <div class="hint">El flete varía por destino: se ingresa caso a caso. Agrega una línea por cada vehículo cuando usas varios con precios distintos (p. ej. 2 gandolas + 1 camión 750).</div>
      </div>
      <div class="row2">
        <div><label>IVA (%)</label><input type="number" id="iva" min="0" step="0.5"></div>
        <div><label>Tasa BCV (Bs/US$)</label><input type="number" id="tasabcv" placeholder="Tasa del día"></div>
      </div>
      <div class="hint">Verifica IVA y tasa BCV vigentes al cotizar.</div>
    </div>

    <div class="card"><h2><span class="dot"></span>Partidas adicionales (opcional)</h2>
      <div class="hint">Para lo que no encaja en m²/ml: extractores eólicos, un tornillo puntual para una conexión, un flashing que todavía no está en el catálogo, etc.</div>
      <div id="partidasLista"></div>
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
    <div class="hint">Guardado solo en este equipo (ver "Plano del cliente" arriba). Permite reabrir y seguir editando una oferta más tarde.</div>
    <div class="btnrow"><button class="btn" data-act="pasar-a-pedido">📦 Pasar a pedido</button></div>
    <div class="hint">Registra esta oferta como pedido en la pestaña "Pedidos", para seguimiento del equipo.</div>`;
  }

  function docHtml() {
    return `
    <div class="doc" id="doc" data-vista="cliente">
      <div class="interna-only-flag" id="confidencialFlag">CONFIDENCIAL — USO INTERNO GRUPO CENTROLIT</div>
      <div class="doc-head">
        <div class="doc-head-logo"><img src="${S.logoSrc}" alt="Centrolit">
          <div class="doc-head-info" id="empresaInfo"></div></div>
        <div class="meta"><div class="numoferta" id="docNum"></div><div id="docFecha"></div></div>
      </div>
      <div class="doc-title">Propuesta Técnico-Comercial</div>
      <div class="doc-info" id="docInfo"></div>
      <div class="doc-comentarios" id="comentariosBox" hidden></div>
      <div class="doc-image" id="imagenBox" hidden></div>
      <div class="screen-only-note">Nota interna (no se imprime): las etiquetas "calculado", "estimado", "valor de lista", etc. solo se ven en pantalla; en el PDF de la Vista Cliente no aparecen.</div>
      <table class="items"><thead><tr><th>Descripción</th><th class="r">Cantidad</th><th class="r">Precio unit.</th><th class="r">Importe (US$)</th></tr></thead><tbody id="itemsBody"></tbody></table>
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
  function mount(container, { precios, acceso, empresa, logoSrc, email, pedidosFileId, demo }) {
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
    S.email = email || '';
    S.pedidosFileId = pedidosFileId || '';
    S.demo = !!demo;

    root.innerHTML = `<div class="cot-grid">
      <div class="cot-form">${formHtml()}</div>
      <div>${puedeInterna ? `<div class="viewToggle" id="viewToggle"><button data-v="cliente" class="active cliente">Vista Cliente</button><button data-v="interna" class="interna">Vista Interna (Dirección)</button></div>` : ''}${docHtml()}</div>
    </div>`;

    $('categoria').innerHTML = Object.keys(cat.categorias).map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
    $('tipoObra').innerHTML = tiposObra.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    poblarProductos();
    renderPartidas();

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

  // Paneles/láminas se cotizan por ml (precio de lista dividido por ancho útil), Standing Seam
  // por m² directo (sin ancho útil) — ver docs/HOJAS-GOOGLE.md > 1. El modo de medición debe
  // coincidir con esto siempre; dejarlo en manos del usuario era la causa real de la "confusión
  // entre m² y ml" reportada por el equipo comercial (audio), no un error de cálculo.
  function modoDeProducto(p) {
    return p && p.ancho ? 'ml' : 'm2';
  }

  // El motor siempre calcula material en m² (es la unidad común para desperdicio/montaje), pero el
  // documento debe MOSTRAR la unidad real de cotización: ml para paneles, m² para Standing Seam
  // (punto de feedback de Violeta, nov 2026: "en la calculadora sí aparece en metro lineal...
  // debería ser lo mismo en el detalle del Cotizador"). precioM2 ya es US$/m² (precio de lista
  // dividido por ancho útil, ver precioM2Lista()); multiplicarlo de vuelta por anchoUtil da el
  // precio de lista original por ml, sin tener que volver a consultar el producto.
  function cantidadComoModo(modo, anchoUtil, areaValor) {
    return modo === 'ml' && anchoUtil > 0 ? `${(areaValor / anchoUtil).toFixed(2)} ml` : `${areaValor.toFixed(2)} m²`;
  }
  function unidadMaterial(modo, anchoUtil, areaConDesp, precioM2) {
    const esMl = modo === 'ml' && anchoUtil > 0;
    return {
      cantidadTxt: cantidadComoModo(modo, anchoUtil, areaConDesp),
      precioValor: esMl ? precioM2 * anchoUtil : precioM2,
      precioSufijo: esMl ? '/ml' : '/m²',
    };
  }

  function nuevaSeccion() {
    const pv = productosPlanos()[0]?.value || '';
    return { id: 's' + Math.random().toString(36).slice(2, 8), nombre: '', nombreManual: '', pv, modo: modoDeProducto(productoPorValor(pv)), area: 0, mlLargo: 0, mlAncho: 0, rematesMl: 0, tornillosCantManual: '' };
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
        <div class="row2">
          <div><label>Nombre del producto en la oferta (opcional, vacío = usa el nombre del catálogo)</label><input type="text" class="sec-nombre-producto" data-idx="${idx}" value="${esc(s.nombreManual || '')}" placeholder="auto"></div>
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
        <label>Remates/flashings de esta sección (ml, estimado — ver también "Flashings" más abajo)</label><input type="number" class="sec-remates" data-idx="${idx}" value="${s.rematesMl || 0}" min="0" step="1">
        <label>Tornillos — cantidad manual de esta sección (opcional, vacío = usar "Tornillos/m²" de arriba)</label><input type="number" class="sec-tornillos-manual" data-idx="${idx}" value="${s.tornillosCantManual || ''}" min="0" step="1" placeholder="auto">
      </div>`).join('') + '<button type="button" class="btn" id="agregarSeccion">+ Agregar sección</button>';
  }

  function areaSeccion(s) {
    return s.modo === 'ml' ? (parseFloat(s.mlLargo) || 0) * (parseFloat(s.mlAncho) || 0) : parseFloat(s.area) || 0;
  }

  // ---------- Flashings detallados (catálogo real, punto 4 del feedback) ----------
  function nuevoFlashingItem() {
    return { id: 'f' + Math.random().toString(36).slice(2, 8), idx: 0, piezas: 0, precioManual: '' };
  }
  // Precio efectivo de un flashing: el manual si se puso uno, si no el del catálogo real — pedido
  // real del equipo comercial (nov 2026): "al igual que material y tornillos, el precio de los
  // remates también debería poder cambiarse manualmente" (antes solo funcionaba en modo Estimado,
  // no en Detallado, donde cada pieza venía fija del catálogo sin forma de corregirla caso a caso).
  function precioFlashingEfectivo(it, f) {
    return it.precioManual !== '' && it.precioManual != null ? parseFloat(it.precioManual) || 0 : (f ? f[S.pago] : 0);
  }
  function renderFlashings() {
    const cont = $('flashingsLista');
    if (!cont) return;
    cont.innerHTML = S.flashingsItems.map((it, i) => {
      const f = cat.flashings[it.idx];
      return `
      <div class="flashing-row" data-idx="${i}">
        <div class="row2">
          <div><label>Flashing</label><select class="fl-codigo" data-idx="${i}">${cat.flashings.map((fc, fi) => `<option value="${fi}" ${fi === it.idx ? 'selected' : ''}>${esc(fc.codigo)} — ${esc(fc.descripcion)} (desarrollo ${esc(fc.desarrollo)} cm) — US$ ${fmt(fc.efectivo)}</option>`).join('')}</select></div>
          <div><label>Piezas</label><input type="number" class="fl-piezas" data-idx="${i}" value="${it.piezas || 0}" min="0" step="1"></div>
        </div>
        <label>Precio unit. (US$, opcional — vacío = precio de catálogo real US$ ${fmt(f ? f[S.pago] : 0)})</label>
        <input type="number" class="fl-precio" data-idx="${i}" value="${it.precioManual || ''}" min="0" step="0.01" placeholder="US$ ${fmt(f ? f[S.pago] : 0)}">
        <button type="button" class="link fl-eliminar" data-idx="${i}">eliminar ✕</button>
      </div>`;
    }).join('') + '<button type="button" class="link" id="agregarFlashing">+ agregar otro flashing</button>';
  }

  // ---------- Partidas adicionales: líneas manuales para lo que no encaja en m²/ml ----------
  // (extractores eólicos, un tornillo puntual para una conexión, un flashing fuera de catálogo —
  // pedido real del equipo comercial en audio, confirmado con la cotización Nitroven SSA).
  function nuevaPartida() {
    return { id: 'p' + Math.random().toString(36).slice(2, 8), descripcion: '', cantidad: 0, unidad: 'unid', precioUnit: 0, costoUnit: 0 };
  }
  function renderPartidas() {
    const cont = $('partidasLista');
    if (!cont) return;
    const conCosto = puedeInterna && chk('incluirMargen');
    cont.innerHTML = S.partidas.map((x, idx) => `
      <div class="partida-row" data-idx="${idx}">
        <div class="row2">
          <div><label>Descripción</label><input type="text" class="pa-desc" data-idx="${idx}" value="${esc(x.descripcion)}" placeholder='Extractor eólico 24&quot;'></div>
          <div><label>Unidad</label><input type="text" class="pa-unidad" data-idx="${idx}" value="${esc(x.unidad)}" placeholder="unid"></div>
        </div>
        <div class="row2">
          <div><label>Cantidad</label><input type="number" class="pa-cant" data-idx="${idx}" value="${x.cantidad || 0}" min="0" step="1"></div>
          <div><label>Precio unitario (US$)</label><input type="number" class="pa-precio" data-idx="${idx}" value="${x.precioUnit || 0}" min="0" step="0.01"></div>
        </div>
        ${conCosto ? `<label>Costo unitario (US$, uso interno)</label><input type="number" class="pa-costo" data-idx="${idx}" value="${x.costoUnit || 0}" min="0" step="0.01">` : ''}
        <button type="button" class="link pa-eliminar" data-idx="${idx}">eliminar ✕</button>
      </div>`).join('') + '<button type="button" class="btn" id="agregarPartida">+ Agregar partida</button>';
  }

  // ---------- Flete: varias líneas (p. ej. 2 gandolas + 1 camión 750, cada una con su propio
  // precio — feedback real, nov 2026, en vez de un monto único). ----------
  function nuevoFlete() {
    return { id: 'ft' + Math.random().toString(36).slice(2, 8), descripcion: '', cantidad: 1, precioUnit: 0 };
  }
  function renderFletes() {
    const cont = $('fletesLista');
    if (!cont) return;
    cont.innerHTML = S.fletes.map((x, idx) => `
      <div class="partida-row" data-idx="${idx}">
        <div class="row2">
          <div><label>Descripción</label><input type="text" class="ft-desc" data-idx="${idx}" value="${esc(x.descripcion)}" placeholder="Gandola 1, Camión 750…"></div>
          <div><label>Cantidad</label><input type="number" class="ft-cant" data-idx="${idx}" value="${x.cantidad || 0}" min="0" step="1"></div>
        </div>
        <label>Precio (US$)</label><input type="number" class="ft-precio" data-idx="${idx}" value="${x.precioUnit || 0}" min="0" step="1">
        <button type="button" class="link ft-eliminar" data-idx="${idx}">eliminar ✕</button>
      </div>`).join('') + '<button type="button" class="btn" id="agregarFlete">+ Agregar otro flete</button>';
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
    ['modPrecios', 'incluirMontaje', 'incluirFlete', 'incluirImagen', 'incluirPlano', 'incluirMargen', 'tornillosManualChk'].forEach((id) => $(id) && toggleBox(id));
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
    if (chk('incluirFlete')) { if (S.fletes.length === 0) S.fletes.push(nuevoFlete()); renderFletes(); }
  }

  const boxDe = { modPrecios: 'preciosManualBox', incluirMontaje: 'montajeBox', incluirFlete: 'fleteBox', incluirImagen: 'imagenUploadBox', incluirPlano: 'planoUploadBox', incluirMargen: 'margenBox', tornillosManualChk: 'tornillosManualBox' };
  const toggleBox = (id) => { if ($(boxDe[id])) $(boxDe[id]).hidden = !chk(id); };
  const marcar = (toggleId, v) => $(toggleId).querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.v === v));

  function toggleSecciones() {
    if (!$('incluirSecciones')) return;
    const on = chk('incluirSecciones');
    $('seccionUnicaBox').hidden = on;
    $('seccionesBox').hidden = !on;
    // El checkbox "Cantidad manual de tornillos" de arriba es del ítem único — en secciones cada
    // una tiene su propio campo de tornillos manual (ver renderSecciones()).
    if ($('tornillosManualWrap')) $('tornillosManualWrap').hidden = on;
    // Remates "Detallado" (catálogo real) SÍ aplica en secciones, pero como bloque GLOBAL (la
    // Calculadora no asocia cada flashing a un área concreta — feedback real nov 2026). "Estimado
    // (ml)" ya existe por sección dentro de "Secciones", así que esa opción se oculta aquí para no
    // tener dos lugares distintos haciendo lo mismo.
    $('remateUnicoBox').hidden = false;
    if ($('remateModoToggle')) $('remateModoToggle').hidden = on;
    if (on && S.remateModo !== 'detallado') { S.remateModo = 'detallado'; marcar('remateModoToggle', 'detallado'); }
    $('remateEstimadoBox').hidden = on || S.remateModo !== 'estimado';
    $('remateDetalladoBox').hidden = on ? false : S.remateModo !== 'detallado';
    if (S.remateModo === 'detallado') renderFlashings();
    $('remateSeccionesHint').hidden = !on;
    if (on && S.secciones.length === 0) S.secciones.push(nuevaSeccion());
    if (on) renderSecciones();
    if (chk('modPrecios')) precargarManuales(); else actualizarLabelMaterialManual();
  }

  function bind() {
    const grid = root.querySelector('.cot-grid'); // se recrea en cada mount: evita listeners duplicados
    // Quita el "0" por defecto al entrar a un campo numérico, para no tener que borrarlo a mano
    // antes de escribir (focusin, a diferencia de focus, sí burbujea — delegación en un solo sitio).
    grid.addEventListener('focusin', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'number' && e.target.value === '0') e.target.value = '';
    });
    grid.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'comentarios' || t.type === 'file') return;
      const idx = t.dataset.idx;
      if (idx !== undefined && t.classList.contains('fl-piezas')) {
        if (S.flashingsItems[idx]) S.flashingsItems[idx].piezas = t.value;
      } else if (idx !== undefined && t.classList.contains('fl-precio')) {
        if (S.flashingsItems[idx]) S.flashingsItems[idx].precioManual = t.value;
      } else if (idx !== undefined && (t.classList.contains('ft-desc') || t.classList.contains('ft-cant') || t.classList.contains('ft-precio'))) {
        const x = S.fletes[idx];
        if (x) {
          if (t.classList.contains('ft-desc')) x.descripcion = t.value;
          else if (t.classList.contains('ft-cant')) x.cantidad = t.value;
          else if (t.classList.contains('ft-precio')) x.precioUnit = t.value;
        }
      } else if (idx !== undefined && S.secciones[idx] && (t.classList.contains('sec-nombre') || t.classList.contains('sec-nombre-producto') || t.classList.contains('sec-area') || t.classList.contains('sec-largo') || t.classList.contains('sec-ancho') || t.classList.contains('sec-remates') || t.classList.contains('sec-tornillos-manual'))) {
        // Gated por clase sec-*, no solo por índice: una Sección y una Partida pueden compartir el
        // mismo idx (arrays independientes), y antes esto "robaba" el evento de pa-precio sin hacer
        // nada, dejando el precio manual de Partidas sin aplicarse nunca (bug real reportado).
        const s = S.secciones[idx];
        if (t.classList.contains('sec-nombre')) s.nombre = t.value;
        else if (t.classList.contains('sec-nombre-producto')) s.nombreManual = t.value;
        else if (t.classList.contains('sec-area')) s.area = t.value;
        else if (t.classList.contains('sec-largo')) s.mlLargo = t.value;
        else if (t.classList.contains('sec-ancho')) s.mlAncho = t.value;
        else if (t.classList.contains('sec-remates')) s.rematesMl = t.value;
        else if (t.classList.contains('sec-tornillos-manual')) s.tornillosCantManual = t.value;
      } else if (idx !== undefined && S.partidas[idx]) {
        const x = S.partidas[idx];
        if (t.classList.contains('pa-desc')) x.descripcion = t.value;
        else if (t.classList.contains('pa-unidad')) x.unidad = t.value;
        else if (t.classList.contains('pa-cant')) x.cantidad = t.value;
        else if (t.classList.contains('pa-precio')) x.precioUnit = t.value;
        else if (t.classList.contains('pa-costo')) x.costoUnit = t.value;
      }
      calcular();
    });
    grid.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'incluirSecciones') { toggleSecciones(); calcular(); return; }
      if (e.target.classList.contains('sec-producto')) {
        const idx = e.target.dataset.idx;
        const s = S.secciones[idx];
        if (s) {
          s.pv = e.target.value;
          s.modo = modoDeProducto(productoPorValor(s.pv));
          renderSecciones();
        }
        // Cambiar el producto de una sección puede volver (o dejar de ser) homogéneas las
        // secciones en ml — refresca la etiqueta/precarga del precio manual de Material.
        if (chk('modPrecios')) precargarManuales(); else actualizarLabelMaterialManual();
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
        if (id === 'incluirFlete' && chk(id)) { if (S.fletes.length === 0) S.fletes.push(nuevoFlete()); renderFletes(); }
        if (id === 'incluirImagen' && !chk(id)) S.imagen = null;
        if (id === 'incluirPlano' && !chk(id)) { S.plano = null; actualizarPlanoHint(); }
        if (id === 'incluirMargen') { if (!chk(id)) setVista('cliente'); renderPartidas(); }
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
      if (e.target.classList.contains('fl-eliminar')) {
        S.flashingsItems.splice(+e.target.dataset.idx, 1);
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
        if (chk('modPrecios')) precargarManuales(); else actualizarLabelMaterialManual();
        calcular();
        return;
      }
      if (e.target.id === 'agregarSeccion') {
        S.secciones.push(nuevaSeccion());
        renderSecciones();
        if (chk('modPrecios')) precargarManuales(); else actualizarLabelMaterialManual();
        calcular();
        return;
      }
      if (e.target.id === 'calcOrigenCerrar') {
        $('calcOrigenHint').hidden = true;
        return;
      }
      if (e.target.classList.contains('pa-eliminar')) {
        S.partidas.splice(+e.target.dataset.idx, 1);
        renderPartidas();
        calcular();
        return;
      }
      if (e.target.id === 'agregarPartida') {
        S.partidas.push(nuevaPartida());
        renderPartidas();
        calcular();
        return;
      }
      if (e.target.classList.contains('ft-eliminar')) {
        S.fletes.splice(+e.target.dataset.idx, 1);
        renderFletes();
        calcular();
        return;
      }
      if (e.target.id === 'agregarFlete') {
        S.fletes.push(nuevoFlete());
        renderFletes();
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
          if (chk('modPrecios')) precargarManuales(); else actualizarLabelMaterialManual();
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
      if (act === 'pasar-a-pedido') pasarAPedido();
    });
  }

  function actualizarPlanoHint() {
    const el = $('planoActual');
    if (el) el.textContent = S.plano ? `Adjunto: ${S.plano.nombre}` : 'Sin archivo adjunto todavía.';
  }

  function onProducto() {
    aplicarComentarioAuto();
    const modoEsperado = modoDeProducto(productoActual());
    if (S.modo !== modoEsperado) {
      S.modo = modoEsperado;
      marcar('medidaToggle', S.modo);
      $('areaDirectaBox').hidden = S.modo !== 'm2';
      $('areaMlBox').hidden = S.modo !== 'ml';
    }
    if (S.modo === 'ml') { $('mlAncho').value = ''; prefillAncho(); }
    if (chk('modPrecios')) precargarManuales();
    if (chk('incluirMontaje')) precargarMontaje(true);
  }

  function prefillAncho() {
    const p = productoActual();
    if (S.modo === 'ml' && p.ancho && !val('mlAncho')) $('mlAncho').value = p.ancho;
  }

  // El campo "Material" manual debe hablar en la MISMA unidad que ya se está mostrando/cotizando
  // (ml para paneles, m² para Standing Seam) — antes siempre precargaba y leía el equivalente en
  // m², así que quien escribía un precio pensando en US$/ml (p. ej. "Maxipanel a US$46/ml") veía un
  // número distinto en la oferta (US$46 × ancho_util = US$48,30) porque el motor lo tomaba tal
  // cual como US$/m² y la tabla lo multiplicaba de vuelta por ancho_util para mostrarlo en ml
  // (bug real reportado, nov 2026).
  // En modo secciones, si TODAS las secciones usan el mismo producto/ancho útil en ml (caso real:
  // "Techo 1"/"Techo 2" ambos Maxipanel), SÍ hay un único US$/ml al que convertir sin ambigüedad —
  // mismo bug reportado otra vez, nov 2026, porque antes esto se dejaba siempre en US$/m² "porque
  // cada sección puede ser distinta", sin comprobar si en este caso concreto no lo eran. Si las
  // secciones mezclan productos distintos (o alguno es m², como Standing Seam), no hay un ancho
  // único y se mantiene en US$/m² como antes — avisado en la etiqueta.
  function anchoUtilSeccionesHomogeneo() {
    if (!S.secciones.length) return 0;
    let ancho = null;
    for (const s of S.secciones) {
      const p = productoPorValor(s.pv);
      if (!p || modoDeProducto(p) !== 'ml' || !(p.ancho > 0)) return 0;
      if (ancho == null) ancho = p.ancho;
      else if (Math.abs(ancho - p.ancho) > 1e-9) return 0;
    }
    return ancho || 0;
  }
  function anchoUtilParaManual() {
    if (chk('incluirSecciones')) return anchoUtilSeccionesHomogeneo();
    const p = productoActual();
    return S.modo === 'ml' && p && p.ancho > 0 ? p.ancho : 0;
  }
  function productoManualReferencia() {
    if (chk('incluirSecciones')) return S.secciones[0] ? productoPorValor(S.secciones[0].pv) : null;
    return productoActual();
  }
  function esModoMlUnico() {
    return anchoUtilParaManual() > 0;
  }
  function actualizarLabelMaterialManual() {
    const lbl = $('precioMaterialManualLabel');
    if (!lbl) return;
    const ml = esModoMlUnico();
    lbl.textContent = chk('incluirSecciones')
      ? (ml ? 'Material (US$/ml, aplica a todas las secciones — mismo producto)' : 'Material (US$/m², aplica a todas las secciones)')
      : (ml ? 'Material (US$/ml)' : 'Material (US$/m²)');
  }
  function precargarManuales() {
    actualizarLabelMaterialManual();
    const pRef = productoManualReferencia();
    if (pRef) {
      $('precioMaterialManual').value = (esModoMlUnico() ? Number(pRef[S.pago]) : CotizadorEngine.precioM2Lista(pRef, S.pago)).toFixed(2);
    }
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
        tornillosCantManual: s.tornillosCantManual,
        rematesMl: s.rematesMl,
      };
    }) : null;
    // Flashings "Detallado" (catálogo real): en secciones son GLOBALES (ver motor,
    // calcularOferta()), así que se construyen igual tenga o no secciones activas.
    const rematesDetalle = (S.remateModo === 'detallado')
      ? S.flashingsItems.map((it) => {
          const f = cat.flashings[it.idx];
          return { codigo: f ? f.codigo : '', piezas: it.piezas, precioUnit: precioFlashingEfectivo(it, f) };
        })
      : null;
    const entradas = {
      producto: multi ? null : p, pago: S.pago, area: multi ? 0 : area(),
      desperdicioPct: val('desperdicio'), tornillosPorM2: val('tornillos'),
      tornillosCantManual: (!multi && chk('tornillosManualChk')) ? val('tornillosCantManual') : null,
      rematesMl: multi ? 0 : val('remates'),
      secciones: seccionesEntrada,
      rematesDetalle,
      ivaPct: val('iva'), tasaBcv: val('tasabcv'),
      // El motor siempre espera el precio de material en US$/m² (precioM2) — si el campo se está
      // mostrando/leyendo en US$/ml (esModoMlUnico()), hay que dividir entre el ancho útil antes
      // de mandarlo, o se duplicaría la conversión al mostrarlo de vuelta en la oferta. El ancho
      // correcto es el de anchoUtilParaManual() (sección homogénea o producto único), NUNCA el del
      // selector de producto oculto (`p`) cuando hay secciones activas — ese es de otra sección.
      preciosManuales: modPrecios ? {
        material: esModoMlUnico() ? val('precioMaterialManual') / (anchoUtilParaManual() || 1) : val('precioMaterialManual'),
        tornillo: val('precioTornilloManual'), remate: val('precioRemateManual'),
      } : null,
      montaje: {
        incluir: chk('incluirMontaje'), m2: val('precioMontajeM2'), ml: val('precioMontajeMl'),
        areaManual: val('montajeAreaManual'),
        rematesMlManual: val('montajeRematesMlManual'),
        pantallaArea: val('montajePantallaArea'), pantallaPrecioM2: val('montajePantallaPrecioM2'),
        diasGrua: val('montajeDiasGrua'), precioGruaDia: val('montajePrecioGruaDia'),
        andamios: val('montajeAndamios'), supervisor: val('montajeSupervisor'),
      },
      flete: { incluir: chk('incluirFlete'), fletes: S.fletes },
      margen: margen ? { costoMaterial: val('costoMaterial'), costoTornillo: val('costoTornillo'), costoRemate: val('costoRemate'), costoOtros: val('costoOtros') } : null,
      partidas: S.partidas,
    };
    const r = CotizadorEngine.calcularOferta(entradas, {
      tornillo: { efectivo: params.tornillo_efectivo, bcv: params.tornillo_bcv },
      remate: { efectivo: params.remate_efectivo, bcv: params.remate_bcv },
      piezaRemateM: params.pieza_remate_m,
    });
    // El motor siempre devuelve el material en m² — para mostrarlo en ml cuando el producto se
    // cotiza así (paneles, punto de feedback de Violeta: "en la calculadora sí aparece en metro
    // lineal... debería ser lo mismo en el detalle del Cotizador") hace falta el modo/ancho útil
    // de cada sección, que el motor no conoce (solo recibe área ya convertida a m²).
    if (multi) {
      r.secciones.forEach((s, idx) => {
        const sIn = S.secciones[idx];
        s.modo = sIn ? sIn.modo : 'm2';
        const prodSec = productoPorValor(sIn && sIn.pv);
        s.anchoUtil = (prodSec || {}).ancho || 0;
        s.tornillosManual = !!(sIn && sIn.tornillosCantManual != null && sIn.tornillosCantManual !== '');
        // Nombre del producto a mostrar en la "fila" de Material de esta sección — antes decía
        // literalmente "Material" sin indicar cuál sistema (punto de feedback real, nov 2026: "en
        // material que pueda decir el producto que estamos ofertando"). Admite override manual.
        s.nombreProducto = (sIn && sIn.nombreManual && sIn.nombreManual.trim()) || (prodSec ? prodSec.n : 'Material');
        // Nombre de CATÁLOGO (no el manual): es la clave para buscar la receta de materiales (BOM).
        s.productoCatalogo = prodSec ? prodSec.n : '';
        s.despiece = sIn ? despieceVigente(sIn.despiece, sIn.pv, areaSeccion(sIn)) : null;
      });
    }
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
      productoNombre: multi ? `Varias secciones (${r.secciones.length})` : (val('nombreProductoManual').trim() || p.n),
      productoCatalogo: multi ? '' : p.n,
      despiece: multi ? null : despieceVigente(S.despiece, pvActual(), area()),
      catLabel: multi ? 'Secciones' : categoria, ancho: multi ? null : p.ancho,
      modo: multi ? null : S.modo, anchoUtil: multi ? null : (p.ancho || 0),
    };

    // Líneas estructuradas de materiales (BOM): se guardan con "Pasar a pedido" para poder calcular
    // el requerimiento de materiales por pedido y editarlo después en la pestaña Pedidos.
    const fijSel = $('fijacionCatalogo') && val('fijacionCatalogo') !== '' ? cat.fijaciones[+val('fijacionCatalogo')] : null;
    ultima.lineasMateriales = BomEngine.lineasDesdeOferta(ultima, {
      nombreTornillo: fijSel ? fijSel.nombre : nombreTornillo,
      flashings: cat.flashings.map((f) => ({ codigo: f.codigo, descripcion: f.descripcion })),
    });

    const emp = S.empresa;
    // Sin logo de Centrolam como imagen disponible todavía (pedido real: "pueden colocar el logo
    // de Centrolam como marca registrada") — mientras no haya un archivo, se refuerza con texto que
    // Centrolam es una marca de Grupo Centrolit y viceversa, sin inventar un logo.
    $('empresaInfo').innerHTML = `RIF: ${esc(emp.rif)}<br>${esc(emp.direccion)}<br><span class="marca-centrolam">CENTROLAM® — una marca de Grupo Centrolit</span>`;
    $('docFoot').innerHTML = `<span>${esc(emp.nombre)} · Centrolit / Centrolam / Plasticorp / Paneles Aislados</span><span>${esc(emp.web)}</span>`;
    $('docNum').textContent = ultima.docNum;
    $('docFecha').textContent = 'Fecha: ' + hoy;
    // Forma de pago y Tipo de obra se siguen pidiendo en el formulario (alimentan el cálculo y el
    // texto de comentario automático) pero ya no se imprimen en la oferta — pedido real, nov 2026:
    // redundante/no aporta al cliente en el documento final.
    $('docInfo').innerHTML = [
      ['Cliente', ultima.cliente], ['RIF', ultima.clienteRif || '—'], ['Ubicación', ultima.ubicacion], ['Proyecto', ultima.proyecto],
      ['Dirección fiscal', ultima.direccionFiscal || '—'], ['Dirección de entrega', ultima.direccionEntrega || '—'],
      ['Contacto', ultima.contacto || '—'],
    ].map(([l, v]) => `<div><span class="l">${l}:</span>${esc(v)}</div>`).join('');

    // sub(): sub-línea gris bajo la Descripción — reemplaza a la antigua columna "Detalle"
    // (eliminada, punto de feedback real nov 2026: "eliminar detalle"). badge, si se da, es la
    // misma etiqueta ámbar que antes vivía en esa columna (solo pantalla; se oculta al imprimir
    // la Vista Cliente, ver styles.css).
    const sub = (t, badge) => `<div class="sub-line">${esc(t)}${badge ? ` <span class="badge-est">${esc(badge)}</span>` : ''}</div>`;
    const filas = [];
    if (r.precioFaltante) {
      filas.push('<tr class="seccion-head-row" style="background:var(--red) !important"><td colspan="4"><strong>⚠ Un producto no tiene precio de lista confirmado — no se puede exportar ni entregar esta oferta hasta corregirlo.</strong></td></tr>');
    }
    if (multi) {
      // Si hay flashings "Detallado" (globales, ver motor), reemplazan el estimado por sección — ya
      // no se muestra ninguna fila de Remates por sección (antes había una fila en US$0, redundante
      // con el bloque global de abajo — punto de feedback real: "si tenemos un apartado para
      // flashings no vale la pena repetirlo").
      const flashingsGlobales = Array.isArray(r.rematesDetalle) && r.rematesDetalle.length > 0;
      r.secciones.forEach((s) => {
        const rematesImporteSeccion = flashingsGlobales ? 0 : s.rematesImporte;
        const subtotalSeccion = s.materialImporte + s.tornillosImporte + rematesImporteSeccion;
        const um = unidadMaterial(s.modo, s.anchoUtil, s.areaConDesp, s.precioM2);
        filas.push(`<tr class="seccion-head-row"><td colspan="4"><strong>— ${esc(s.nombre)} —</strong></td></tr>`);
        filas.push(`<tr><td><strong>${esc(s.nombreProducto)}</strong>${sub(`${cantidadComoModo(s.modo, s.anchoUtil, s.area)} + ${s.desperdicioPct}% desperdicio`, 'calculado')}</td>
          <td class="r">${um.cantidadTxt}</td><td class="r">US$ ${fmt(um.precioValor)}${um.precioSufijo}</td><td class="r">US$ ${fmt(s.materialImporte)}</td></tr>`);
        filas.push(`<tr><td><strong>Fijaciones</strong>${sub(nombreTornillo, s.tornillosManual ? 'cantidad manual (de la Calculadora)' : 'estimado')}</td>
          <td class="r">${s.tornillosCant.toLocaleString('es-VE')} unid.</td><td class="r">US$ ${fmt(s.tornilloPrecio)}</td><td class="r">US$ ${fmt(s.tornillosImporte)}</td></tr>`);
        if (!flashingsGlobales) {
          filas.push(`<tr><td><strong>Remates / Flashings</strong>${sub(`${nombreRemate} — ${s.rematesMl.toLocaleString('es-VE')} ml → ${s.piezasRemate} pieza(s)`, 'estimado')}</td>
            <td class="r">${s.rematesMlFacturable.toLocaleString('es-VE')} ml</td><td class="r">US$ ${fmt(s.rematePrecio)}</td><td class="r">US$ ${fmt(s.rematesImporte)}</td></tr>`);
        }
        filas.push(`<tr class="seccion-subtotal-row"><td colspan="3">Subtotal de esta sección (sin montaje ni flete, prorrateables)</td><td class="r">US$ ${fmt(subtotalSeccion)}</td></tr>`);
      });
      if (flashingsGlobales) {
        filas.push('<tr class="seccion-head-row"><td colspan="4"><strong>— Flashings — aplica a toda la oferta —</strong></td></tr>');
        r.rematesDetalle.forEach((d) => {
          const f = cat.flashings.find((x) => x.codigo === d.codigo);
          filas.push(`<tr><td><strong>Flashing ${esc(d.codigo)}</strong>${sub(f ? f.descripcion : '', 'valor de lista')}</td>
            <td class="r">${d.piezas} pieza(s)</td><td class="r">US$ ${fmt(d.precioUnit)}</td><td class="r">US$ ${fmt(d.piezas * d.precioUnit)}</td></tr>`);
        });
        filas.push(`<tr class="seccion-subtotal-row"><td colspan="3">Subtotal de flashings (global)</td><td class="r">US$ ${fmt(r.rematesImporte)}</td></tr>`);
      }
    } else {
      const um = unidadMaterial(S.modo, p.ancho || 0, r.areaConDesp, r.precioM2);
      filas.push(
        `<tr><td><strong>${esc(ultima.productoNombre)}</strong>${sub(`${categoria}${p.ancho ? ' · ancho útil ' + p.ancho + ' m' : ''} · ${cantidadComoModo(S.modo, p.ancho || 0, r.area)} + ${r.desperdicioPct}% desperdicio`, modPrecios ? 'precio modificado' : 'calculado')}</td>
          <td class="r">${um.cantidadTxt}</td><td class="r">US$ ${fmt(um.precioValor)}${um.precioSufijo}</td><td class="r">US$ ${fmt(r.materialImporte)}</td></tr>`,
        `<tr><td><strong>Fijaciones</strong>${sub(`${nombreTornillo} — ${r.tornillosPorM2} unid./m²`, 'estimado')}</td>
          <td class="r">${r.tornillosCant.toLocaleString('es-VE')} unid.</td><td class="r">US$ ${fmt(r.tornilloPrecio)}</td><td class="r">US$ ${fmt(r.tornillosImporte)}</td></tr>`
      );
      if (r.rematesDetalle) {
        r.rematesDetalle.forEach((d) => {
          const f = cat.flashings.find((x) => x.codigo === d.codigo);
          filas.push(`<tr><td><strong>Flashing ${esc(d.codigo)}</strong>${sub(f ? f.descripcion + ' — desarrollo ' + f.desarrollo + ' cm' : '', 'pieza exacta')}</td>
            <td class="r">${d.piezas}</td><td class="r">US$ ${fmt(d.precioUnit)}</td><td class="r">US$ ${fmt(d.piezas * d.precioUnit)}</td></tr>`);
        });
      } else {
        filas.push(`<tr><td><strong>Remates / Flashings</strong>${sub(`${nombreRemate} — se vende por pieza de 2,40 m · perímetro estimado: ${r.rematesMl.toLocaleString('es-VE')} ml → ${r.piezasRemate} pieza(s)`, 'estimado')}</td>
          <td class="r">${r.rematesMlFacturable.toLocaleString('es-VE')} ml</td><td class="r">US$ ${fmt(r.rematePrecio)}</td><td class="r">US$ ${fmt(r.rematesImporte)}</td></tr>`);
      }
    }
    if (r.incluirMontaje) {
      // Montaje de techo, de remates y de pantalla como líneas separadas (feedback real: precios y
      // proveedores distintos, no deberían verse mezclados en un solo renglón).
      filas.push(`<tr><td><strong>Montaje de techo</strong>${sub(`Instalación de techo — cuadrillas propias · ${r.areaMontaje.toFixed(2)} m²${r.areaMontaje !== r.areaConDesp ? ' (manual)' : ''}`, r.areaMontaje !== r.areaConDesp ? 'ingresado manualmente' : montajeDef ? 'valor de lista' : 'ingresado manualmente')}</td>
        <td class="r">—</td><td class="r">US$ ${fmt(r.precioMontajeM2)}/m²</td><td class="r">US$ ${fmt(r.montajeTechoImporte)}</td></tr>`);
      if (r.rematesMlParaMontaje > 0 || r.montajeRematesImporte > 0) {
        const rematesManual = r.rematesMlParaMontaje !== r.rematesMlFacturable;
        filas.push(`<tr><td><strong>Montaje de remates</strong>${sub(`Instalación de flashings — cuadrillas propias · ${r.rematesMlParaMontaje.toLocaleString('es-VE')} ml${rematesManual ? ' (manual)' : ''}`, rematesManual ? 'ingresado manualmente' : montajeDef ? 'valor de lista' : 'ingresado manualmente')}</td>
          <td class="r">—</td><td class="r">US$ ${fmt(r.precioMontajeMl)}/ml</td><td class="r">US$ ${fmt(r.montajeRematesImporte)}</td></tr>`);
      }
      if (r.montajePantallaImporte > 0) {
        filas.push(`<tr><td><strong>Montaje de pantalla</strong>${sub(`Instalación de pantalla — cuadrillas propias · ${r.pantallaArea.toFixed(2)} m²`, 'ingresado manualmente')}</td>
          <td class="r">—</td><td class="r">US$ ${fmt(r.pantallaPrecioM2)}/m²</td><td class="r">US$ ${fmt(r.montajePantallaImporte)}</td></tr>`);
      }
      if (r.gruaImporte > 0) {
        filas.push(`<tr><td><strong>Grúa de montaje</strong>${sub(`Izaje — p. ej. standing seam · ${r.diasGrua} día(s)`, 'ingresado manualmente')}</td>
          <td class="r">${r.diasGrua}</td><td class="r">US$ ${fmt(r.precioGruaDia)}/día</td><td class="r">US$ ${fmt(r.gruaImporte)}</td></tr>`);
      }
      if (r.andamios > 0) {
        filas.push(`<tr><td><strong>Andamios especiales</strong>${sub('Montaje de esta obra', 'ingresado manualmente')}</td><td class="r">Estimado caso a caso</td><td class="r">—</td><td class="r">US$ ${fmt(r.andamios)}</td></tr>`);
      }
      if (r.supervisor > 0) {
        filas.push(`<tr><td><strong>Supervisor fijo en obra</strong>${sub('Montaje de esta obra', 'ingresado manualmente')}</td><td class="r">Estimado caso a caso</td><td class="r">—</td><td class="r">US$ ${fmt(r.supervisor)}</td></tr>`);
      }
    }
    if (r.incluirFlete) {
      // Varias líneas de flete (p. ej. "Gandola 1", "Camión 750", cada una con su propio precio —
      // feedback real, nov 2026) si se usó la lista; si no, el monto único de siempre.
      if (r.fletes.length) {
        r.fletes.forEach((f) => {
          filas.push(`<tr><td><strong>Flete — ${esc(f.descripcion || 'sin descripción')}</strong>${sub('Transporte para este despacho', 'ingresado manualmente')}</td>
            <td class="r">${f.cantidad.toLocaleString('es-VE')}</td><td class="r">US$ ${fmt(f.precioUnit)}</td><td class="r">US$ ${fmt(f.importe)}</td></tr>`);
        });
      } else {
        filas.push(`<tr><td><strong>Flete</strong>${sub('Transporte estimado para este despacho', 'ingresado manualmente')}</td><td class="r">Estimado caso a caso</td><td class="r">—</td><td class="r">US$ ${fmt(r.fleteImporte)}</td></tr>`);
      }
    }
    r.partidas.forEach((x) => {
      filas.push(`<tr><td><strong>${esc(x.descripcion || 'Partida adicional')}</strong>${sub('Partida adicional', 'ingresado manualmente')}</td>
        <td class="r">${x.cantidad.toLocaleString('es-VE')} ${esc(x.unidad)}</td><td class="r">US$ ${fmt(x.precioUnit)}</td><td class="r">US$ ${fmt(x.importe)}</td></tr>`);
    });
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
    const boilerplate = `Precios ${S.pago === 'efectivo' ? 'de contado en efectivo USD' : 'en bolívares a tasa oficial BCV del día'}, sujetos a variación sin previo aviso. ${incl} Izaje/grúa no está incluido en ningún caso. Las cantidades de fijaciones y remates son estimadas: confirmar con el despiece técnico final antes de la orden de compra. Esta oferta no es un contrato.`;

    // El párrafo de alcance ("A continuación...") va arriba sin título; las notas numeradas de la
    // plantilla (forma de pago, despacho, etc.) se muestran aquí abajo, junto a "Notas" — pedido
    // real, nov 2026: "las notas pasarlas para el final" / "al final donde dice Notas dejar
    // espacio para colocar las notas usuales".
    const { alcance, notas: notasProducto } = splitComentario(ultima.comentarios);
    $('notesBox').innerHTML = `<strong>Notas:</strong>
      ${notasProducto ? `<div class="notas-usuales">${esc(notasProducto).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="notas-boilerplate">${esc(boilerplate)}</div>`;

    const cb = $('comentariosBox');
    cb.hidden = !alcance;
    cb.innerHTML = esc(alcance);

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
    rows.push(xRow([xCell('Contacto:', 'sLabel'), xCell(d.contacto), xCell('Fecha:', 'sLabel'), xCell(d.fecha)]));
    rows.push(xRow([]));
    // El párrafo de alcance va sin título; las notas numeradas de la plantilla se juntan con las
    // notas usuales al final, no aquí arriba (mismo criterio que el documento HTML/PDF).
    const { alcance, notas: notasProducto } = splitComentario(d.comentarios);
    if (alcance) {
      rows.push(xRow([xCell(alcance, 'sWrap')]));
      rows.push(xRow([]));
    }
    rows.push(xRow(['Descripción', 'Cantidad', 'Precio unit. (US$)', 'Importe (US$)'].map((h) => xCell(h, 'sHeader'))));
    if (d.secciones) {
      const flashingsGlobales = Array.isArray(d.rematesDetalle) && d.rematesDetalle.length > 0;
      d.secciones.forEach((s) => {
        rows.push(xRow([xCell('— ' + s.nombre + ' —', 'sBold')]));
        const um = unidadMaterial(s.modo, s.anchoUtil, s.areaConDesp, s.precioM2);
        const rematesImporteSeccion = flashingsGlobales ? 0 : s.rematesImporte;
        rows.push(xRow([xCell(`${s.nombreProducto}\n${cantidadComoModo(s.modo, s.anchoUtil, s.area)} + ${s.desperdicioPct}% desperdicio`, 'sWrap'), xCell(um.cantidadTxt), xCell(um.precioValor, 'sMoney', 'Number'), xCell(s.materialImporte, 'sMoney', 'Number')]));
        rows.push(xRow([xCell(`Fijaciones\n${s.tornillosManual ? 'cantidad manual (de la Calculadora)' : 'estimado'}`, 'sWrap'), xCell(`${s.tornillosCant} unid.`), xCell(s.tornilloPrecio, 'sMoney', 'Number'), xCell(s.tornillosImporte, 'sMoney', 'Number')]));
        if (!flashingsGlobales) {
          rows.push(xRow([xCell('Remates / Flashings', 'sWrap'), xCell(`${s.rematesMlFacturable} ml`), xCell(s.rematePrecio, 'sMoney', 'Number'), xCell(s.rematesImporte, 'sMoney', 'Number')]));
        }
        rows.push(xRow([xCell(''), xCell(''), xCell('Subtotal de esta sección', 'sLabel'), xCell(s.materialImporte + s.tornillosImporte + rematesImporteSeccion, 'sMoney', 'Number')]));
      });
      if (flashingsGlobales) {
        rows.push(xRow([xCell('— Flashings — aplica a toda la oferta —', 'sBold')]));
        d.rematesDetalle.forEach((df) => {
          rows.push(xRow([xCell(`Flashing ${df.codigo}`, 'sWrap'), xCell(`${df.piezas} pieza(s)`), xCell(df.precioUnit, 'sMoney', 'Number'), xCell(df.piezas * df.precioUnit, 'sMoney', 'Number')]));
        });
        rows.push(xRow([xCell(''), xCell(''), xCell('Subtotal de flashings (global)', 'sLabel'), xCell(d.rematesImporte, 'sMoney', 'Number')]));
      }
    } else {
      {
        const um = unidadMaterial(d.modo, d.anchoUtil, d.areaConDesp, d.precioM2);
        rows.push(xRow([
          xCell(`${d.productoNombre}\n${cantidadComoModo(d.modo, d.anchoUtil, d.area)} + ${d.desperdicioPct}% desperdicio`, 'sWrap'),
          xCell(um.cantidadTxt), xCell(um.precioValor, 'sMoney', 'Number'), xCell(d.materialImporte, 'sMoney', 'Number'),
        ]));
      }
      rows.push(xRow([
        xCell('Fijaciones\nTornillo autotaladrante — fijación estándar', 'sWrap'),
        xCell(`${d.tornillosCant} unid.`), xCell(d.tornilloPrecio, 'sMoney', 'Number'), xCell(d.tornillosImporte, 'sMoney', 'Number'),
      ]));
      if (d.rematesDetalle) {
        d.rematesDetalle.forEach((f) => {
          rows.push(xRow([xCell('Flashing ' + f.codigo, 'sWrap'), xCell(f.piezas), xCell(f.precioUnit, 'sMoney', 'Number'), xCell(f.piezas * f.precioUnit, 'sMoney', 'Number')]));
        });
      } else {
        rows.push(xRow([
          xCell(`Remates / Flashings\n${d.rematesMl} ml → ${d.piezasRemate} pieza(s) de 2,40 m`, 'sWrap'),
          xCell(`${d.rematesMlFacturable} ml`), xCell(d.rematePrecio, 'sMoney', 'Number'), xCell(d.rematesImporte, 'sMoney', 'Number'),
        ]));
      }
    }
    if (d.incluirMontaje) {
      rows.push(xRow([
        xCell('Montaje de techo\nInstalación de techo — cuadrillas propias', 'sWrap'),
        xCell(`${d.areaMontaje.toFixed(2)} m²`), xCell(d.precioMontajeM2, 'sMoney', 'Number'), xCell(d.montajeTechoImporte, 'sMoney', 'Number'),
      ]));
      if (d.rematesMlParaMontaje > 0 || d.montajeRematesImporte > 0) {
        rows.push(xRow([
          xCell(`Montaje de remates\nInstalación de flashings — cuadrillas propias${d.rematesMlParaMontaje !== d.rematesMlFacturable ? ' (manual)' : ''}`, 'sWrap'),
          xCell(`${d.rematesMlParaMontaje} ml`), xCell(d.precioMontajeMl, 'sMoney', 'Number'), xCell(d.montajeRematesImporte, 'sMoney', 'Number'),
        ]));
      }
      if (d.montajePantallaImporte > 0) {
        rows.push(xRow([
          xCell('Montaje de pantalla\nInstalación de pantalla — cuadrillas propias', 'sWrap'),
          xCell(`${d.pantallaArea.toFixed(2)} m²`), xCell(d.pantallaPrecioM2, 'sMoney', 'Number'), xCell(d.montajePantallaImporte, 'sMoney', 'Number'),
        ]));
      }
      if (d.gruaImporte > 0) {
        rows.push(xRow([
          xCell('Grúa de montaje\nIzaje — p. ej. standing seam', 'sWrap'),
          xCell(`${d.diasGrua} día(s)`), xCell(d.precioGruaDia, 'sMoney', 'Number'), xCell(d.gruaImporte, 'sMoney', 'Number'),
        ]));
      }
      if (d.andamios > 0) {
        rows.push(xRow([xCell('Andamios especiales\nMontaje de esta obra', 'sWrap'), xCell('Estimado caso a caso'), xCell(''), xCell(d.andamios, 'sMoney', 'Number')]));
      }
      if (d.supervisor > 0) {
        rows.push(xRow([xCell('Supervisor fijo en obra\nMontaje de esta obra', 'sWrap'), xCell('Estimado caso a caso'), xCell(''), xCell(d.supervisor, 'sMoney', 'Number')]));
      }
    }
    if (d.incluirFlete) {
      if (d.fletes.length) {
        d.fletes.forEach((f) => {
          rows.push(xRow([
            xCell('Flete — ' + (f.descripcion || 'sin descripción') + '\nTransporte para este despacho', 'sWrap'),
            xCell(f.cantidad), xCell(f.precioUnit, 'sMoney', 'Number'), xCell(f.importe, 'sMoney', 'Number'),
          ]));
        });
      } else {
        rows.push(xRow([
          xCell('Flete\nTransporte estimado para este despacho', 'sWrap'),
          xCell('Estimado caso a caso'), xCell(''), xCell(d.fleteImporte, 'sMoney', 'Number'),
        ]));
      }
    }
    d.partidas.forEach((x) => {
      rows.push(xRow([
        xCell((x.descripcion || 'Partida adicional') + '\nPartida adicional', 'sWrap'),
        xCell(`${x.cantidad} ${x.unidad}`), xCell(x.precioUnit, 'sMoney', 'Number'), xCell(x.importe, 'sMoney', 'Number'),
      ]));
    });
    rows.push(xRow([]));
    rows.push(xRow([xCell(''), xCell(''), xCell('Subtotal', 'sLabel'), xCell(d.subtotal, 'sMoney', 'Number')]));
    rows.push(xRow([xCell(''), xCell(''), xCell(`IVA (${d.ivaPct}%)`, 'sLabel'), xCell(d.iva, 'sMoney', 'Number')]));
    rows.push(xRow([xCell(''), xCell(''), xCell('TOTAL', 'sBold'), xCell(d.total, 'sMoneyBold', 'Number')]));
    if (d.totalBs) {
      rows.push(xRow([xCell(''), xCell(''), xCell(`Equivalente en Bs (tasa BCV ${d.tasaBcv})`, 'sLabel'), xCell(d.totalBs, 'sMoney', 'Number')]));
    }
    rows.push(xRow([]));
    rows.push(xRow([xCell('Notas:', 'sBold')]));
    if (notasProducto) rows.push(xRow([xCell(notasProducto, 'sWrap')]));
    rows.push(xRow([xCell('Precios sujetos a variación sin previo aviso. Izaje/grúa nunca incluido. Cantidades de fijaciones y remates son estimadas — confirmar con el despiece técnico final antes de la orden de compra. Esta oferta no es un contrato.', 'sWrap')]));

    const sheetCliente = `<Worksheet ss:Name="Cliente"><Table ss:DefaultColumnWidth="130">
      <Column ss:Width="340"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="110"/>
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

  // ---------- Pasar a pedido ----------
  const PLANTA_POR_CATEGORIA = { 'Standing Seam': 'S', 'Paneles y Láminas': 'P' };

  async function pasarAPedido() {
    if (!ultima) return;
    if (ultima.precioFaltante) { toast('Hay un producto sin precio de lista confirmado — no se puede pasar a pedido.', 'error'); return; }
    if (!ultima.cliente || ultima.cliente === '—') { toast('Falta el nombre del cliente.', 'error'); return; }
    if (!S.pedidosFileId) { toast('Falta configurar el fichero de Pedidos (Ajustes).', 'error'); return; }
    const registro = {
      origenOferta: ultima.docNum || val('numOferta') || '',
      plantaSugerida: ultima.secciones ? '' : (PLANTA_POR_CATEGORIA[ultima.catLabel] || 'V'),
      cliente: ultima.cliente,
      rifCliente: ultima.clienteRif || '',
      telefonoContacto: ultima.contactoTelefono || '',
      correoContacto: ultima.contactoCorreo || '',
      direccionFiscal: ultima.direccionFiscal || '',
      direccionObra: ultima.direccionEntrega || '',
      ciudadObra: ultima.ubicacion && ultima.ubicacion !== '—' ? ultima.ubicacion : '',
      tipoObra: ultima.tipoObra && ultima.tipoObra !== '—' ? ultima.tipoObra : '',
      formaPago: ultima.pago || '',
      montoTotalUsd: Math.round(ultima.total * 100) / 100,
      incluyeMontaje: ultima.incluirMontaje ? 'Sí' : 'No',
      incluyeFlete: ultima.incluirFlete ? 'Sí' : 'No',
      resumenMaterial: ultima.secciones ? ultima.secciones.map((s) => s.nombre).join(' + ') : ultima.productoNombre,
      comentarios: ultima.comentarios || '',
      registradoPor: S.email || '',
      lineas: ultima.lineasMateriales || [],
    };
    try {
      if (window.centrolit) await window.centrolit.pasarAPedido(registro);
      else await WebData.pasarAPedido(registro, S.pedidosFileId, 'Pedidos', S.demo);
      toast('Oferta registrada como pedido.');
    } catch (e) {
      toast('No se pudo pasar a pedido: ' + e.message, 'error');
    }
  }

  async function guardarOferta() {
    try {
      const record = {
        id: S.ofertaId || undefined,
        numOferta: val('numOferta'), cliente: val('cliente') || '(sin nombre)', proyecto: val('proyecto') || '',
        campos: snapshot(), modo: S.modo, pago: S.pago, imagen: S.imagen, plano: S.plano, secciones: S.secciones,
        remateModo: S.remateModo, flashingsItems: S.flashingsItems, partidas: S.partidas, fletes: S.fletes, despiece: S.despiece,
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
      S.partidas = r.partidas || [];
      S.despiece = r.despiece || null;
      // Migración: ofertas guardadas antes de este cambio no tienen fletes[] sino un monto único
      // en el campo precioFlete (ya eliminado del formulario) — se recupera como una sola línea.
      const precioFleteLegado = r.campos && parseFloat(r.campos.precioFlete);
      S.fletes = r.fletes || (precioFleteLegado > 0 ? [{ id: 'ft' + Math.random().toString(36).slice(2, 8), descripcion: '', cantidad: 1, precioUnit: precioFleteLegado }] : []);
      restaurar(r.campos || {});
      renderPartidas();
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

  // Convierte un área (m²) calculada en la Calculadora al modo que corresponde al producto
  // (ml para paneles/ancho útil, m² para Standing Seam) — punto 1/2 del feedback de Violeta
  // (nov 2026): forzar siempre m² aquí, aunque daba el mismo total en US$, mostraba el toggle
  // "m²" para un producto que el equipo SIEMPRE piensa en ml (Maxipanel, TP3/TP4...), que era
  // justo la "confusión sobre de qué lado hacer el cálculo" que reportó.
  // mlDirecto = el ml que ya calculó la Calculadora (cantLam × largoLam, con el redondeo hacia
  // arriba de Cant. láminas ya aplicado) — se usa TAL CUAL si viene informado. Solo si no viene
  // (p. ej. entradas antiguas sin ese campo) se re-deriva de areaM2, lo que PIERDE el redondeo por
  // lámina completa y da un número distinto al que el usuario ya vio en la Calculadora (bug real
  // reportado, nov 2026: 41,40 ml calculados ahí vs. 38,33 ml que llegaban aquí).
  function areaComoModo(pv, areaM2, mlDirecto) {
    const p = productoPorValor(pv);
    const modo = modoDeProducto(p);
    if (modo === 'ml' && p && p.ancho > 0) {
      const mlLargo = mlDirecto > 0 ? mlDirecto : areaM2 / p.ancho;
      return { modo: 'ml', area: 0, mlAncho: p.ancho, mlLargo: Math.round(mlLargo * 100) / 100 };
    }
    return { modo: 'm2', area: Math.round(areaM2 * 100) / 100, mlAncho: 0, mlLargo: 0 };
  }

  // Despiece de láminas (cantidad x largo por lámina) que llega de la Calculadora. Solo se usa si
  // sigue vigente: mismo producto y misma área que cuando llegó — si el usuario cambió el producto
  // o las medidas después, el despiece viejo sería engañoso para producción y se descarta. NO se
  // deduce de los metros tecleados a mano ("largo total" y "ancho" se usan de formas distintas).
  const pvActual = () => val('categoria') + '||' + val('producto');
  const despieceVigente = (d, pv, area) => (d && d.pv === pv && Math.abs((d.area || 0) - area) < 0.01 ? d : null);

  // Puente con la Calculadora de láminas/correas. Bug real reportado (varios usuarios, nov 2026):
  // cuando el Cotizador ya tenía "Cotizar por secciones" activo (típico de quien cotiza varios
  // techos — justo quienes más usan la Calculadora con varias áreas), esta función se limitaba a
  // mostrar un aviso y no aplicaba nada: parecía que el botón "no hacía nada". Corregido: si la
  // Calculadora mandó 2+ áreas, se aplican como 2+ secciones (una por área, con su propio
  // producto); si mandó 1 sola, se aplica al ítem único y se desactivan las secciones si estaban
  // encendidas (en vez de bloquear).
  function aplicarCalculoExterno({ areaM2, tornillosCant, secciones, flashings, tornillosFlashingsSinPrecio }) {
    if (!root) return;
    if ($('calcOrigenHint')) $('calcOrigenHint').hidden = false;
    const n = Array.isArray(secciones) ? secciones.length : 0;
    if (n >= 2) {
      if (!chk('incluirSecciones')) $('incluirSecciones').checked = true;
      // Tornillos EXACTOS de esta sección (cantLam × correas × clipsPorCruce, ya calculado en la
      // Calculadora) — ya no una tasa US$/m² aproximada repartida entre todas (feedback real nov
      // 2026: "lo que aparece en la Calculadora debe ser lo mismo que en el Cotizador").
      S.secciones = secciones.map((s) => {
        const pv = s.pv || productosPlanos()[0]?.value || '';
        const am = areaComoModo(pv, s.areaM2 || 0, s.ml);
        const tornillosCantManual = s.tornillos != null ? Math.round(s.tornillos) : '';
        const sec = { id: 's' + Math.random().toString(36).slice(2, 8), nombre: s.nombre || '', pv, rematesMl: 0, tornillosCantManual, ...am };
        sec.despiece = s.cantLam > 0 && s.largoLam > 0 ? { pv, cantLam: s.cantLam, largoLam: s.largoLam, area: areaSeccion(sec) } : null;
        return sec;
      });
      toggleSecciones();
      renderSecciones();
      toast(`Aplicado como ${n} secciones, con sus tornillos exactos de la Calculadora.`);
    } else {
      if (chk('incluirSecciones')) { $('incluirSecciones').checked = false; toggleSecciones(); }
      const unaSeccion = n === 1 ? secciones[0] : null;
      let pv = unaSeccion && unaSeccion.pv;
      if (pv) {
        const [catN] = pv.split('||');
        if (cat.categorias[catN]) {
          $('categoria').value = catN;
          poblarProductos();
          $('producto').value = pv.split('||')[1];
          onProducto();
        } else pv = null;
      }
      const am = pv ? areaComoModo(pv, areaM2, unaSeccion && unaSeccion.ml) : { modo: 'm2', area: Math.round(areaM2 * 100) / 100, mlAncho: 0, mlLargo: 0 };
      S.modo = am.modo;
      marcar('medidaToggle', am.modo);
      $('areaDirectaBox').hidden = am.modo !== 'm2';
      $('areaMlBox').hidden = am.modo !== 'ml';
      if (am.modo === 'ml') {
        $('mlAncho').value = am.mlAncho;
        $('mlLargo').value = am.mlLargo;
      } else {
        $('area').value = am.area;
      }
      $('tornillosManualChk').checked = true;
      toggleBox('tornillosManualChk');
      $('tornillosCantManual').value = Math.round(tornillosCant);
      S.despiece = pv && unaSeccion && unaSeccion.cantLam > 0 && unaSeccion.largoLam > 0
        ? { pv: pvActual(), cantLam: unaSeccion.cantLam, largoLam: unaSeccion.largoLam, area: area() }
        : null;
    }
    // Remates/flashings calculados en la Calculadora (punto 4 del feedback de Violeta) — antes no
    // se mandaban nunca, así que la oferta se quedaba con el modo "Estimado" en 0 ml / US$ 0. En
    // secciones son GLOBALES (ver motor, calcularOferta()) — ya no se bloquean.
    if (Array.isArray(flashings) && flashings.length && cat.flashings.length) {
      S.remateModo = 'detallado';
      if ($('remateModoToggle')) marcar('remateModoToggle', 'detallado');
      if ($('remateEstimadoBox')) $('remateEstimadoBox').hidden = true;
      if ($('remateDetalladoBox')) $('remateDetalladoBox').hidden = false;
      S.flashingsItems = flashings
        .map((f) => ({ id: 'f' + Math.random().toString(36).slice(2, 8), idx: cat.flashings.findIndex((c) => c.codigo === f.codigo), piezas: f.piezas }))
        .filter((f) => f.idx >= 0 && f.piezas > 0);
      if (S.flashingsItems.length) renderFlashings();
    }
    // Tornillos para flashings: fijación distinta de la de lámina/panel, sin precio identificado
    // todavía en el catálogo (pendiente, ver CLAUDE.md) — se deja visible como partida con precio
    // en US$0 en vez de perderse en silencio; si ya existe (envíos repetidos), se actualiza la
    // cantidad en vez de duplicarla.
    if (tornillosFlashingsSinPrecio > 0) {
      const MARCA = 'Tornillos para flashings (completar precio real)';
      const existente = S.partidas.find((x) => x.descripcion === MARCA);
      if (existente) existente.cantidad = tornillosFlashingsSinPrecio;
      else S.partidas.push({ ...nuevaPartida(), descripcion: MARCA, cantidad: tornillosFlashingsSinPrecio, unidad: 'unid', precioUnit: 0 });
      renderPartidas();
    }
    calcular();
  }

  return { mount, aplicarCalculoExterno, construirCatalogo };
})();

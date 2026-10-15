'use strict';
// Shell de la versión web: Cotizador (todo el equipo) + Cuadro de Mando (solo Dirección, según
// acceso a la hoja de KPIs). Sin proceso principal: login, lectura de Sheets y caché viven aquí
// mismo, en el navegador. El PDF y el Excel de la oferta se generan 100% en el navegador
// (window.print() y un XML descargado por Blob) — ver src/renderer/cotizador.js.

const WebApp = (() => {
  const root = document.getElementById('root');
  const views = {};
  let vista = 'cotizador';
  let cfg = { demo: false, preciosFileId: '', kpisFileId: '' };
  let empresa = {};
  let acceso = null, precios = null, kpis = null;

  function cfgLoad() {
    try { cfg = { demo: false, preciosFileId: '', kpisFileId: '', ...JSON.parse(localStorage.getItem('centrolit.web.cfg') || '{}') }; }
    catch { cfg = { demo: false, preciosFileId: '', kpisFileId: '' }; }
  }
  function cfgSave(patch) {
    cfg = { ...cfg, ...patch };
    try { localStorage.setItem('centrolit.web.cfg', JSON.stringify(cfg)); } catch { /* localStorage no disponible */ }
  }

  async function boot() {
    cfgLoad();
    try { empresa = await fetch('empresa.json').then((r) => r.json()); } catch { empresa = {}; }
    if (!cfg.demo && !(await WebAuth.restoreSilent())) return pantallaLogin();
    await cargarTodo(false);
    shell();
  }

  function pantallaLogin() {
    root.innerHTML = `<div class="login"><div class="login-box">
      <img src="assets/logo.png" alt="Centrolit">
      <h2>Cotizador y Cuadro de Mando</h2>
      <p>Inicia sesión con tu cuenta de Google del Grupo para leer la lista de precios y, si eres de Dirección, el Cuadro de Mando.</p>
      <button class="btn" id="btnLogin" ${WebAuth.isConfigured() ? '' : 'disabled'}>Iniciar sesión con Google</button>
      <button class="btn secondary" id="btnDemo">Probar con datos de demostración</button>
      ${WebAuth.isConfigured() ? '' : '<div class="login-note"><strong>Esta instancia aún no tiene configurado el inicio de sesión con Google.</strong> Mientras tanto puedes usar el modo demo.</div>'}
      <div class="login-note">Esta app solo pide permiso de <em>lectura</em>. El acceso a los datos lo decide Google Drive, no esta app, y no se guarda tu contraseña.</div>
    </div></div>`;
    document.getElementById('btnDemo').onclick = () => { cfgSave({ demo: true }); boot(); };
    document.getElementById('btnLogin').onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Conectando…';
      try {
        await WebAuth.signIn();
        cfgSave({ demo: false });
        boot();
      } catch (err) {
        toast(err.message, 'error');
        e.target.disabled = false;
        e.target.textContent = 'Iniciar sesión con Google';
      }
    };
  }

  async function cargarTodo(refresh) {
    [precios, acceso] = await Promise.all([
      WebData.getPrecios({ fileId: cfg.preciosFileId, demoMode: cfg.demo, refresh }),
      WebData.accesoKpis(cfg.kpisFileId, cfg.demo),
    ]);
    kpis = acceso.visible ? await WebData.getKpis({ fileId: cfg.kpisFileId, demoMode: cfg.demo, refresh }) : null;
    if (!cfg.demo && precios?.code === 'no_session') return pantallaLogin();
  }

  function shell() {
    const email = WebAuth.current()?.email;
    const NAV = [
      { id: 'cotizador', icono: '🧮', texto: 'Cotizador' },
      { id: 'dashboard', icono: '📊', texto: 'Cuadro de Mando', soloAcceso: true },
      { id: 'ajustes', icono: '⚙️', texto: 'Ajustes' },
    ];
    root.innerHTML = `<div class="app">
      <nav class="sidebar">
        <div class="brand"><img src="assets/logo.png" alt=""><div><div class="t1">Grupo Centrolit</div><div class="t2">Cotizador y Mando (web)</div></div></div>
        ${NAV.filter((n) => !n.soloAcceso || acceso.visible).map((n) => `<button class="navitem" data-v="${n.id}"><span class="ico">${n.icono}</span>${n.texto}</button>`).join('')}
        <div class="sidebar-foot">${cfg.demo ? 'Modo demo' : esc(email || '')}</div>
      </nav>
      <div class="main"><div class="topbar"><div><h1 id="tTitulo"></h1><div class="sub" id="tSub"></div></div><div class="right" id="tRight"></div></div>
      <div class="content"><div id="v-cotizador"></div><div id="v-dashboard" hidden></div><div id="v-ajustes" hidden></div></div></div></div>`;
    for (const id of ['cotizador', 'dashboard', 'ajustes']) views[id] = document.getElementById('v-' + id);

    root.querySelector('.sidebar').onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (b) mostrar(b.dataset.v);
    };
    document.getElementById('tRight').onclick = (e) => e.target.closest('[data-act="refrescar"]') && refrescar();
    views.cotizador.onclick = views.dashboard.onclick = (e) => e.target.closest('[data-act="refrescar"]') && refrescar();

    montarModulos();
    if (vista === 'dashboard' && !acceso.visible) vista = 'cotizador';
    mostrar(vista);
  }

  function montarModulos() {
    if (precios.ok) Cotizador.mount(views.cotizador, { precios, acceso, empresa, logoSrc: 'assets/logo.png' });
    else views.cotizador.innerHTML = bloqueError(precios, true);
    if (acceso.visible && kpis) Dashboard.mount(views.dashboard, kpis);
    montarAjustes();
  }

  function montarAjustes() {
    views.ajustes.innerHTML = `<div class="narrow">
      <div class="card"><h2><span class="dot"></span>Cuenta de Google</h2>
        <dl class="kv">
          <dt>Modo</dt><dd>${cfg.demo ? 'Demostración' : WebAuth.current() ? 'Conectado a Google' : 'Sin sesión'}</dd>
          <dt>Cuenta</dt><dd>${esc(WebAuth.current()?.email || '—')}</dd>
        </dl>
        <div class="btnrow" style="margin-top:14px">
          ${WebAuth.current()
            ? '<button class="btn secondary" data-act="signout">Cerrar sesión</button>'
            : `<button class="btn" data-act="signin" ${WebAuth.isConfigured() ? '' : 'disabled'}>Iniciar sesión con Google</button>`}
          ${cfg.demo ? '<button class="btn secondary" data-act="salir-demo">Salir del modo demo</button>' : '<button class="btn secondary" data-act="demo">Usar modo demo</button>'}
        </div>
      </div>
      <div class="card"><h2><span class="dot"></span>Ficheros de Google Sheets</h2>
        <label>Lista de precios (Cotizador)</label>
        <input type="text" id="urlPrecios" placeholder="Pega el enlace de la hoja de Google" value="${esc(cfg.preciosFileId ? 'https://docs.google.com/spreadsheets/d/' + cfg.preciosFileId : '')}">
        <label>KPIs (Cuadro de Mando — solo Dirección)</label>
        <input type="text" id="urlKpis" placeholder="Pega el enlace de la hoja de Google" value="${esc(cfg.kpisFileId ? 'https://docs.google.com/spreadsheets/d/' + cfg.kpisFileId : '')}">
        <div class="hint">Deben ser hojas nativas de Google Sheets (ver docs/HOJAS-GOOGLE.md). Si tu cuenta no tiene permiso sobre la hoja de KPIs, el Cuadro de Mando no aparece.</div>
        <div class="btnrow" style="margin-top:12px"><button class="btn" data-act="guardar">Guardar enlaces</button></div>
      </div>
    </div>`;
    views.ajustes.onclick = async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      try {
        if (act === 'signin') { await WebAuth.signIn(); cfgSave({ demo: false }); }
        if (act === 'signout') WebAuth.signOut();
        if (act === 'demo') cfgSave({ demo: true });
        if (act === 'salir-demo') cfgSave({ demo: false });
        if (act === 'guardar') {
          const extraer = (url) => {
            url = url.trim();
            const m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
            return m ? m[1] : /^[a-zA-Z0-9_-]{20,}$/.test(url) ? url : '';
          };
          const urlPrecios = views.ajustes.querySelector('#urlPrecios').value;
          const urlKpis = views.ajustes.querySelector('#urlKpis').value;
          const idPrecios = extraer(urlPrecios);
          const idKpis = extraer(urlKpis);
          if (urlPrecios.trim() && !idPrecios) return toast('El enlace de precios no parece válido.', 'error');
          if (urlKpis.trim() && !idKpis) return toast('El enlace de KPIs no parece válido.', 'error');
          cfgSave({ preciosFileId: idPrecios, kpisFileId: idKpis });
          toast('Guardado.');
        }
        if (!cfg.demo && !WebAuth.current()) return pantallaLogin();
        await cargarTodo(false);
        shell();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  function mostrar(id) {
    vista = id;
    for (const [k, el] of Object.entries(views)) el.hidden = k !== id;
    root.querySelectorAll('.navitem').forEach((b) => b.classList.toggle('active', b.dataset.v === id));
    const titulos = {
      cotizador: ['Cotizador', 'Genera la propuesta técnico-comercial y expórtala a PDF o Excel.', precios && estadoDatos(precios, 'Precios')],
      dashboard: ['Cuadro de Mando', 'Última semana cargada por área — solo Dirección.', kpis && estadoDatos(kpis, 'KPIs')],
      ajustes: ['Ajustes', 'Cuenta de Google y ficheros de datos.', ''],
    };
    const [t, s, pill] = titulos[id];
    document.getElementById('tTitulo').textContent = t;
    document.getElementById('tSub').textContent = s;
    document.getElementById('tRight').innerHTML = id === 'ajustes' ? '' : `${pill || ''}<button class="btn secondary small" data-act="refrescar">↻ Refrescar</button>`;
  }

  async function refrescar() {
    const btn = document.querySelector('#tRight [data-act="refrescar"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Actualizando…'; }
    await cargarTodo(true);
    if (!cfg.demo && !WebAuth.current()) return pantallaLogin();
    montarModulos();
    const teniaNav = !!root.querySelector('[data-v="dashboard"]');
    if (teniaNav !== !!acceso.visible) return shell();
    mostrar(vista);
    const msg = precios?.ok && !precios.stale ? 'Datos actualizados.' : precios?.ok ? 'Sin conexión: se muestran los últimos datos guardados.' : '';
    if (msg) toast(msg);
  }

  return { boot };
})();

WebApp.boot().catch((e) => {
  document.getElementById('root').innerHTML = `<div class="empty-state"><h3>Error al iniciar</h3><p>${esc(e.message)}</p></div>`;
});

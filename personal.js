'use strict';
// Personal: listado de nombre + cargo + sede + teléfono (sin cédula ni dirección — datos
// sensibles que no se cargan en la app, ver docs/HOJAS-GOOGLE.md > 5). Solo lectura.

const Personal = (() => {
  let root, filas = [];
  let q = '';

  function coincide(f) {
    if (!q) return true;
    const t = q.toLowerCase();
    return [f.nombre, f.cargo, f.sede].some((v) => (v || '').toLowerCase().includes(t));
  }

  function pintar() {
    const visibles = filas.filter(coincide);
    const porCargo = {};
    for (const f of visibles) (porCargo[f.cargo || 'Sin cargo'] ??= []).push(f);

    root.innerHTML = `
      <div class="stats-ped">
        <div class="stat-ped"><div class="n">${filas.length}</div><div class="l">Personas</div></div>
        <div class="stat-ped"><div class="n">${Object.keys(porCargo).length}</div><div class="l">Cargos distintos</div></div>
      </div>
      <div class="toolbar-ped">
        <input class="search-ped" type="search" id="qPersonal" placeholder="Buscar nombre o cargo" value="${esc(q)}" style="margin-left:0">
      </div>
      ${Object.keys(porCargo).length ? Object.entries(porCargo).map(([cargo, gente]) => `
        <div class="card" style="margin-bottom:12px">
          <h2 style="font-size:15px"><span class="dot"></span>${esc(cargo)} <span class="hint" style="display:inline">(${gente.length})</span></h2>
          <ul style="margin:8px 0 0;padding-left:18px">
            ${gente.map((p) => `<li>${esc(p.nombre)}${p.sede ? ' <span class="hint" style="display:inline">· ' + esc(p.sede) + '</span>' : ''}${p.telefono ? ' <span class="hint" style="display:inline">· ' + esc(p.telefono) + '</span>' : ''}</li>`).join('')}
          </ul>
        </div>`).join('') : '<div class="empty-state" style="margin:30px auto"><b>Sin personal</b><p>No hay nadie que coincida con la búsqueda.</p></div>'}`;
  }

  function mount(container, res) {
    root = container;
    if (!res.ok) { root.innerHTML = bloqueError(res, true); return; }
    filas = res.data;
    pintar();
    root.oninput = (e) => {
      if (e.target.id === 'qPersonal') { q = e.target.value; pintar(); }
    };
  }

  return { mount };
})();

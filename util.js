'use strict';
// Utilidades compartidas del renderer. Todo texto dinámico debe pasar por esc() antes de ir a innerHTML.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n) => Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  return isNaN(d) ? iso : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const fmtFechaHora = (iso) =>
  iso ? new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

let toastTimer;
function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), 4500);
}

// Barra de estado de datos: "Precios actualizados: fecha" / aviso de caché / demo. + botón Refrescar.
function estadoDatos(res, etiqueta) {
  if (!res) return '';
  if (res.source === 'demo') {
    return `<span class="pill amber">MODO DEMO — datos de ejemplo</span>`;
  }
  const cuando = fmtFechaHora(res.fetchedAt);
  if (res.stale) {
    return `<span class="pill amber" title="No hay conexión con Google">⚠ Sin conexión — ${esc(etiqueta)} de ${esc(cuando)}; pueden no estar al día</span>`;
  }
  return `<span class="pill ok">${esc(etiqueta)} actualizados: ${esc(cuando)}</span>`;
}

// Mensaje estándar para errores de carga de datos.
function bloqueError(res, accionRefrescar) {
  const msgs = {
    sin_fichero: 'Falta indicar el fichero de Google Sheets. Ve a <strong>Ajustes</strong> y pega el enlace.',
    no_session: 'Necesitas iniciar sesión con tu cuenta de Google. Ve a <strong>Ajustes</strong>.',
    sin_acceso: 'Tu cuenta de Google no tiene permiso para abrir este fichero. Pide acceso a quien lo administra.',
  };
  const html = msgs[res.code] || esc(res.error || 'Error desconocido');
  return `<div class="empty-state"><h3>No se pudieron cargar los datos</h3><p>${html}</p>
    ${accionRefrescar ? '<button class="btn" data-act="refrescar">Reintentar</button>' : ''}</div>`;
}

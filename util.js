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

// Compartido por Pedidos/Clientes/Producción (ver pedidos-service.js > parseStatusPedidos).
const PLANTAS = { P: 'Paneles', S: 'Centrolam', V: 'Varios' };
const ETAPAS = {
  terminado: { l: 'Terminado', c: 'ok' },
  en_curso: { l: 'En curso', c: 'amber' },
  sin_iniciar: { l: 'Sin iniciar', c: 'red' },
  sin_dato: { l: 'Sin dato', c: 'muted' },
};
const pillEtapa = (etapa) => {
  const e = ETAPAS[etapa] || ETAPAS.sin_dato;
  return `<span class="pill ${e.c}">${esc(e.l)}</span>`;
};

// Mensaje estándar para errores de carga de datos. "sin_acceso" antes mostraba un texto genérico
// que nunca decía CUÁL fichero fallaba (Precios/KPIs/Personal/Pedidos) — con varias pestañas que
// cargan ficheros distintos, eso hacía casi imposible saber a cuál darle acceso sin leer el código
// (caso real, nov 2026). Ahora se usa el mensaje específico que ya arma cada caller (data-service.js
// / web/data.js / pedidos-service.js), que sí nombra el fichero — con el genérico solo como respaldo
// si por lo que sea no vino.
function bloqueError(res, accionRefrescar) {
  const msgs = {
    sin_fichero: 'Falta indicar el fichero de Google Sheets. Ve a <strong>Ajustes</strong> y pega el enlace.',
    no_session: 'Necesitas iniciar sesión con tu cuenta de Google. Ve a <strong>Ajustes</strong>.',
    sin_acceso: `${esc(res.error || 'Tu cuenta de Google no tiene permiso para abrir este fichero.')} Pide acceso a quien lo administra.`,
    // Distinto de "sin_acceso": aquí la cuenta SÍ tiene permiso sobre el fichero, pero la sesión
    // guardada se autorizó con menos permisos de los que la app necesita hoy (p. ej. inició sesión
    // antes de que se agregara el permiso de escritura) — el arreglo es volver a iniciar sesión,
    // no pedir acceso a nadie.
    permiso_insuficiente: `${esc(res.error || 'Tu sesión de Google no tiene los permisos necesarios para esta acción.')} Ve a <strong>Ajustes</strong>, cierra sesión y vuelve a iniciar sesión con Google.`,
  };
  const html = msgs[res.code] || esc(res.error || 'Error desconocido');
  return `<div class="empty-state"><h3>No se pudieron cargar los datos</h3><p>${html}</p>
    ${accionRefrescar ? '<button class="btn" data-act="refrescar">Reintentar</button>' : ''}</div>`;
}

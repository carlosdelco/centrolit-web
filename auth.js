'use strict';
// Autenticación en el navegador con Google Identity Services (GIS): sin backend propio, sin
// client secret, sin refresh token. El token de acceso vive solo en memoria (variable `access`)
// y dura ~1 hora; al recargar la página se pide de nuevo (silenciosamente si el navegador lo
// permite, o pidiendo iniciar sesión otra vez si no). Es el equivalente web de
// src/main/google-auth.js, pero sin nada persistente que cifrar.
const WebAuth = (() => {
  let tokenClient = null;
  let access = null; // { token, expiresAt, email }

  // Mismo scope de solo lectura que la app de escritorio + email para identificar la cuenta.
  const SCOPES = 'openid email https://www.googleapis.com/auth/spreadsheets.readonly';

  function isConfigured() {
    return !!window.CENTROLIT_WEB_CONFIG?.googleClientId;
  }

  function ensureClient() {
    if (tokenClient) return tokenClient;
    if (!window.google?.accounts?.oauth2) throw new Error('No se pudo cargar el inicio de sesión de Google (¿sin conexión?).');
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.CENTROLIT_WEB_CONFIG.googleClientId,
      scope: SCOPES,
      callback: () => {}, // se sustituye en cada requestToken()
    });
    return tokenClient;
  }

  function requestToken(opts) {
    return new Promise((resolve, reject) => {
      const client = ensureClient();
      client.callback = (resp) => (resp.error ? reject(new Error(resp.error)) : resolve(resp.access_token));
      client.requestAccessToken(opts);
    });
  }

  async function userEmail(token) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return '';
    return (await r.json()).email || '';
  }

  async function signIn() {
    const token = await requestToken({ prompt: 'consent' });
    const email = await userEmail(token);
    access = { token, expiresAt: Date.now() + 55 * 60 * 1000, email };
    return { email };
  }

  // Reintento sin ventana emergente al abrir/recargar la página. Si el navegador bloquea
  // almacenamiento de terceros (Safari, Chrome en modo estricto), esto puede fallar y se le
  // pedirá iniciar sesión de nuevo — límite conocido de este tipo de flujo, no un fallo de la app.
  async function restoreSilent() {
    if (!isConfigured()) return null;
    try {
      const token = await requestToken({ prompt: '' });
      const email = await userEmail(token);
      access = { token, expiresAt: Date.now() + 55 * 60 * 1000, email };
      return { email };
    } catch {
      return null;
    }
  }

  async function getAccessToken() {
    if (!access) throw Object.assign(new Error('No hay sesión iniciada.'), { code: 'no_session' });
    if (Date.now() >= access.expiresAt) {
      const token = await requestToken({ prompt: '' }).catch(() => null);
      if (!token) {
        access = null;
        throw Object.assign(new Error('La sesión caducó. Vuelve a iniciar sesión.'), { code: 'no_session' });
      }
      access.token = token;
      access.expiresAt = Date.now() + 55 * 60 * 1000;
    }
    return access.token;
  }

  function signOut() {
    if (access) {
      try { google.accounts.oauth2.revoke(access.token); } catch { /* ya revocado o sin red */ }
    }
    access = null;
  }

  const current = () => (access ? { email: access.email } : null);

  return { isConfigured, signIn, restoreSilent, signOut, getAccessToken, current };
})();

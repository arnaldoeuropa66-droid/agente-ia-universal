/** CONTACTOS.
 *
 * Validación del formulario de contacto del widget. Separa la validación del
 * Worker para que el chat no tenga que crecer dentro de index.js.
 *
 * El email se valida de forma estricta: guarda la seguridad contra formularios
 * de spam inválidos, pero no rechaza direcciones raras que el navegador de
 * parcela. Si una dirección es inválida, el Worker la rechaza con el mismo
 * mensaje.
 */

const MAX_NOMBRE = 120;
const MAX_EMAIL = 200;
const MAX_MENSAJE = 2000;
const MAX_CONVERSACION = 8000;

/**
 * Valida un lead. Devuelve { error, lead }.
 * El email se comprueba con un regex estricto que no deja pasar direcciones
 * sin dominio, con pathogenicos caracteres.
 */
export function validarLead(payload) {
  const nombre = limpia(payload.nombre, MAX_NOMBRE);
  const email = limpia(payload.email, MAX_EMAIL).toLowerCase();
  const mensaje = limpiaMultilinea(payload.mensaje, MAX_MENSAJE);
  const conversacion = limpiaMultilinea(payload.conversacion, MAX_CONVERSACION);

  if (nombre.length < 2) return { error: 'Escribe tu nombre.' };
  if (nombre.length > MAX_NOMBRE) return { error: 'El nombre es demasiado largo.' };
  if (!email) return { error: 'Escribe tu email.' };
  if (email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { error: 'El email no parece válido.' };
  }
  if (mensaje.length < 3) return { error: 'Cuéntame un poco qué necesitas.' };

  return { lead: { nombre, email, mensaje, conversacion } };
}

/** Inserta el contacto en D1. Devuelve el id, o null si no se pudo guardar. */
export async function guardarLead(env, lead) {
  if (!env.AGENTE_LEADS) {
    console.error('D1 AGENTE_LEADS no esta enlazado');
    return null;
  }
  const res = await env.AGENTE_LEADS.prepare(
    'INSERT INTO leads (nombre, email, mensaje, conversacion) VALUES (?, ?, ?, ?)'
  )
    .bind(lead.nombre, lead.email, lead.mensaje, lead.conversacion)
    .run();

  if (!res.success) {
    console.error('INSERT falló:', res.error);
    return null;
  }
  return res.meta ? res.meta.last_row_id : null;
}

/** HTML del panel privado. El CSS se sustituye en el servidor. */
export function panelHtml(env, token) {
  return PANEL_HTML.replace('__CSS__', PANEL_CSS).replace('__TOKEN__', token);
}

const EMAIL_RE =
  /^[^\s@,;:<>()\[\]\\]+@[^\s@.,;:<>()\[\]\\]+(\.[^\s@.,;:<>()\[\]\\]+)+$/;

function limpia(valor, max) {
  return String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function limpiaMultilinea(valor, max) {
  return String(valor ?? '')
    .replace(/\r/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max);
}

const PANEL_CSS = `:root{--bg:#0a0a0a;--ink:#f5f0e8;--gold:#c9a84c;--line:rgba(201,168,76,.28);--muted:rgba(245,240,232,.6)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 'DM Sans',system-ui,sans-serif;padding:32px 20px}
.wrap{max-width:980px;margin:0 auto}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-size:2rem;font-weight:500;margin:0 0 6px}
.sub{color:var(--muted);margin:0 0 26px;font-size:14px}
.bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:22px}
.count{color:var(--gold);font-size:14px}
.bar a,.bar button{color:var(--gold);border:1px solid var(--line);background:none;border-radius:8px;padding:7px 13px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none}
.bar a:hover,.bar button:hover{background:rgba(201,168,76,.12)}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;color:var(--gold);font-weight:500;padding:10px 12px;border-bottom:1px solid var(--line);font-size:12px;letter-spacing:.05em;text-transform:uppercase}
td{padding:13px 12px;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top}
tr:hover td{background:rgba(255,255,255,.02)}
.mail{color:var(--gold);text-decoration:none;overflow-wrap:anywhere}
.mail:hover{text-decoration:underline}
.msg{color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;max-width:420px}
.ctx{color:var(--muted);font-size:12.5px;white-space:pre-wrap;max-height:9em;overflow:auto;max-width:340px}
.date{color:var(--muted);white-space:nowrap;font-size:13px}
.empty{color:var(--muted);text-align:center;padding:56px 0;border:1px dashed var(--line);border-radius:12px}
a.mail-p{color:var(--gold)}`;

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Contactos — Agente Universal</title>
<style>__CSS__</style>
</head>
<body>
<div class="wrap">
  <h1>Contactos</h1>
  <p class="sub">Lo que dejan las personas en el chat del widget.</p>
  <div class="bar">
    <span class="count">__COUNT__</span>
    <a href="/leads.csv?token=__TOKEN__" class="mail-p">Descargar CSV</a>
    <a href="/">Volver al chat</a>
  </div>
__ROWS__
</div>
</body>
</html>`;

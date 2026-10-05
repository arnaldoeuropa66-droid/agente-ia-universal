/**
 * Agente de chat con IA para cualquier web.
 * Workers AI (gratis) + conversación con memoria corta + captura de contactos.
 *
 *   POST /api/chat   -> { reply }
 *   GET  /widget.js  -> el widget que se incrusta en la web
 *   GET  /widget.css -> estilos del widget (sirve el mismo fichero independientemente del binding)
 *   POST /api/lead   -> { nombre, email, mensaje, conversacion } -> D1
 *   GET  /leads      -> panel privado de contactos (con token)
 *   GET  /leads.csv  -> exporta el panel a CSV (con token)
 *
 * Variables de entorno (en el Worker, no en el widget):
 *   IA     (optional binding del modelo de Workers AI; si no hay, se usa el valor de MODELO)
 *   MODELO (optional, string) — modelo por defecto. Si no hay, se deja el modelo predeterminado.
 *   RATELIMIT  (optional KV) — límite de peticiones por IP.
 *   AGENTE_LEADS (optional D1) — tabla de contactos.
 *   PANEL_TOKEN  (optional) — autoriza /leads y /leads.csv.
 *
 * El widget es un solo <script>: el CSS se incrusta en el propio fichero.
 */

import { validarLead, guardarLead, panelHtml } from './leads.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TURNS = 12;
const MAX_PER_WINDOW = 12;
const KV_TTL = 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

/* ---------- límite de peticiones por IP (KV, no Map en memoria) ---------- */
async function rateLimited(env, ip) {
  if (!env.Ratelimit) return false;
  const key = 'rl:' + ip;
  let count = 0;
  try {
    count = Number((await env.Ratelimit.get(key, 'text')) || 0);
  } catch (err) {
    console.error('rate limit read failed:', err && err.message);
    return false;
  }
  if (count >= MAX_PER_WINDOW) return true;
  try {
    await env.Ratelimit.put(key, String(count + 1), { expirationTtl: KV_TTL });
  } catch (err) {
    console.error('rate limit write failed:', err && err.message);
  }
  return false;
}

/**
 * Construye los mensajes del modelo: system + historial reciente.
 * El system es fijo (CONSTANTE, no varía según la web).
 */
function buildMessages(history, system) {
  const msgs = [{ role: 'system', content: system }];
  const clean = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
    .slice(-MAX_TURNS);
  return msgs.concat(clean);
}

/**
 * Modelo a usar: preferimos el binding IA (Workers AI), y si no hay, el MODELO
 * de entorno. Si no hay ninguno, falla con un error claro.
 */
function modeloConfig(env) {
  const fromEnv = env.MODELO && String(env.MODELO).trim().length > 0
    ? String(env.MODELO).trim()
    : DEFAULT_MODEL;
  const binding = env.IA;
  return { binding, fromEnv };
}

const SYSTEM = `Eres un asistente de atención a clientes y asesoramiento web. Atiendes a personas que visitan una web y te preguntan por servicios, precios, plazos, soporte, contacto, etc.

Tu carácter: cercano, directo y profesional. Tuteas. Frases cortas, sin rodeos. No empieces cada respuesta con "¡Hola!" ni "Claro". Si no sabes algo, lo dices sin inventar.

Sobre qué puedes hablar: los servicios, precios y plazos que la web del visitante publica (fuente: el contenido de la web a la que estás incrustado). Tu única fuente de verdad es el contexto que se te pasa en el sistema. Cita los datos exactos de ahí, sin redondear ni inventar.

Reglas:
- Responde siempre en el idioma en que escriba el visitante (español por defecto, pero lo detectas).
- No inventes precios, plazos, tecnologías ni características. Si no lo sabes, di que no lo sabes, y orienta a contactar.
- Las preguntas sobre datos concretos de la web (precios, plazos, servicios, FAQ) se responden con la información que la web publica.
- Si el visitante pregunta por algo que no está en la web, ofrece hablarlo con detalle pasando a contacto.
- Invita a contactar una sola vez, al final, solo si hay interés real (pregunta por presupuesto, dice que necesita una web, quiere empezar, pide descuento o quiere hablar contigo). Nunca como sustituto de la respuesta.
- No uses emoji decorativos ni listas gigantes.
- Si preguntan por un plan, di cuál encaja mejor y por qué, citando lo que hay en el contexto.
- El canal destacado de esta web es el que la web indique (generalmente WhatsApp). Mencionalo cuando tenga sentido; el botón de email también está disponible.
- Si el visitante quiere dejar un mensaje, ofrece abrir su correo con el texto ya redactado (el botón del chat lo hace por ti).
- Si la persona muestra interés real en contratar, cierra ofreciendo dejar su contacto: "si quieres, deja tu nombre y tu email aquí y te contesto yo". Una vez, con naturalidad, y no insistas.

Responde en 2-4 frases. Si la pregunta es técnica y pide detalle, puedes alargar.`;

function guardarLeadSafe(env, lead) {
  if (!env.AgenteLeads) {
    console.error('D1 AGENTE_LEADS no esta enlazado');
    return null;
  }
  return guardarLead(env, lead);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/widget.js') {
      // El CSS se incrusta: el widget es un solo <script> y no depende de la hoja de estilos de la web.
      const js = 'window.EFECTOBERMU_WIDGET_CSS=' + JSON.stringify(WIDGET_CSS) + ';\n' + WIDGET_JS;
      return new Response(js, {
        headers: { 'content-type': 'application/javascript; charset=utf-8', ...CORS },
      });
    }

    if (url.pathname === '/widget.css') {
      return new Response(WIDGET_CSS, {
        headers: { 'content-type': 'text/css; charset=utf-8', ...CORS },
      });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      const ip = request.headers.get('cf-connecting-ip') || 'local';
      if (await rateLimited(env, ip)) {
        return json({ error: 'Demasiadas preguntas seguidas. Espera un minuto.' }, 429);
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: 'Petición no válida.' }, 400);
      }

      const history = Array.isArray(payload.history) ? payload.history : [];
      if (!history.length || history[history.length - 1].role !== 'user') {
        return json({ error: 'No hay mensaje.' }, 400);
      }

      const { binding, fromEnv } = modeloConfig(env);
      const model = binding || fromEnv;

      try {
        const result = await env.IA.run(model, {
          messages: buildMessages(history, SYSTEM),
          max_tokens: 400,
          temperature: 0.3,
        });
        const reply = (result && result.response) || '';
        if (!reply) {
          return json({ error: 'El modelo no ha devuelto nada. Inténtalo otra vez.' }, 502);
        }
        return json({ reply: reply.trim() });
      } catch (err) {
        console.error('AI error:', err && err.message);
        return json(
          { error: 'Ahora mismo no puedo responder. Puedes escribir directamente a hola@efectobermu.com.' },
          502
        );
      }
    }

    // Contactos: se resuelven antes de responder con el JSON por defecto.
    const leads = await handleLeads(request, env, url);
    if (leads) return leads;

    return json({ ok: true, name: 'agente-ia-universal' });
  },
};

/* ------------------------------------------------------------------ */
/* Contactos                                                         */
/* ------------------------------------------------------------------ */

/** El panel exige un token que es una credencial: misma respuesta siempre. */
function panelAuthorized(request, env, url) {
  if (!env.PanelToken) return false;
  const given = url.searchParams.get('token') || '';
  if (!given) return false;
  // Comparacion de longitud constante para no filtrar por temporizacion
  if (given.length !== env.PanelToken.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) {
    diff |= given.charCodeAt(i) ^ env.PanelToken.charCodeAt(i);
  }
  return diff === 0;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCampo(s) {
  const v = String(s ?? '');
  return /[\",\n\r]/.test(v) ? '"' + v.replace(/\"/g, '""') + '"' : v;
}

async function leadsRows(env) {
  if (!env.AgenteLeads) return [];
  const { results } = await env.AgenteLeads.prepare(
    'SELECT id, created_at, nombre, email, mensaje, conversacion FROM leads ORDER BY id DESC LIMIT 500'
  ).all();
  return results || [];
}

async function handleLeads(request, env, url) {
  // --- escribir ---
  if (url.pathname === '/api/lead' && request.method === 'POST') {
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    if (await rateLimited(env, ip)) {
      return json({ error: 'Demasiados envios seguidos. Espera un minuto.' }, 429);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Petición no válida.' }, 400);
    }

    const { error, lead } = validarLead(payload);
    if (error) return json({ error }, 400);

    try {
      const id = await guardarLeadSafe(env, lead);
      if (!id) {
        return json(
          { error: 'No he podido guardar el contacto. Escríbeme a hola@efectobermu.com y lo dejamos ahí.' },
          502
        );
      }
      return json({ ok: true, id });
    } catch (err) {
      console.error('lead insert error:', err && err.message);
      return json({ error: 'No he podido guardar el contacto.' }, 502);
    }
  }

  // --- ver ---
  if (url.pathname === '/leads') {
    if (!env.PanelToken) {
      return new Response('Panel sin configurar.', { status: 503 });
    }
    if (!panelAuthorized(request, env, url)) {
      return new Response('<!DOCTYPE html><meta charset="utf-8"><title>Sin acceso</title>' +
        '<body style="background:#0a0a0a;color:#f5f0e8;font:16px system-ui;padding:40px">' +
        '<h1 style="font-weight:400">Sin acceso</h1>' +
        '<p>Necesitas el enlace completo con el token.</p></body>',
        { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    const rows = await leadsRows(env);
    const html = panelHtml(env, url.searchParams.get('token'))
      .replace('__COUNT__', String(rows.length) + (rows.length === 1 ? ' contacto' : ' contactos'))
      .replace('__ROWS__', rows.length
        ? '<table><thead><tr><th>Fecha</th><th>Nombre</th><th>Email</th><th>Necesita</th>' +
          '<th>Chat</th></tr></thead><tbody>' +
          rows.map((r) =>
            '<tr><td class="date">' + escapeHtml(r.created_at) + '</td>' +
            '<td>' + escapeHtml(r.nombre) + '</td>' +
            '<td><a class="mail" href="mailto:' + escapeHtml(r.email) + '">' + escapeHtml(r.email) + '</a></td>' +
            '<td class="msg">' + escapeHtml(r.mensaje) + '</td>' +
            '<td class="ctx">' + escapeHtml(r.conversacion || '—') + '</td></tr>'
          ).join('') +
          '</tbody></table>'
        : '<div class="empty">Todavía no ha dejado nadie su contacto.</div>');

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  // --- CSV ---
  if (url.pathname === '/leads.csv') {
    if (!env.PanelToken) return new Response('Panel sin configurar.', { status: 503 });
    if (!panelAuthorized(request, env, url)) {
      return new Response('Sin acceso.', { status: 401 });
    }

    const rows = await leadsRows(env);
    const csv = [
      ['fecha', 'nombre', 'email', 'necesita', 'chat'].join(','),
      ...rows.map((r) =>
        [r.created_at, r.nombre, r.email, r.mensaje, r.conversacion].map(csvCampo).join(',')
      ),
    ].join('\r\n');

    return new Response('\uFEFF' + csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="contactos-efectobermu.csv"',
        'cache-control': 'no-store',
      },
    });
  }

  return null;
}

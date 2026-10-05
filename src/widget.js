/**
 * Widget que se incrusta en cualquier web.
 * Se sirve como texto plano desde el Worker; todo el JS de cliente usa
 * concatenación en vez de plantillas (para no chocar con los acentos graves).
 *
 * El CSS se incrusta dentro del propio fichero:
 *   window.EFECTOBERMU_WIDGET_CSS = '...'**
 * El CSS está en src/widget.css, que se sirve sin build desde el Worker.
 *
 * Ruta base: la que define window.EFECTOBERMU_API.
 */

export default `(function () {
  'use strict';

  if (window.__efectobermuAgente) return;

  var API = window.EFECTOBERMU_API || '';
  var MAIL = 'hola@efectobermu.com';
  var history = [];

  /* ---------- estilos ---------- */
  var style = document.createElement('style');
  style.textContent = window.EFECTOBERMU_WIDGET_CSS || '';
  document.head.appendChild(style);

  /* ---------- markup ---------- */
  var root = document.createElement('div');
  root.className = 'eb-agent';
  root.innerHTML =
    '<button class="eb-agent__fab" type="button" aria-label="Abrir el chat de EfectoBermu" aria-expanded="false">' +
      '<span class="eb-agent__fab-dot"></span>' +
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
        '<path d="M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3v4l4.5-4H20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" ' +
          'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '</svg>' +
    '</button>' +

    '<section class="eb-agent__panel" role="dialog" aria-label="Chat con EfectoBermu" aria-hidden="true">' +
      '<header class="eb-agent__head">' +
        '<div class="eb-agent__id">' +
          '<span class="eb-agent__avatar">E</span>' +
          '<div>' +
            '<p class="eb-agent__name">EfectoBermu</p>' +
            '<p class="eb-agent__status">Responde al momento</p>' +
          '</div>' +
        '</div>' +
        '<button class="eb-agent__close" type="button" aria-label="Cerrar el chat">&times;</button>' +
      '</header>' +

      '<div class="eb-agent__log" aria-live="polite"></div>' +

      '<div class="eb-agent__actions">' +
        '<button class="eb-agent__mail" type="button">Email</button>' +
        '<a class="eb-agent__mail eb-agent__wa" href="https://wa.me/34600385615" target="_blank" rel="noopener">WhatsApp</a>' +
        '<button class="eb-agent__lead-open" type="button">Dejar contacto</button>' +
      '</div>' +

      '<form class="eb-agent__form" autocomplete="off">' +
        '<input class="eb-agent__input" type="text" placeholder="Escribe tu pregunta…" aria-label="Mensaje" maxlength="500">' +
        '<button class="eb-agent__send" type="submit" aria-label="Enviar">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
            '<path d="M4 12 20 4l-6 16-2.5-6.5L4 12Z" fill="none" stroke="currentColor" stroke-width="1.7" ' +
              'stroke-linejoin="round"/>' +
          '</svg>' +
        '</button>' +
      '</form>' +
      '<p class="eb-agent__note">La conversación solo vive en esta pestaña: al recargar, empieza de cero. ' +
        '<button class="eb-agent__reset" type="button">Empezar de nuevo</button></p>' +

      // Formulario de contacto. Aparece al pedirlo el visitante; no se ofrece
      // solo, para no parecer un formulario de spam.
      '<div class="eb-agent__lead" hidden>' +
        '<p class="eb-agent__lead-title">Déjame tu contacto y te contesto</p>' +
        '<form class="eb-agent__lead-form" autocomplete="on" novalidate>' +
          '<input class="eb-agent__lead-nombre" type="text" placeholder="Tu nombre" aria-label="Nombre" maxlength="120">' +
          // type=text y no email: el navegador rechaza .example y otras direcciones
          // raras con su propio mensaje en inglés, que ignora el novalidate del
          // formulario (ese atributo no cubre la validación de tipo email).
          // La validación real la hacen esta función y el Worker.
          '<input class="eb-agent__lead-email" type="text" inputmode="email" ' +
            'autocapitalize="off" autocorrect="off" spellcheck="false" ' +
            'placeholder="Tu email" aria-label="Email" maxlength="200">' +
          '<textarea class="eb-agent__lead-mensaje" placeholder="¿Qué necesitas?" aria-label="Qué necesitas" ' +
            'maxlength="2000" rows="3"></textarea>' +
          '<div class="eb-agent__lead-actions">' +
            '<button class="eb-agent__lead-send" type="submit">Enviar</button>' +
            '<button class="eb-agent__lead-cancel" type="button">Ahora no</button>' +
          '</div>' +
          '<p class="eb-agent__lead-note" role="status"></p>' +
        '</form>' +
        '<p class="eb-agent__lead-privacy">Solo guardo tu nombre, tu email y lo que escribas aquí. Nada más.</p>' +
      '</div>' +
    '</section>';
  document.body.appendChild(root);

  var fab = root.querySelector('.eb-agent__fab');
  var panel = root.querySelector('.eb-agent__panel');
  var log = root.querySelector('.eb-agent__log');
  var form = root.querySelector('.eb-agent__form');
  var input = root.querySelector('.eb-agent__input');
  var sendBtn = root.querySelector('.eb-agent__send');
  var mailBtn = root.querySelector('.eb-agent__mail');
  var resetBtn = root.querySelector('.eb-agent__reset');
  var closeBtn = root.querySelector('.eb-agent__close');

  /* ---------- mensajes ---------- */
  function bubble(text, who) {
    var el = document.createElement('div');
    el.className = 'eb-agent__msg eb-agent__msg--' + who;
    el.textContent = text;
    log.appendChild(el);
    // Autoscroll al final. Con scroll-behavior suave no se ve el salto y no
    // corta la lectura si el visitante esta leyendo mas arriba.
    log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    return el;
  }

  function typing() {
    var el = document.createElement('div');
    el.className = 'eb-agent__msg eb-agent__msg--bot eb-agent__typing';
    el.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(el);
    log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
    return el;
  }

  /* Las preguntas sugeridas estorban: ocupaban 125 px de un panel de 480 y
     dejaban el log de conversacion en 106 px, con una respuesta normal ya
     cortada. Se ocultan en cuanto el visitante entra en la conversacion; no se
     borran del DOM, para que «Empezar de nuevo» pueda volver a enseñarlas. */
  var chipsRetiradas = false;

  function retiraChips() {
    if (chipsRetiradas || !chipsEl) return;
    chipsRetiradas = true;
    chipsEl.hidden = true;
  }

  var GREETING =
    'Hola, soy el asistente de EfectoBermu. Te explico los servicios, los precios y los plazos, o te ayudo a decidir qué plan te encaja.';

  function reset() {
    history = [];
    log.innerHTML = '';
    bubble(GREETING, 'bot');
    // «Empezar de nuevo» devuelve las sugerencias, para que quien empieza de
    // cero las tenga delante otra vez.
    if (chipsRetiradas && chipsEl) {
      chipsEl.hidden = false;
      chipsRetiradas = false;
    }
  }

  /* ---------- envío ---------- */
  var busy = false;

  function reply(text) {
    if (!text) return;
    history.push({ role: 'assistant', content: text });
    bubble(text, 'bot');
    enableMail();
  }

  function enableMail() {
    mailBtn.disabled = false;
  }

  function ask(question) {
    if (busy) return;
    var value = question || input.value.trim();
    if (!value) return;

    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    retiraChips();
    bubble(value, 'user');
    history.push({ role: 'user', content: value });

    var dots = typing();

    if (!API) {
      dots.remove();
      busy = false;
      sendBtn.disabled = false;
      reply('Ahora mismo estoy sin conexión con el servidor. Escríbeme a ' + MAIL + ' y te contesto por ahí.');
      return;
    }

    fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ history: history.slice(-12) })
    })
      .then(function (r) {
        return r.json().then(function (data) { return { ok: r.ok, data: data }; });
      })
      .then(function (res) {
        dots.remove();
        if (!res.ok) throw new Error((res.data && res.data.error) || 'Sin respuesta');
        reply(res.data.reply);
      })
      .catch(function (err) {
        dots.remove();
        var why = err && err.message ? err.message : 'Sin respuesta';
        bubble(why, 'bot');
      })
      .then(function () {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  /* ---------- contacto ---------- */
  var leadBox = root.querySelector('.eb-agent__lead');
  var leadOpen = root.querySelector('.eb-agent__lead-open');
  var leadForm = root.querySelector('.eb-agent__lead-form');
  var leadNote = root.querySelector('.eb-agent__lead-note');
  var fNombre = root.querySelector('.eb-agent__lead-nombre');
  var fEmail = root.querySelector('.eb-agent__lead-email');
  var fMensaje = root.querySelector('.eb-agent__lead-mensaje');
  var leadSend = root.querySelector('.eb-agent__lead-send');
  var leadCancel = root.querySelector('.eb-agent__lead-cancel');

  function abrirLead() {
    if (!leadBox) return;
    leadBox.hidden = false;
    // El mensaje se precarga con lo que ya ha contado en el chat, para no
    // obligarle a repetirlo.
    if (fMensaje && !fMensaje.value) {
      var said = transcript().split('\\n\\n---\\n\\n').filter(function (s) { return s.trim(); });
      if (said.length) fMensaje.value = said.join(' / ');
    }
    if (fNombre) fNombre.focus();
  }

  function cerrarLead() {
    if (!leadBox) return;
    leadBox.hidden = true;
    if (leadNote) leadNote.textContent = '';
  }

  if (leadOpen) leadOpen.addEventListener('click', abrirLead);
  if (leadCancel) leadCancel.addEventListener('click', cerrarLead);

  function sayLead(msg, ok) {
    if (!leadNote) return;
    leadNote.textContent = msg;
    leadNote.className = 'eb-agent__lead-note' + (ok ? ' is-ok' : ' is-error');
  }

  if (leadForm) {
    leadForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!API) {
        sayLead('Ahora mismo estoy sin conexión. Escríbeme a ' + MAIL + '.', false);
        return;
      }

      // El navegador bloquea el submit por los atributos required y muestra su
      // propio aviso, que no encaja con el estilo del panel. Por eso el
      // formulario lleva novalidate desde el HTML y la validación se hace
      // aquí, para controlar el mensaje y el idioma.
      var nombre = fNombre ? fNombre.value.trim() : '';
      var email = fEmail ? fEmail.value.trim() : '';
      var mensaje = fMensaje ? fMensaje.value.trim() : '';

      // Validación en cliente solo para ahorrar una ida al servidor; el Worker
      // repite cada comprobación y es la que decide.
      if (nombre.length < 2) return sayLead('Escribe tu nombre.', false);
      if (!email) return sayLead('Escribe tu email.', false);
      // Comprobación mínima: solo que haya algo antes y después de la arroba.
      // El Worker aplica la validación real; aquí se evita el viaje para un
      // error obvio, sin rechazar direcciones legitimas que el regex
      // del servidor sí acepta.
      // Este regex viaja dentro de un string JS que a su vez se sirve como
      // texto, asi que los escapes se interpretan dos veces: hay que
      // duplicarlos. Con un solo backslash, el \\\\s desaparecia y el punto se
      // quedaba sin escapar (cualquier caracter).
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        return sayLead('Revisa el email, parece incompleto.', false);
      }
      if (mensaje.length < 3) return sayLead('Cuenta un poco qué necesitas.', false);

      leadSend.disabled = true;
      sayLead('Enviando…', true);

      fetch(API + '/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          email: email,
          mensaje: mensaje,
          conversacion: transcript()
        })
      })
        .then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, data: d }; });
        })
        .then(function (res) {
          if (!res.ok) throw new Error((res.data && res.data.error) || 'No se ha podido enviar.');
          leadForm.reset();
          sayLead('Listo. Te contesto por email lo antes posible.', true);
          // Oculta el formulario y deja el aviso visible
          leadForm.style.display = 'none';
          root.querySelector('.eb-agent__lead-title').textContent = 'Contacto enviado';
          leadSend.disabled = false;
        })
        .catch(function (err) {
          sayLead((err && err.message) || 'No se ha podido enviar.', false);
          leadSend.disabled = false;
        });
    });
  }

  /* ---------- email ---------- */
  function transcript() {
    var lines = [];
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      if (m.role === 'user') lines.push(m.content);
    }
    if (!lines.length) lines.push('(escribo por aquí)');
    return lines.join('\\n\\n---\\n\\n');
  }

  function byEmail() {
    var subject = 'Consulta desde efectobermu.com';
    var body =
      'Hola Arnaldo,\n\n' +
      'Te escribo desde el chat de la web:\n\n' +
      transcript() +
      '\n\n---' +
      'Enviado desde el chat de efectobermu.com';
    window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
  }

  /* ---------- eventos ---------- */
  fab.addEventListener('click', function () {
    var open = root.classList.toggle('is-open');
    fab.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) input.focus();
  });

  closeBtn.addEventListener('click', function () {
    root.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    fab.focus();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ask();
  });

  mailBtn.addEventListener('click', byEmail);

  resetBtn.addEventListener('click', function () {
    reset();
    mailBtn.disabled = true;
    input.focus();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('is-open')) closeBtn.click();
  });

  /* ---------- saludos sugeridos ---------- */
  var chips = ['¿Cuánto cuesta una web?', '¿Qué plan me recomiendas?', '¿En cuánto tiempo la tengo?'];
  var chipsEl = document.createElement('div');
  chipsEl.className = 'eb-agent__chips';
  chips.forEach(function (label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'eb-agent__chip';
    b.textContent = label;
    b.addEventListener('click', function () { ask(label); });
    chipsEl.appendChild(b);
  });
  log.parentNode.insertBefore(chipsEl, log.nextSibling);

  reset();
  mailBtn.disabled = true;
  window.__efectobermuAgente = true;
})();
`;

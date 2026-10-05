/** Panel privado del widget.
 *
 * El HTML va como string porque se sirve desde el Worker sin build. Los tokens
 * se sustituyen en el servidor; no hay nada dinámico del cliente más allá del
 * enlace de descarga a CSV.
 */
export default `<!DOCTYPE html>
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

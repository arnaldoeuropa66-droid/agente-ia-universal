# Agente de chat con IA para cualquier web

Un widget de chat con IA que se incrusta en cualquier página web. El widget
es un único `<script>` que se carga desde el Worker y responde con los datos
reales de la web que lo contiene, sin tocar el markup de la página.

## Características

- **Un solo `<script>`**: el CSS se incrusta dentro del mismo fichero, no
  depende de la hoja de estilos de la web.
- **Contexto extraído de la propia web**: el Worker responde con la información
  que la web publica (servicios, precios, FAQ, contacto), sin inventar nada.
- **Configurable para cualquier web**: el extractor (`tools/extraer-conocimiento.mjs`)
  convierte el HTML de la web en un `knowledge.js` con el contexto del agente.
- **Captura de contactos**: el visitante puede dejar nombre, email y mensaje.
  Los datos se guardan en una base D1 y se pueden ver en un panel privado.
- **Ratelimit por IP**: 12 preguntas por minuto con Workers KV (un `Map` en
  memoria no persistiría entre peticiones, que se ejecutan en isolate distintos).
- **Modelo gratuito**: Workers AI (sin tarjeta ni API keys).

## Estructura

```
agente-ia-universal/
├── package.json
├── wrangler.toml
├── .dev.vars.example
├── .gitignore
└── src/
    ├── index.js      # Worker: /api/chat, /widget.js, /leads, /leads.csv
    ├── leads.js       # Validación y guardado de contactos
    ├── panel.js       # HTML del panel privado de contactos
    ├── widget.js      # El chat que se incrusta en la web
    └── widget.css     # Estilos del widget
└── tools/
    └── extraer-conocimiento.mjs   # Convierte una web en contexto
```

## Despliegue

1. **Prepara la infraestructura en Cloudflare:**
   - Un namespace KV para el ratelimit (`RATELIMIT`)
   - Una base D1 `AGENTE_LEADS` para los contactos
   - Llena `wrangler.toml` con los IDs (`[[kv_namespaces]]`, `[[d1_databases]]`)

2. **Genera el contexto de la web:**
   ```
   node tools/extraer-conocimiento.mjs \
     "http://la-web.com/index.html" \
     src/knowledge.js
   ```

3. **Despliega el Worker:**
   ```
   npx wrangler deploy
   ```

4. **Incrusta el widget en la web** antes de `</body>`:
   ```html
   <script>
     window.EFECTOBERMU_API = 'https://tu-worker.workers.dev';
   </script>
   <script src="https://tu-worker.workers.dev/widget.js" defer></script>
   ```

## Comandos

```
npm run dev      # Servidor local
npm run deploy   # Despliega
```

## Modelo

Por defecto usa `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI,
gratis). Si lo prefieres, puedes cambiarlo en `MODELO` del `.dev.vars`.

## Limite de uso

12 preguntas por minuto y IP; la 13ª da 429. El límite se aplica con Workers KV
porque cada petición corre en un isolate distinto y un `Map` local no persiste.

## Coste

0 €. Con uso normal de una web de servicios, no se llega al límite.

/**
 * Extractor genérico: convierte una web en el contexto de un agente IA.
 *
 *   node tools/extraer-conocimiento.mjs <url-o-fichero.html> [salida.js]
 *
 * No presupone el markup de ninguna web. Busca por semántica (JSON-LD, etiquetas
 * de encabezado, FAQ, precios y contacto) y lo que no encuentra no lo inventa:
 * solo lo omite.
 *
 * Como genera un `knowledge.js` completo, el Worker no necesita saber el nombre
 * de la web: la fuente es la página que va a embebirse.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const arg = process.argv[2];
if (!arg) {
  console.error('Uso: node tools/extraer-conocimiento.mjs <url|archivo.html> [salida.js]');
  process.exit(1);
}

let html = '';
let url = '';

// Si el argumento es una URL (empieza por http:// o https://), la descargamos.
if (arg.startsWith('https://') || arg.startsWith('http://')) {
  url = arg;
  const res = await fetch(arg, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; AgenteUniversalBot/1.0)',
      accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    console.error(`No se pudo descargar ${arg}: HTTP ${res.status}`);
    process.exit(1);
  }
  html = await res.text();
  url = res.url || arg;
} else {
  html = readFileSync(arg, 'utf8');
}

/* ---------------------------------------------------------------- */
/* texto                                                           */
/* ---------------------------------------------------------------- */

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', ldquo: '"', rdquo: '"',
};

function texto(frag) {
  return String(frag ?? '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Igual que texto(), pero cada elemento de bloque de nivel se convierte en
 *  su propia línea. Sin esto dos <li> contiguos se pegan y al buscar un precio
 *  sale la línea entera mezclada. <span> no se parte: los precios suelen venir
 *  en <span class="price-number">299</span><span class="price-currency">€</span>,
 *  y partirlos dejaba "299" y "€" en líneas sueltas. */
function porLineas(frag) {
  return String(frag ?? '')
    .replace(/<\/(?:li|p|div|h[1-6]|section|tr|td|dd|dt|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const sinRepetir = (arr) => [...new Set(arr.filter(Boolean))];
const corta = (v, max) => String(v ?? '').trim().slice(0, max);

/* ---------------------------------------------------------------- */
/* 1. identidad                                                    */
/* ---------------------------------------------------------------- */

const ld = [];
for (const m of html.matchAll(
  /<script[^>]+type=["'][^"']*\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
)) {
  try {
    const json = JSON.parse(m[1].trim());
    const lista = Array.isArray(json) ? json : json['@graph'] ?? [json];
    for (const item of lista) {
      if (item && typeof item === 'object') ld.push(item);
    }
  } catch {
    /* JSON inválido: se ignora */
  }
}

const deTipo = (tipo) =>
  ld.filter((d) => {
    const t = d['@type'];
    return Array.isArray(t) ? t.includes(tipo) : t === tipo;
  });

const nodo = deTipo('Organization')[0] ?? deTipo('LocalBusiness')[0] ?? deTipo('Person')[0] ?? {};
const sitio = deTipo('WebSite')[0] ?? {};

const titulo = corta(html.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i)?.[1], 160);
const nombre =
  corta(nodo.name, 120) ||
  corta(html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1], 120) ||
  corta(sitio.name, 120) ||
  titulo ||
  'la web';

const descripcion =
  corta(nodo.description, 300) ||
  corta(sitio.description, 300) ||
  corta(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1], 300) ||
  '';

/* ---------------------------------------------------------------- */
/* 2. contacto                                                     */
/* ---------------------------------------------------------------- */

const emails = sinRepetir([
  ...[...html.matchAll(/mailto:([^\"'?>\s]+)/gi)].map((m) => m[1]),
  ...[...html.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0]),
])
  .filter((e) => !/^(sentry|wp|noreply|example|test|abc)@/i.test(e))
  .map((e) => e.toLowerCase());

const whatsapp = html.match(/wa\.me\/(\d{6,})/i)?.[1] ?? null;
const telefono = corta(html.match(/tel:\+?([0-9 ()-]{9,})/i)?.[1] ?? '', 30) || null;
const instagram = html.match(/instagram\.com\/([A-Za-z0-9_.]{2,30})/i)?.[1] ?? null;
const linkedin = html.match(/linkedin\.com\/(?:in|company)\/([A-Za-z0-9_-]{2,60})/i)?.[1] ?? null;
const direccion = corta(texto(nodo.address?.streetAddress ?? ''), 120);

const contacto = [
  emails.length ? `Email: ${emails.slice(0, 3).join(', ')}` : null,
  whatsapp ? `WhatsApp: ${whatsapp} (https://wa.me/${whatsapp})` : null,
  telefono ? `Telefono: ${telefono}` : null,
  direccion ? `Direccion: ${direccion}` : null,
  instagram ? `Instagram: @${instagram}` : null,
  linkedin ? `LinkedIn: ${linkedin}` : null,
].filter(Boolean);

/* ---------------------------------------------------------------- */
/* 3. servicios: encabezado + su párrafo                           */
/* ---------------------------------------------------------------- */

const mapa = new Map();
for (const m of html.matchAll(
  /<h([23])[^>]*>([\s\S]{0,140}?)<\/h\1>([\s\S]{0,800}?)<(?:p|li)[^>]*>([\s\S]{0,400}?)<\/(?:p|li)>/gi
)) {
  const t = texto(m[2]);
  const d = texto(m[4]);
  if (t.length < 3 || t.length > 70 || d.length < 25) continue;
  const prev = mapa.get(t.toLowerCase());
  if (!prev || d.length > prev.length) mapa.set(t.toLowerCase(), { t, d });
}

/* ---------------------------------------------------------------- */
/* 4. precios                                                      */
/* ---------------------------------------------------------------- */

/** Se trabaja sobre el texto partido en líneas: cada web coloca el precio en
 *  un elemento distinto (un span, un h4, un data-price) y la única estructura
 *  común es el texto "algo 299 €". */
const RE_IMPORTE = /(\d{1,6}(?:[.,]\d{3})*(?:\.\d{1,2})?)\s*(?:€|eur|euros|USD|dinero|pts)/i;
const planes = [];
const vistos = new Set();

// --- estructuras CSS (.price-name + .price-number + .price-currency) ---
for (const card of html.matchAll(
  /<div[^>]*class=["'][^"']*\bprice-card\b[^\"']*["'][^>]*>([\s\S]*?)<\/div>/gi
)) {
  const contenedor = card[1];
  const nombre = texto(contenedor.match(
    /class=["'][^"']*\bprice-name\b[^\"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )?.[1] ?? '');
  const numero = texto(contenedor.match(
    /class=["'][^"']*\bprice-number\b[^\"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )?.[1] ?? '');
  const moneda = texto(contenedor.match(
    /class=["'][^"']*\bprice-currency\b[^\"']*["'][^>]*>([\s\S]*?)<\/div>/i
  )?.[1] ?? '€');
  if (!nombre || !numero) continue;

  // Las características del plan (li dentro del mismo contenedor)
  const feats = [];
  for (const f of contenedor.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const t = texto(f[1]);
    if (t && t.length > 1) feats.push(t);
  }
  const clave = nombre.toLowerCase() + '|' + numero;
  if (vistos.has(clave)) continue;
  vistos.add(clave);

  planes.push({ nombre, importe: numero, moneda, feats });
}

// --- precios por texto "algo 299 €" (cuando no hay estructura CSS) ---
for (const linea of porLineas(html)) {
  if (linea.length > 200) continue;
  const m = linea.match(RE_IMPORTE);
  if (!m) continue;

  const importe = m[1].replace(',', '.');
  const n = Number(importe);
  if (!Number.isFinite(n) || n < 1) continue;

  const antes = linea.slice(0, m.index).trim();
  const plan = antes.split(/[.;:·|—]| {2,}/).pop()?.trim() ?? '';

  const clave = plan.toLowerCase() + '|' + importe;
  if (vistos.has(clave)) continue;
  vistos.add(clave);

  planes.push({ nombre: plan, importe, moneda: '€', feats: [] });
}

/* -- nombre de plan por estructura (clase conocida cerca del precio) --
 *    El texto de una tarjeta suele llegar como "Plan; Presencia Básica; 299 €; 5
 *    días; Landing page...", todo en la misma línea. Cuando hay un elemento cuyo
 *    nombre de clase dice "name" o "title" cerca de un importe, se usa ese nombre
 *    en vez del trozo de texto anterior. */
for (const m of html.matchAll(
  /class=["'][^"']*\b(?:price-name|plan-name|product-name|plan-title|pricing-name)\b[^\"']*["'][^>]*>([\s\S]{0,90}?)<\//gi
)) {
  const nombre = texto(m[1]);
  if (nombre.length < 2 || nombre.length > 60) continue;

  const desde = Math.max(0, m.index - 400);
  const hasta = Math.min(html.length, m.index + 400);
  let ventana = html.slice(desde, hasta);

  const importeEnBruto = ventana
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  const imp = importeEnBruto.match(RE_IMPORTE);
  if (!imp) continue;

  const importe = imp[1].replace(',', '.');

  const existente = planes.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase());

  if (existente) {
    existente.importe = importe;
    existente.fuente = 'estructura';
  } else {
    planes.push({
      nombre,
      importe,
      moneda: '€',
      feats: [],
      fuente: 'estructura',
    });
  }
}

/* -- eliminar duplicados por coincidencia de nombre (la estructura es más
 *    fiable que el texto) */
const planesPorNombre = new Map();
for (const p of planes) {
  const key = p.nombre.toLowerCase();
  if (!planesPorNombre.has(key) || (p.fuente === 'estructura' && planesPorNombre.get(key).fuente !== 'estructura')) {
    planesPorNombre.set(key, p);
  }
}
const planesUnicos = [...planesPorNombre.values()];

/* ---------------------------------------------------------------- */
/* 5. FAQ                                                          */
/* ---------------------------------------------------------------- */

const faqs = [];
const vistosFaq = new Set();
for (const m of html.matchAll(
  /<h([34])[^>]*>([\s\S]{0,240}?)<\/h\1>([\s\S]{0,900}?)<(?:p|div)[^>]*>([\s\S]{0,700}?)<\/(?:p|div)>/gi
)) {
  const q = texto(m[2]);
  const a = texto(m[4]);
  if (q.length < 10 || q.length > 220 || a.length < 25) continue;
  const clave = q.toLowerCase();
  if (vistosFaq.has(clave)) continue;
  vistosFaq.add(clave);
  faqs.push({ q, a });
}

/* ---------------------------------------------------------------- */
/* 6. cómo invita a contactar                                      */
/* ---------------------------------------------------------------- */

const cta = sinRepetir(
  [...html.matchAll(/<(?:h[12]|p|strong)[^>]*>([\s\S]{0,200}?)<\/(?:h[12]|p|strong)>/gi)]
    .map((m) => texto(m[1]))
    .filter((t) =>
      t.length > 15 && t.length < 200 &&
      /hablemos|contact|presupuest|cuéntame|cuenteme|escríbeme|escribeme|te cuento|empecemos|quieres|te propongo/i.test(t)
    )
).slice(0, 4);

/* ---------------------------------------------------------------- */
/* montaje                                                         */
/* ---------------------------------------------------------------- */

const partes = [];

partes.push(`SOBRE
- Nombre: ${nombre}
- Web: ${url || 'no indicada'}
- Titulo del sitio: ${titulo || 'no declarado'}
- Que ofrece: ${descripcion || 'no declarado'}`);

if (mapa.size) {
  partes.push(`SERVICIOS QUE PUBLICA
${[...mapa.values()].slice(0, 14).map((s) => `- ${s.t}: ${s.d}`).join('\n')}`);
}

if (planesUnicos.length) {
  const conEstructura = planesUnicos.filter((p) => p.fuente === 'estructura');
  const resto = planesUnicos.filter((p) => p.fuente !== 'estructura');

  const lineasPrecio = [
    ...conEstructura.map((p) => `- ${p.nombre}: ${p.importe} ${p.moneda}`),
    ...sinRepetir(resto.map((p) => (p.nombre ? `- ${p.nombre}: ${p.importe} ${p.moneda}` : `- ${p.importe} ${p.moneda}`))),
  ];
  partes.push(`PRECIOS PUBLICADOS
${sinRepetir(lineasPrecio).slice(0, 20).join('\n')}`);
}

if (faqs.length) {
  partes.push(`PREGUNTAS FRECUENTES
${faqs.slice(0, 12).map((f) => `P: ${f.q}\nR: ${f.a}`).join('\n\n')}`);
}

if (cta.length) {
  partes.push(`COMO INVITA A CONTACTAR
${cta.map((t) => '- ' + t).join('\n')}`);
}

if (contacto.length) {
  partes.push(`CONTACTAR
${contacto.map((t) => '- ' + t).join('\n')}`);
}

partes.push(`LIMITES
- Toda la informacion de arriba sale de esa misma web. Es la fuente de verdad.
- No inventes precios, plazos, condiciones ni servicios que no esten aqui. Si no lo sabes, dilo.
- Si la pregunta se sale de lo publicado, ofrece pasar a contacto para hablarlo con detalle.
- Cierra invitando a contactar UNA vez y al final, nunca como sustituto de la respuesta.`);

const contenido = partes.join('\n\n');

if (process.argv[3]) {
  writeFileSync(process.argv[3], `export default \`\`\n${contenido}\n\`\`;\n`, 'utf8');
  console.log('Escrito ' + process.argv[3]);
} else {
  console.log(contenido);
}

console.error(
  `[diagnostico] ${mapa.size} servicios, ${planesUnicos.length} precios, ` +
  `${faqs.length} faqs, ${contacto.length} contactos, ${contenido.length} caracteres`
);

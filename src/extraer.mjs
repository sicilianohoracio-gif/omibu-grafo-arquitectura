/* EXTRACTOR DE IMPORTS. De un mapa { ruta: texto } saca los imports como pares
 * [fichero origen, destino], donde destino es una ruta del mismo mapa (resuelta) o el
 * nombre de un paquete. No ejecuta nada: lee texto. Cubre lo que de verdad enlaza
 * módulos en las apps de la casa:
 *
 *   JS / JSX / MJS   import ... from, import '...', export ... from, import('...'), require('...')
 *   CSS              @import '...' y @import url(...)
 *   HTML             <script src>, <link rel="stylesheet" href> y los import de un <script type="module">
 *   Python           import a.b, from a.b import c, from .x import y
 *
 * Lo que NO ve, y se declara en vez de fingirlo: imports con ruta calculada
 * (import(variable), importlib), y cualquier enlace que no sea un import (HTTP, SQL,
 * bindings, colas, procesos). Eso no es una arista cruzable.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const CODIGO = /\.(?:js|jsx|mjs|cjs|ts|tsx|css|html|py)$/;
const SUFIJOS = ['', '.js', '.mjs', '.jsx', '.ts', '.tsx', '.cjs', '.json', '.css', '/index.js', '/index.mjs', '/index.jsx'];

/* Lee del disco los ficheros de código de `dirs` (rutas relativas a `root`; pueden ser
   ficheros sueltos). `skip` son expresiones contra la ruta relativa. */
export function leer(root, { dirs, ext = CODIGO, skip = [] }) {
  const out = {};
  const visita = abs => {
    const rel = relative(root, abs).split('\\').join('/');
    if (/(^|\/)(node_modules|\.git|\.wrangler|dist|__pycache__|\.venv)(\/|$)/.test(rel) || skip.some(re => re.test(rel))) return;
    if (statSync(abs).isDirectory()) { for (const entry of readdirSync(abs).sort()) visita(join(abs, entry)); return; }
    if (ext.test(rel)) out[rel] = readFileSync(abs, 'utf8');
  };
  for (const dir of dirs) visita(resolve(root, dir));
  return out;
}

const sinComentariosJs = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const JS = [
  /(?:^|[;\n}])\s*(?:import|export)\b[^'"`;()]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|[;\n}])\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const CSS = [/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g];
const HTML = [/<script\b[^>]*?\bsrc\s*=\s*['"]([^'"]+)['"]/gi, /<link\b(?=[^>]*\brel\s*=\s*['"]?stylesheet)[^>]*?\bhref\s*=\s*['"]([^'"]+)['"]/gi];
const REMOTO = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

function specsJs(text) { const limpio = sinComentariosJs(text); return JS.flatMap(re => [...limpio.matchAll(re)].map(m => m[1])); }
function specsHtml(text) {
  const limpio = text.replace(/<!--[\s\S]*?-->/g, '');
  const enlaces = HTML.flatMap(re => [...limpio.matchAll(re)].map(m => m[1].replace(/[?#].*$/, '')));
  const modulos = [...limpio.matchAll(/<script\b(?=[^>]*\btype\s*=\s*['"]module['"])(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => specsJs(m[1]));
  return { enlaces, modulos };
}
function specsPy(text) {
  const out = [];
  for (const linea of text.replace(/\\\n/g, ' ').split('\n')) {
    let m = linea.match(/^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)$/);
    if (m) { const nombres = m[2].replace(/[()]/g, '').split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean); out.push({ modulo: m[1], nombres }); continue; }
    m = linea.match(/^\s*import\s+([\w., ]+?)(?:\s+as\s+\w+)?\s*$/);
    if (m) for (const mod of m[1].split(',')) out.push({ modulo: mod.trim().split(/\s+as\s+/)[0], nombres: [] });
  }
  return out;
}

const limpia = ruta => normalize(ruta).split('\\').join('/').replace(/^\.\//, '');
function resuelve(base, conocidos) { for (const s of SUFIJOS) if (conocidos.has(limpia(base + s))) return limpia(base + s); return null; }
const paquete = spec => spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];

/* opts.conocidos: rutas que existen además de las de `sources` (los files[] del grafo que
   caen fuera del alcance leído). opts.webRoots: carpetas que el navegador ve como «/».
   opts.pyRoots: carpetas desde las que Python resuelve un import absoluto.
   Devuelve [{ from, to, kind }], con kind = 'fichero' | 'paquete' | 'fuera'. 'fuera' es una
   ruta relativa que no se pudo resolver a nada conocido: la decide quien cruza. */
export function imports(sources, { conocidos = [], webRoots = [], pyRoots = [] } = {}) {
  const todos = new Set([...Object.keys(sources), ...conocidos].map(limpia)), out = [];
  const relativo = (file, spec, raices = []) => {
    const candidatos = spec.startsWith('/') ? raices.map(r => join(r, spec)) : [join(dirname(file), spec)];
    for (const c of candidatos) { const hit = resuelve(c, todos); if (hit) return { from: file, to: hit, kind: 'fichero' }; }
    return { from: file, to: limpia(candidatos[0] ?? spec), kind: 'fuera' };
  };
  for (const [file, text] of Object.entries(sources)) {
    if (/\.py$/.test(file)) {
      for (const { modulo, nombres } of specsPy(text)) {
        const puntos = modulo.match(/^\.*/)[0].length, resto = modulo.slice(puntos).split('.').filter(Boolean).join('/');
        const bases = puntos ? [join(dirname(file), '../'.repeat(puntos - 1), resto)] : [dirname(file), ...pyRoots].map(r => join(r, resto));
        const candidatos = bases.flatMap(b => [b + '.py', join(b, '__init__.py'), ...nombres.map(n => join(b, n + '.py'))]).map(limpia);
        const hits = candidatos.filter(c => todos.has(c));
        for (const hit of new Set(hits)) if (hit !== file) out.push({ from: file, to: hit, kind: 'fichero' });
      }
      continue;
    }
    if (/\.css$/.test(file)) {
      // En CSS una ruta sin ./ es relativa; si no resuelve, es un paquete (así lo lee el empaquetador).
      for (const re of CSS) for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
        if (REMOTO.test(m[1])) continue;
        const r = relativo(file, m[1], webRoots);
        out.push(r.kind === 'fuera' && !/^[./]/.test(m[1]) ? { from: file, to: paquete(m[1]), kind: 'paquete' } : r);
      }
      continue;
    }
    if (/\.html$/.test(file)) {
      const { enlaces, modulos } = specsHtml(text);
      for (const spec of enlaces) if (!REMOTO.test(spec)) out.push(relativo(file, spec, webRoots));
      for (const spec of modulos) if (!REMOTO.test(spec)) out.push(spec.startsWith('.') || spec.startsWith('/') ? relativo(file, spec, webRoots) : { from: file, to: paquete(spec), kind: 'paquete' });
      continue;
    }
    for (const spec of specsJs(text)) {
      if (REMOTO.test(spec)) continue; // node:fs, cloudflare:workers, https://...
      out.push(spec.startsWith('.') || spec.startsWith('/') ? relativo(file, spec, webRoots) : { from: file, to: paquete(spec), kind: 'paquete' });
    }
  }
  return out;
}

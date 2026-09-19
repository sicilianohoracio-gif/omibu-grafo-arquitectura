import test from 'node:test';
import assert from 'node:assert/strict';
import { imports, cross, canonico, sabotajes } from '../src/index.mjs';

const sources = {
  'src/a.js': "import { b } from './b.js';\nimport React from 'react';\nimport '@omibu/runtime/motion';\n// import './fantasma.js'\nconst x = await import('./c');",
  'src/b.js': "const c = require('./c.js');\nexport * from './d.mjs';",
  'src/c.js': '/* import "./a.js" */ export const c = 1;',
  'src/d.mjs': 'export const d = 1;',
  'src/piel.css': "@import './base.css';\n@import '@omibu/runtime/theme.css';",
  'src/base.css': 'body{}',
  'web/index.html': '<link rel="stylesheet" href="/piel.css"><script src="/app.js?v=3"></script><script type="module">import { a } from "./a.js";</script><script src="https://cdn.x/y.js"></script>',
  'web/app.js': '', 'web/a.js': '',
  'srv/main.py': 'import os, json\nfrom util import limpia\nfrom .datos import cargar\nimport paquete.sub as s',
  'srv/util.py': '', 'srv/datos.py': '', 'srv/paquete/sub.py': '', 'srv/paquete/__init__.py': '',
};
const pares = (extra) => imports(sources, extra).map(i => `${i.from} -> ${i.to} [${i.kind}]`);

test('extrae import, export from, import(), require y descarta comentarios', () => {
  const p = pares();
  for (const e of ['src/a.js -> src/b.js [fichero]', 'src/a.js -> src/c.js [fichero]', 'src/a.js -> react [paquete]', 'src/a.js -> @omibu/runtime [paquete]', 'src/b.js -> src/c.js [fichero]', 'src/b.js -> src/d.mjs [fichero]']) assert.ok(p.includes(e), e);
  assert.ok(!p.some(e => e.includes('fantasma')) && !p.some(e => e.startsWith('src/c.js')));
});
test('css: relativo y paquete', () => { const p = pares(); assert.ok(p.includes('src/piel.css -> src/base.css [fichero]')); assert.ok(p.includes('src/piel.css -> @omibu/runtime [paquete]')); });
test('html: script src, hoja de estilo con raíz web, módulo en línea; lo remoto fuera', () => {
  const p = pares({ webRoots: ['web', 'src'] });
  for (const e of ['web/index.html -> web/app.js [fichero]', 'web/index.html -> src/piel.css [fichero]', 'web/index.html -> web/a.js [fichero]']) assert.ok(p.includes(e), e);
  assert.ok(!p.some(e => e.includes('cdn')));
});
test('python: absoluto junto al fichero, relativo, paquete con alias; la biblioteca estándar fuera', () => {
  const p = pares().filter(e => e.startsWith('srv/'));
  assert.deepEqual(p.sort(), ['srv/main.py -> srv/datos.py [fichero]', 'srv/main.py -> srv/paquete/sub.py [fichero]', 'srv/main.py -> srv/util.py [fichero]']);
});

const fuentes = { 'src/a.js': "import './b.js'; import 'pkg/x';", 'src/b.js': "import './c.js';", 'src/c.js': '', 'src/w.js': "import './c.js';" };
const grafo = () => ({
  nodes: [{ id: 'A', files: ['src/a.js'] }, { id: 'B', files: ['src/b.js'] }, { id: 'C', files: ['src/c.js'] }, { id: 'W1', files: ['src/w.js'] }, { id: 'W2', files: ['src/w.js'] }, { id: 'P', files: ['node_modules/pkg/package.json'] }, { id: 'DB', files: [] }],
  edges: [{ from: 'A', to: 'B', type: 'import', confidence: 'verificado' }, { from: 'B', to: 'C', type: 'import', confidence: 'verificado' }, { from: 'W2', to: 'C', type: 'import', confidence: 'verificado' },
    { from: 'W1', to: 'W2', type: 'import', confidence: 'verificado' }, { from: 'A', to: 'P', type: 'import', confidence: 'verificado' }, { from: 'C', to: 'DB', type: 'query', confidence: 'verificado' }, { from: 'C', to: 'A', type: 'import', confidence: 'inferido' }],
});
test('un grafo fiel pasa, con varios nodos por fichero, paquete y aristas que no son imports', () => {
  const r = cross(canonico(grafo()), fuentes);
  assert.deepEqual(r.errors, []); assert.equal(r.crossed, 4); assert.equal(r.skipped.length, 1);
});
test('arista inventada', () => { const g = grafo(); g.edges.push({ from: 'C', to: 'B', type: 'import', confidence: 'verificado' }); assert.match(cross(canonico(g), fuentes).errors.join('\n'), /arista C -> B marcada como verificada/); });
test('import sin arista', () => { const g = grafo(); g.edges.shift(); assert.match(cross(canonico(g), fuentes).errors.join('\n'), /import src\/a.js -> src\/b.js existe/); });
test('import del paquete sin arista', () => { const g = grafo(); g.edges = g.edges.filter(e => e.to !== 'P'); assert.match(cross(canonico(g), fuentes).errors.join('\n'), /import src\/a.js -> pkg existe/); });
test('módulo sin nodo y fichero nuevo', () => {
  const g = grafo(); g.nodes = g.nodes.filter(n => n.id !== 'C'); assert.match(cross(canonico(g), fuentes).errors.join('\n'), /src\/c.js no tiene nodo/);
  assert.match(cross(canonico(grafo()), { ...fuentes, 'src/nuevo.js': '' }).errors.join('\n'), /src\/nuevo.js no tiene nodo/);
});
test('import relativo que sale del alcance: error salvo excepción declarada', () => {
  const f = { ...fuentes, 'src/c.js': "import '../otro/x.js';" };
  assert.match(cross(canonico(grafo()), f).errors.join('\n'), /ni en el alcance ni en el grafo/);
  assert.match(cross(canonico(grafo()), { ...fuentes, 'src/c.js': "import '../lib/sin_extension';" }).errors.join('\n'), /ni en el alcance ni en el grafo/);
  assert.deepEqual(cross(canonico(grafo()), { ...fuentes, 'src/c.js': "import './foto.jpg';" }).errors, []);
  assert.deepEqual(cross(canonico(grafo()), f, { ignorar: [{ re: /otro\/x\.js$/, motivo: 'prueba' }] }).errors, []);
});
test('vocabulario de/a + estado, y status por fichero único', () => {
  const g = { nodes: [{ id: 'a', file: 'src/a.js' }, { id: 'b', file: 'src/b.js' }, { id: 'c', file: 'src/c.js' }, { id: 'w', file: 'src/w.js' }], edges: [{ de: 'a', a: 'b', tipo: 'usa', estado: 'verificado' }, { de: 'b', a: 'c', tipo: 'usa', estado: 'verificado' }, { de: 'w', a: 'c', tipo: 'usa', estado: 'verificado' }] };
  assert.deepEqual(cross(canonico(g, { importa: ['usa'] }), fuentes).errors, []);
});
test('los cuatro sabotajes muerden sobre un grafo fiel', () => { const s = sabotajes(canonico(grafo()), fuentes); assert.equal(s.length, 4); assert.deepEqual(s.filter(x => !x.mordio), []); });

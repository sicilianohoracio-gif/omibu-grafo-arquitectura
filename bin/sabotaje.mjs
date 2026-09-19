#!/usr/bin/env node
/* SABOTAJE REAL, EN DISCO. Los sabotajes en memoria prueban el cruce; este prueba que la
 * PUERTA de la app (su `npm test` o equivalente) se pone roja de verdad.
 *
 *   grafo-sabotaje [--grafo docs/arquitectura/architecture.json] -- <orden de prueba...>
 *
 * Se corre desde la raíz de la app. Hace dos cosas, de una en una, y restaura siempre:
 *   1. escribe una arista verificada falsa en architecture.json  -> la orden debe salir != 0
 *   2. añade un import nuevo a un módulo real del código          -> la orden debe salir != 0
 * Antes y después exige verde, y comprueba byte a byte que lo tocado volvió a su sitio.
 * Sale con 0 solo si verde -> rojo -> rojo -> verde.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { preparar } from '../src/verificar.mjs';
import { candidatos } from '../src/sabotajes.mjs';

const args = process.argv.slice(2), corte = args.indexOf('--');
if (corte < 0 || corte === args.length - 1) { console.error('uso: grafo-sabotaje [--grafo ruta] -- <orden de prueba>'); process.exit(2); }
const previos = args.slice(0, corte), orden = args.slice(corte + 1);
const rutaGrafo = resolve(previos[previos.indexOf('--grafo') + 1] && previos.includes('--grafo') ? previos[previos.indexOf('--grafo') + 1] : 'docs/arquitectura/architecture.json');
const root = process.cwd(), original = readFileSync(rutaGrafo, 'utf8'), graph = JSON.parse(original);
const { canon, sources, opts } = preparar(root, graph), c = candidatos(canon, sources, opts);
if (!c.inventada) { console.error('el grafo no da dos módulos sin import entre sí: no hay sabotaje posible.'); process.exit(2); }

const corre = () => { const r = spawnSync(orden[0], orden.slice(1), { cwd: root, encoding: 'utf8', shell: false }); return { code: r.status ?? 1, out: (r.stdout ?? '') + (r.stderr ?? '') }; };
const pista = (out, patron) => out.split('\n').find(l => patron.test(l))?.trim() ?? '(la salida no nombra la causa)';
let ok = true;
const paso = (nombre, esperado, r, patron) => {
  const bien = esperado === 'verde' ? r.code === 0 : r.code !== 0 && patron.test(r.out);
  ok &&= bien;
  console.log(`${bien ? 'BIEN' : 'MAL '} · ${nombre}: exit ${r.code}, se esperaba ${esperado}${esperado === 'rojo' ? ' · ' + pista(r.out, patron) : ''}`);
};

paso('estado de partida', 'verde', corre());

// 1. Arista falsa, escrita con el vocabulario de la propia app (se clona una arista suya).
const molde = graph.edges.find(e => (e.status ?? e.confidence ?? e.estado ?? e.state ?? 'verificado').startsWith('verificado') && canon.edges[graph.edges.indexOf(e)].importa) ?? graph.edges[0];
const falsa = { ...molde }; if ('de' in falsa) { falsa.de = c.inventada.from; falsa.a = c.inventada.to; } else { falsa.from = c.inventada.from; falsa.to = c.inventada.to; }
try { writeFileSync(rutaGrafo, JSON.stringify({ ...graph, edges: [...graph.edges, falsa] }, null, 2)); paso(`arista falsa ${c.inventada.from} -> ${c.inventada.to} en el json`, 'rojo', corre(), /marcada como verificada, pero ese import no existe/); }
finally { writeFileSync(rutaGrafo, original); }

// 2. Import nuevo en el código: el módulo de origen pasa a importar al de destino.
const victima = resolve(root, c.inventada.fileFrom), antes = readFileSync(victima, 'utf8');
let spec = relative(dirname(c.inventada.fileFrom), c.inventada.fileTo).split('\\').join('/'); if (!spec.startsWith('.')) spec = './' + spec;
const linea = c.inventada.fileFrom.endsWith('.py') ? `\nfrom ${'.'.repeat(1)}${spec.replace(/^\.\//, '').replace(/\.py$/, '').split('/').join('.')} import *  # sabotaje\n` : `\nimport '${spec}'; // sabotaje\n`;
try { writeFileSync(victima, antes + linea); paso(`import nuevo ${c.inventada.fileFrom} -> ${c.inventada.fileTo} en el código`, 'rojo', corre(), /existe en el código y ninguna arista verificada lo cubre/); }
finally { writeFileSync(victima, antes); }

const intacto = readFileSync(rutaGrafo, 'utf8') === original && readFileSync(victima, 'utf8') === antes;
console.log(`${intacto ? 'BIEN' : 'MAL '} · restaurado byte a byte: ${relative(root, rutaGrafo)} y ${c.inventada.fileFrom}`); ok &&= intacto;
paso('estado final', 'verde', corre());
process.exit(ok ? 0 : 1);

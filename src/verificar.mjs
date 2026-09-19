/* LA PUERTA DE ENTRADA DE UNA APP. Lee la sección `cruce` del propio architecture.json
 * (el grafo declara su alcance y lo que deja fuera, con el motivo escrito), cruza y sabotea.
 *
 *   "cruce": {
 *     "dirs":     ["app/src"],                       carpetas o ficheros de código, relativos a la raíz de la app
 *     "skip":     [{ "re": "^app/public/vendor/", "motivo": "librerías de terceros minificadas" }],
 *     "webRoots": ["app/public"],                    lo que el navegador ve como «/»
 *     "pyRoots":  ["."],                             desde dónde resuelve Python un import absoluto
 *     "importa":  ["import", "call"],                tipos de arista que afirman un import
 *     "sinTipo":  true,                              una arista sin tipo afirma un import
 *     "ignorar":  [{ "re": "...", "motivo": "..." }] imports relativos que salen del alcance a propósito
 *     "noCruzable": "texto libre: qué aristas quedan fuera del cruce y por qué"
 *   }
 *
 * Todo `skip` e `ignorar` lleva motivo: la excepción se declara, la regla no se afloja.
 */
import { leer } from './extraer.mjs';
import { canonico } from './canon.mjs';
import { cross } from './cruzar.mjs';
import { sabotajes } from './sabotajes.mjs';

export function preparar(root, graph) {
  const cfg = graph.cruce;
  if (!cfg || !Array.isArray(cfg.dirs) || !cfg.dirs.length) throw new Error('architecture.json no declara `cruce.dirs`: sin alcance no hay cruce.');
  for (const regla of [...(cfg.skip ?? []), ...(cfg.ignorar ?? [])]) if (!regla.re || !regla.motivo) throw new Error(`excepción del cruce sin motivo escrito: ${JSON.stringify(regla)}`);
  const opts = { webRoots: cfg.webRoots ?? [], pyRoots: cfg.pyRoots ?? [], ignorar: (cfg.ignorar ?? []).map(r => ({ re: new RegExp(r.re), motivo: r.motivo })) };
  const sources = leer(root, { dirs: cfg.dirs, skip: (cfg.skip ?? []).map(r => new RegExp(r.re)) });
  return { canon: canonico(graph, cfg), sources, opts };
}

export function verificar(root, graph) {
  const { canon, sources, opts } = preparar(root, graph);
  const r = cross(canon, sources, opts), s = sabotajes(canon, sources, opts);
  const errors = [...r.errors];
  if (!Object.keys(sources).length) errors.push('el alcance declarado en `cruce.dirs` no contiene ni un fichero de código.');
  if (!r.crossed) errors.push('ninguna arista del grafo se pudo cruzar con un import: el cruce no está comprobando nada.');
  for (const x of s) if (!x.mordio) errors.push(`sabotaje «${x.nombre}» no detectado${x.candidato ? '' : ' (el grafo no da candidato)'}.`);
  const resumen = `Cruce con el código: ${Object.keys(sources).length} ficheros, ${r.imports} imports, ${r.crossed} aristas cruzadas, ${r.skipped.length} fuera del cruce; sabotajes detectados: ${s.filter(x => x.mordio).length}/${s.length}.`;
  return { errors, resumen, ...r, sabotajes: s };
}

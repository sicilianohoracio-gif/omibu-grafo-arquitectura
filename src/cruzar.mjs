/* CRUCE DEL GRAFO CON EL CÓDIGO, en los dos sentidos.
 *
 * Cada app guarda su `architecture.json` con su propio vocabulario (file o files[],
 * status o confidence o estado, from/to o de/a). Aquí no se adivina ninguno: la app
 * traduce su grafo a la forma canónica y este módulo solo cruza.
 *
 *   canon = {
 *     nodes:    [{ id, files: ['app/src/x.js', ...] }],
 *     edges:    [{ from, to, verified: true|false, importa: true|false }],
 *     packages: { '@omibu/experience-runtime': 'id-del-nodo' }   // opcional
 *   }
 *
 * `importa` lo decide la app: true si esa arista AFIRMA que un módulo importa a otro
 * (tipo import, call, usa...). Una arista http, sql, binding o evento lleva false y
 * queda fuera del cruce: no es un import y no se finge que lo sea.
 *
 * Reglas:
 *   1. Todo fichero de código del alcance pertenece a algún nodo.
 *   2. Toda arista verificada que afirma un import tiene detrás un import real de algún
 *      fichero del origen a algún fichero (o al paquete) del destino.
 *   3. Todo import real entre ficheros de nodos distintos tiene una arista verificada
 *      origen -> destino, del tipo que sea.
 *   4. Un import relativo que apunta a código que no está ni en el alcance ni en el
 *      grafo es un error: o entra en el grafo o se declara fuera con su motivo.
 *
 * Un fichero puede vivir en varios nodos (un worker.js con router, sesión y cron). El
 * import se da por dibujado si CUALQUIER pareja de nodos lo cubre, y una arista entre
 * dos nodos que comparten fichero no se cruza: es una llamada dentro del mismo fichero.
 */
import { imports } from './extraer.mjs';

const CODIGO = /\.(?:js|jsx|mjs|cjs|ts|tsx|css|html|py)$/;

export function cross(canon, sources, opts = {}) {
  const errors = [], skipped = [];
  const ignorar = opts.ignorar ?? []; // [{ re, motivo }] sobre «origen -> destino» de un import sin resolver
  const nodesOf = new Map(), filesOf = new Map(canon.nodes.map(node => [node.id, new Set(node.files)]));
  for (const node of canon.nodes) for (const file of node.files) (nodesOf.get(file) ?? nodesOf.set(file, new Set()).get(file)).add(node.id);
  const packages = new Map(Object.entries(canon.packages ?? {}));
  const enAlcance = id => [...(filesOf.get(id) ?? [])].some(file => file in sources);

  for (const file of Object.keys(sources)) if (!nodesOf.has(file)) errors.push(`${file} no tiene nodo en el grafo.`);

  const real = new Map(); // «a -> b» => evidencia
  const found = imports(sources, { ...opts, conocidos: [...nodesOf.keys()] });
  for (const { from, to, kind } of found) {
    if (kind === 'fuera') {
      // Sin extensión también es código (import '../lib/x'): solo se perdona lo que lleva extensión de recurso (imagen, audio, json).
      if ((CODIGO.test(to) || !/\.[a-z0-9]+$/i.test(to)) && !ignorar.some(({ re }) => re.test(`${from} -> ${to}`))) errors.push(`${from} importa ${to}, que no está ni en el alcance ni en el grafo.`);
      continue;
    }
    const origen = nodesOf.get(from), destino = kind === 'paquete' ? (packages.has(to) ? new Set([packages.get(to)]) : null) : nodesOf.get(to);
    if (!origen || !destino) continue; // origen sin nodo ya es error de la regla 1; destino sin nodo: paquete de terceros o fichero ya denunciado
    for (const a of origen) for (const b of destino) if (a !== b) real.set(`${a} -> ${b}`, `${from} importa ${to}`);
  }

  const verificadas = new Set(canon.edges.filter(edge => edge.verified).map(edge => `${edge.from} -> ${edge.to}`));
  let crossed = 0;
  for (const edge of canon.edges) {
    if (!edge.verified || !edge.importa) continue;
    const key = `${edge.from} -> ${edge.to}`, esPaquete = [...packages.values()].includes(edge.to);
    const comparten = [...(filesOf.get(edge.from) ?? [])].some(file => filesOf.get(edge.to)?.has(file));
    if (comparten) { skipped.push(`${key}: los dos nodos comparten fichero, es una llamada interna`); continue; }
    if (!enAlcance(edge.from) || !(esPaquete || enAlcance(edge.to))) { skipped.push(`${key}: alguno de los dos extremos no tiene código dentro del alcance leído`); continue; }
    crossed++;
    if (!real.has(key)) errors.push(`arista ${key} marcada como verificada, pero ese import no existe en el código.`);
  }

  // Sentido inverso. Un import lo cubre una arista directa, o que origen y destino compartan nodo.
  const porImport = new Map();
  for (const { from, to, kind } of found) {
    if (kind === 'fuera') continue;
    const origen = nodesOf.get(from), destino = kind === 'paquete' ? (packages.has(to) ? new Set([packages.get(to)]) : null) : nodesOf.get(to);
    if (!origen || !destino || from === to) continue;
    const cubierto = [...origen].some(a => destino.has(a) || [...destino].some(b => verificadas.has(`${a} -> ${b}`)));
    if (!cubierto) porImport.set(`${from} -> ${to}`, `import ${from} -> ${to} existe en el código y ninguna arista verificada lo cubre (${[...origen].join('|')} -> ${[...destino].join('|')}).`);
  }
  errors.push(...porImport.values());
  return { errors, crossed, skipped, imports: found.length };
}

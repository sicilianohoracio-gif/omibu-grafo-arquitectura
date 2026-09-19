/* LOS SABOTAJES EN MEMORIA. Un cruce que nunca se ha visto en rojo no prueba nada, así que
 * en cada pasada se le rompe el grafo de cuatro maneras y se exige que muerda las cuatro:
 *
 *   1. una arista verificada inventada entre dos módulos que no se importan
 *   2. una arista verificada real, borrada (queda un import sin arista)
 *   3. un nodo borrado (queda un módulo sin nodo)
 *   4. un fichero nuevo en el alcance que importa un módulo que ya existe
 *
 * Si un grafo no da candidato para un sabotaje (no hay dos módulos sin import entre sí, o
 * ninguna arista cruzable), se dice: `sin candidato` cuenta como no mordido.
 */
import { cross } from './cruzar.mjs';
import { imports } from './extraer.mjs';
import { dirname, join } from 'node:path';

export function candidatos(canon, sources, opts = {}) {
  const dueños = new Map();
  for (const node of canon.nodes) for (const file of node.files) (dueños.get(file) ?? dueños.set(file, []).get(file)).push(node.id);
  // Módulos «limpios»: nodos con algún fichero de código en el alcance que no comparten con nadie.
  const propio = node => node.files.find(file => file in sources && dueños.get(file).length === 1 && /\.(?:js|jsx|mjs|cjs|ts|tsx|py)$/.test(file));
  const limpios = canon.nodes.filter(propio);
  const reales = new Set(imports(sources, { ...opts, conocidos: [...dueños.keys()] }).filter(i => i.kind === 'fichero').map(i => `${i.from} -> ${i.to}`));
  const seImportan = (a, b) => a.files.some(fa => b.files.some(fb => reales.has(`${fa} -> ${fb}`)));
  const dibujada = (a, b) => canon.edges.some(edge => edge.from === a.id && edge.to === b.id);
  let inventada = null;
  for (const a of limpios) { const b = limpios.find(b => b !== a && !seImportan(a, b) && !dibujada(a, b) && propio(a).split('.').pop() === propio(b).split('.').pop()); if (b) { inventada = { from: a.id, to: b.id, fileFrom: propio(a), fileTo: propio(b) }; break; } }
  const borrable = canon.edges.find(edge => edge.verified && edge.importa && limpios.some(n => n.id === edge.from) && limpios.some(n => n.id === edge.to)
    && canon.nodes.find(n => n.id === edge.from).files.every(f => (dueños.get(f) ?? []).length === 1) && canon.nodes.find(n => n.id === edge.to).files.every(f => (dueños.get(f) ?? []).length === 1)
    && seImportan(canon.nodes.find(n => n.id === edge.from), canon.nodes.find(n => n.id === edge.to))) ?? null;
  return { inventada, borrable, nodo: limpios[0] ?? null, fichero: limpios[0] ? propio(limpios[0]) : null };
}

export function sabotajes(canon, sources, opts = {}) {
  const c = candidatos(canon, sources, opts), out = [];
  const prueba = (nombre, hay, mutado, fuentes, patron) => out.push({ nombre, mordio: Boolean(hay) && cross(mutado(), fuentes(), opts).errors.some(e => patron.test(e)), candidato: Boolean(hay) });
  prueba('arista inventada', c.inventada, () => ({ ...canon, edges: [...canon.edges, { from: c.inventada.from, to: c.inventada.to, verified: true, importa: true }] }), () => sources, /^arista /);
  prueba('import sin arista', c.borrable, () => ({ ...canon, edges: canon.edges.filter(e => !(e.from === c.borrable.from && e.to === c.borrable.to)) }), () => sources, /^import /);
  prueba('módulo sin nodo', c.nodo, () => ({ ...canon, nodes: canon.nodes.filter(n => n !== c.nodo) }), () => sources, /no tiene nodo/);
  prueba('fichero nuevo sin nodo', c.fichero, () => canon, () => ({ ...sources, [join(dirname(c.fichero), '__sabotaje_grafo__.' + c.fichero.split('.').pop())]: '' }), /no tiene nodo/);
  return out;
}

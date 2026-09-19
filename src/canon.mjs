/* TRADUCTOR. Cada app escribió su `architecture.json` con su vocabulario; aquí se lleva a
 * la forma que cruza `cross`, sin tocar el fichero de la app.
 *
 *   ficheros del nodo   files[] o file            (un «ruta:línea» pierde la línea)
 *   extremos            from/to o de/a
 *   estado              status, confidence, estado o state; vale lo que empiece por «verificado».
 *                       Una arista sin estado afirma lo mismo que una verificada.
 *   tipo                type o tipo. `importa` lista los tipos que AFIRMAN un import entre
 *                       módulos; una arista sin tipo lo afirma salvo que `sinTipo` sea false.
 *   paquetes            un nodo cuyo fichero vive en node_modules/<paquete>/ es ese paquete.
 */
export function canonico(graph, { importa = ['import'], sinTipo = true, packages = {} } = {}) {
  const nodes = graph.nodes.map(node => ({ id: node.id, files: (node.files ?? (node.file ? [node.file] : [])).map(file => String(file).replace(/:\d+$/, '')) }));
  const paquetes = { ...packages };
  for (const node of nodes) for (const file of node.files) { const m = file.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/); if (m) paquetes[m[1]] = node.id; }
  const edges = graph.edges.map(edge => {
    const estado = edge.status ?? edge.confidence ?? edge.estado ?? edge.state, tipo = edge.type ?? edge.tipo;
    return { from: edge.from ?? edge.de, to: edge.to ?? edge.a, verified: estado === undefined || String(estado).startsWith('verificado'), importa: tipo === undefined ? sinTipo : importa.includes(tipo) };
  });
  return { nodes, edges, packages: paquetes };
}

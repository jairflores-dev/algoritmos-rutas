import { MinHeap } from './minHeap.js';
import { haversineDistance } from './haversine.js';

/**
 * Motor principal de ruteo
 * @param {Object} graph - { nodes, edges }
 * @param {string} startId - ID nodo origen
 * @param {string} targetId - ID nodo destino
 * @param {string} algorithm - 'ASTAR' | 'GREEDY' | 'DIJKSTRA'
 * @param {string} mode - 'car' | 'pedestrian'
 */
export function solvePath(graph, startId, targetId, algorithm = 'ASTAR', mode = 'car') {
  const startTime = performance.now();

  const startNode = graph.nodes[startId];
  const targetNode = graph.nodes[targetId];

  if (!startNode || !targetNode) {
    return { success: false, error: 'Nodos de origen o destino no válidos' };
  }

  const openSet = new MinHeap();
  const cameFrom = {};

  const gScore = {}; // Costo acumulado real
  const fScore = {}; // Costo estimado de evaluación

  for (const nodeId in graph.nodes) {
    gScore[nodeId] = Infinity;
    fScore[nodeId] = Infinity;
  }

  gScore[startId] = 0;
  const hStart = haversineDistance(
    startNode.lat, startNode.lng,
    targetNode.lat, targetNode.lng
  );

  fScore[startId] = algorithm === 'DIJKSTRA' ? 0 : hStart;
  openSet.push(startId, fScore[startId]);

  let visitedNodesCount = 0;
  const visitedOrderCoords = [];

  while (!openSet.isEmpty()) {
    const current = openSet.pop();
    const currentId = current.nodeId;
    visitedNodesCount++;

    const currNode = graph.nodes[currentId];
    visitedOrderCoords.push([currNode.lat, currNode.lng]);

    // ¿Destino alcanzado? Reconstruir ruta
    if (currentId === targetId) {
      const endTime = performance.now();
      const path = reconstructPath(cameFrom, currentId, graph.nodes);

      return {
        success: true,
        algorithmUsed: algorithm,
        pathCoords: path.coords,
        pathNodeIds: path.nodeIds,
        totalDistanceKm: path.distanceKm,
        executionTimeMs: (endTime - startTime).toFixed(3),
        visitedNodesCount,
        visitedOrderCoords
      };
    }

    const neighbors = getNeighbors(graph, currentId, mode);

    for (const neighbor of neighbors) {
      const { neighborId, distanceKm } = neighbor;
      const neighborNode = graph.nodes[neighborId];

      const tentativeGScore = gScore[currentId] + distanceKm;

      if (tentativeGScore < gScore[neighborId]) {
        cameFrom[neighborId] = currentId;
        gScore[neighborId] = tentativeGScore;

        const hScore = haversineDistance(
          neighborNode.lat, neighborNode.lng,
          targetNode.lat, targetNode.lng
        );

        // Selección de función de costo según el algoritmo
        if (algorithm === 'ASTAR') {
          fScore[neighborId] = gScore[neighborId] + hScore; // A*
        } else if (algorithm === 'GREEDY') {
          fScore[neighborId] = hScore; // Voraz puro
        } else if (algorithm === 'DIJKSTRA') {
          fScore[neighborId] = gScore[neighborId]; // Dijkstra
        }

        openSet.push(neighborId, fScore[neighborId]);
      }
    }
  }

  return { success: false, error: 'No se encontró una ruta disponible entre los nodos' };
}

function reconstructPath(cameFrom, currentId, nodes) {
  const totalPath = [currentId];
  while (currentId in cameFrom) {
    currentId = cameFrom[currentId];
    totalPath.unshift(currentId);
  }

  let distanceKm = 0;
  const coords = totalPath.map((id, index) => {
    if (index > 0) {
      const prev = nodes[totalPath[index - 1]];
      const curr = nodes[id];
      distanceKm += haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
    }
    return [nodes[id].lat, nodes[id].lng];
  });

  return { nodeIds: totalPath, coords, distanceKm: distanceKm.toFixed(3) };
}

function getNeighbors(graph, nodeId, mode) {
  const neighbors = [];
  const edges = graph.edges[nodeId] || [];

  for (const edge of edges) {
    if (mode === 'car' && edge.oneWay && edge.direction === 'reverse') {
      continue;
    }
    neighbors.push({
      neighborId: edge.target,
      distanceKm: edge.weight
    });
  }

  return neighbors;
}
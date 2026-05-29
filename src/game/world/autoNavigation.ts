import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import type { AutoNavigationState } from '../../state/state';
import type { Direction, Position } from '../../types';
import {
  getFromToAccountingForWrapAround,
  getXWrapAround,
} from './sharedUtils';

const WORLD_MAP_ROWS = 1080;
const DEFAULT_GRID_SIZE = 8;
const FINE_GRID_SIZE = 4;
const COARSE_GRID_SIZE = 12;
const REACHED_WAYPOINT_DISTANCE = DEFAULT_GRID_SIZE * 4;
const REACHED_TARGET_DISTANCE = 8;
const DIRECTION_DEAD_ZONE = 1;
const COAST_PENALTY_RADIUS = 16;
const DIAGONAL_OPEN_SEA_RADIUS = 6;
const STAGNANT_MOVE_DISTANCE = 0.001;
const STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS = 12;
const PREVIEW_SEARCHED_GRID_NODES = 400;

interface GridPosition {
  x: number;
  y: number;
}

interface PathOptions {
  start: Position;
  target: Position;
  isSea: (position: Position) => boolean;
  columns?: number;
  rows?: number;
  gridSize?: number;
  maxSearchedNodes?: number;
  useCoastPenalty?: boolean;
}

export type AutoNavigationStrategyId = 'balanced' | 'detailed' | 'offshore' | 'deep';

interface AutoNavigationStrategy {
  id: AutoNavigationStrategyId;
  name: string;
  description: string;
  gridSizes: number[];
}

export const DEFAULT_AUTO_NAVIGATION_STRATEGY_ID: AutoNavigationStrategyId =
  'balanced';

export const AUTO_NAVIGATION_STRATEGIES: AutoNavigationStrategy[] = [
  {
    id: 'balanced',
    name: '稳健航线',
    description: '先用 8 x 8 规划全程，失败后用 4 x 4 重试。',
    gridSizes: [DEFAULT_GRID_SIZE, FINE_GRID_SIZE],
  },
  {
    id: 'detailed',
    name: '细致航线',
    description: '直接用 4 x 4 规划全程，更容易通过近岸和海峡。',
    gridSizes: [FINE_GRID_SIZE],
  },
  {
    id: 'offshore',
    name: '远海航线',
    description: '先用 12 x 12 规划全程，失败后退回 8 x 8 和 4 x 4。',
    gridSizes: [COARSE_GRID_SIZE, DEFAULT_GRID_SIZE, FINE_GRID_SIZE],
  },
  {
    id: 'deep',
    name: '超远航线',
    description: '分块深度搜索，支持横跨全球的超远距离航线，计算时间较长。',
    gridSizes: [],
  },
];

const getAutoNavigationStrategy = (strategyId: AutoNavigationStrategyId) =>
  AUTO_NAVIGATION_STRATEGIES.find(({ id }) => id === strategyId) ||
  AUTO_NAVIGATION_STRATEGIES[0];

const gridKey = ({ x, y }: GridPosition) => `${x},${y}`;

const getGridColumns = (columns: number, gridSize: number) =>
  Math.ceil(columns / gridSize);

const getGridRows = (rows: number, gridSize: number) =>
  Math.ceil(rows / gridSize);

const positionToGrid = (
  { x, y }: Position,
  columns: number,
  rows: number,
  gridSize: number,
) => ({
  x: Math.floor(getXWrapAround(x) / gridSize),
  y: Math.max(
    0,
    Math.min(getGridRows(rows, gridSize) - 1, Math.floor(y / gridSize)),
  ),
});

const gridToPosition = (
  { x, y }: GridPosition,
  columns: number,
  rows: number,
  gridSize: number,
) => ({
  x: getXWrapAround(x * gridSize + Math.floor(gridSize / 2)),
  y: Math.min(rows - 1, y * gridSize + Math.floor(gridSize / 2)),
});

const getWrappedGridDelta = (
  fromX: number,
  toX: number,
  gridColumns: number,
) => {
  let delta = toX - fromX;

  if (delta > gridColumns / 2) {
    delta -= gridColumns;
  }

  if (-delta > gridColumns / 2) {
    delta += gridColumns;
  }

  return delta;
};

const getHeuristic = (
  from: GridPosition,
  to: GridPosition,
  gridColumns: number,
) => {
  const dx = Math.abs(getWrappedGridDelta(from.x, to.x, gridColumns));
  const dy = Math.abs(to.y - from.y);
  const diagonal = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diagonal;

  return diagonal * Math.SQRT2 + straight;
};

interface HeapEntry {
  position: GridPosition;
  key: string;
  fScore: number;
  sequence: number;
}

const heapEntryLessThan = (a: HeapEntry, b: HeapEntry) =>
  a.fScore - b.fScore || a.sequence - b.sequence;

const createOpenHeap = () => {
  const heap: HeapEntry[] = [];

  const swap = (a: number, b: number) => {
    const tmp = heap[a];

    heap[a] = heap[b];
    heap[b] = tmp;
  };

  return {
    get size() {
      return heap.length;
    },

    push(entry: HeapEntry) {
      heap.push(entry);

      let index = heap.length - 1;

      while (index > 0) {
        const parent = Math.floor((index - 1) / 2);

        if (heapEntryLessThan(heap[index], heap[parent]) >= 0) {
          return;
        }

        swap(index, parent);
        index = parent;
      }
    },

    pop() {
      const top = heap[0];
      const last = heap.pop()!;

      if (heap.length) {
        heap[0] = last;

        const size = heap.length;
        let index = 0;
        let done = false;

        while (!done) {
          const left = index * 2 + 1;
          const right = index * 2 + 2;
          let smallest = index;

          if (
            left < size &&
            heapEntryLessThan(heap[left], heap[smallest]) < 0
          ) {
            smallest = left;
          }

          if (
            right < size &&
            heapEntryLessThan(heap[right], heap[smallest]) < 0
          ) {
            smallest = right;
          }

          if (smallest === index) {
            done = true;
          } else {
            swap(index, smallest);
            index = smallest;
          }
        }
      }

      return top;
    },
  };
};

const reconstructPath = (
  cameFrom: Map<string, string>,
  currentKey: string,
  positions: Map<string, GridPosition>,
) => {
  const path = [positions.get(currentKey)!];
  let key = currentKey;
  const visited = new Set<string>([currentKey]);

  while (cameFrom.has(key)) {
    key = cameFrom.get(key)!;

    if (visited.has(key)) {
      return [];
    }

    visited.add(key);
    path.unshift(positions.get(key)!);
  }

  return path;
};

const getCoastPenalty = (
  { x, y }: Position,
  isSea: (position: Position) => boolean,
) => {
  for (let radius = 1; radius <= COAST_PENALTY_RADIUS; radius += 1) {
    for (let yOffset = -radius; yOffset <= radius; yOffset += 1) {
      for (let xOffset = -radius; xOffset <= radius; xOffset += 1) {
        const isPerimeter =
          Math.abs(xOffset) === radius || Math.abs(yOffset) === radius;

        if (isPerimeter && !isSea({ x: x + xOffset, y: y + yOffset })) {
          if (radius <= 3) {
            return 20;
          }

          if (radius <= 6) {
            return 8;
          }

          if (radius <= 10) {
            return 3;
          }

          return 1;
        }
      }
    }
  }

  return 0;
};

export const isWorldSea = ({ x, y }: Position) => {
  if (y < 0 || y + 1 >= WORLD_MAP_ROWS) {
    return false;
  }

  const worldTilemap = Assets.data('worldTilemap');

  if (!worldTilemap) {
    return false;
  }

  const offsets = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];

  return offsets.every((offset) => {
    const tileX = getXWrapAround(Math.floor(x) + offset.x);
    const tileY = Math.floor(y) + offset.y;
    const tile = worldTilemap[tileY * WORLD_MAP_COLUMNS + tileX] || 0;

    return tile < 50;
  });
};

export const findSeaPath = ({
  start,
  target,
  isSea,
  columns = WORLD_MAP_COLUMNS,
  rows = WORLD_MAP_ROWS,
  gridSize = DEFAULT_GRID_SIZE,
  maxSearchedNodes = Number.POSITIVE_INFINITY,
  useCoastPenalty = true,
}: PathOptions) => {
  const gridColumns = getGridColumns(columns, gridSize);
  const gridRows = getGridRows(rows, gridSize);
  const startGrid = positionToGrid(start, columns, rows, gridSize);
  const targetGrid = positionToGrid(target, columns, rows, gridSize);
  const startKey = gridKey(startGrid);
  const targetKey = gridKey(targetGrid);

  const openHeap = createOpenHeap();
  let heapSequence = 0;

  openHeap.push({
    position: startGrid,
    key: startKey,
    fScore: getHeuristic(startGrid, targetGrid, gridColumns),
    sequence: heapSequence,
  });
  heapSequence += 1;

  const cameFrom = new Map<string, string>();
  const positions = new Map<string, GridPosition>([
    [startKey, startGrid],
    [targetKey, targetGrid],
  ]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closedSet = new Set<string>();
  const seaCache = new Map<string, boolean>();
  const coastPenaltyCache = new Map<string, number>();
  let searchedNodes = 0;

  const isGridSea = (gridPosition: GridPosition) => {
    const key = gridKey(gridPosition);
    const cached = seaCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const sea = isSea(gridToPosition(gridPosition, columns, rows, gridSize));
    seaCache.set(key, sea);

    return sea;
  };

  const getGridCoastPenalty = (gridPosition: GridPosition) => {
    const key = gridKey(gridPosition);
    const cached = coastPenaltyCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const penalty = getCoastPenalty(
      gridToPosition(gridPosition, columns, rows, gridSize),
      isSea,
    );
    coastPenaltyCache.set(key, penalty);

    return penalty;
  };

  while (openHeap.size && searchedNodes < maxSearchedNodes) {
    const { position: current, key: currentKey } = openHeap.pop();

    if (!closedSet.has(currentKey)) {
      searchedNodes += 1;
      closedSet.add(currentKey);

      if (currentKey === targetKey) {
        const gridPath = reconstructPath(cameFrom, currentKey, positions);

        if (!gridPath.length) {
          return [];
        }

        return gridPath
          .slice(1)
          .map((gridPosition) =>
            gridToPosition(gridPosition, columns, rows, gridSize),
          )
          .concat(target);
      }

      for (let yDelta = -1; yDelta <= 1; yDelta += 1) {
        for (let xDelta = -1; xDelta <= 1; xDelta += 1) {
          const shouldCheckNeighbor = xDelta !== 0 || yDelta !== 0;

          const neighbor = {
            x: (current.x + xDelta + gridColumns) % gridColumns,
            y: current.y + yDelta,
          };
          const neighborKey = gridKey(neighbor);
          const isAllowedSeaNode =
            neighborKey === targetKey ||
            neighborKey === startKey ||
            isGridSea(neighbor);
          const isInBounds = neighbor.y >= 0 && neighbor.y < gridRows;

          if (
            shouldCheckNeighbor &&
            !closedSet.has(neighborKey) &&
            isInBounds &&
            isAllowedSeaNode
          ) {
            const tentativeGScore =
              (gScore.get(currentKey) ?? Infinity) +
              (xDelta !== 0 && yDelta !== 0 ? Math.SQRT2 : 1) +
              (useCoastPenalty ? getGridCoastPenalty(neighbor) : 0);

            if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
              cameFrom.set(neighborKey, currentKey);
              positions.set(neighborKey, neighbor);
              gScore.set(neighborKey, tentativeGScore);
              openHeap.push({
                position: neighbor,
                key: neighborKey,
                fScore:
                  tentativeGScore +
                  getHeuristic(neighbor, targetGrid, gridColumns),
                sequence: heapSequence,
              });
              heapSequence += 1;
            }
          }
        }
      }
    }
  }

  return [];
};

const getDistance = (from: Position, to: Position) => {
  const dx = getFromToAccountingForWrapAround(from.x, to.x);
  const dy = to.y - from.y;

  return Math.sqrt(dx * dx + dy * dy);
};

const getReachedDistance = (
  waypointIndex: number,
  autoNavigation: AutoNavigationState,
) =>
  waypointIndex === autoNavigation.path.length - 1
    ? REACHED_TARGET_DISTANCE
    : REACHED_WAYPOINT_DISTANCE;

export const getDirectionToPosition = (
  from: Position,
  to: Position,
  useAlternateAxis = false,
  allowDiagonal = true,
): Direction | '' => {
  const xDelta = getFromToAccountingForWrapAround(from.x, to.x);
  const yDelta = to.y - from.y;
  const xDirection = xDelta > 0 ? 'e' : 'w';
  const yDirection = yDelta > 0 ? 's' : 'n';

  if (Math.abs(xDelta) <= DIRECTION_DEAD_ZONE) {
    return Math.abs(yDelta) <= DIRECTION_DEAD_ZONE ? '' : yDirection;
  }

  if (Math.abs(yDelta) <= DIRECTION_DEAD_ZONE) {
    return xDirection;
  }

  const primaryDirection =
    Math.abs(xDelta) >= Math.abs(yDelta) ? xDirection : yDirection;
  const alternateDirection =
    primaryDirection === xDirection ? yDirection : xDirection;

  if (useAlternateAxis) {
    return alternateDirection;
  }

  return allowDiagonal
    ? (`${yDirection}${xDirection}` as Direction)
    : primaryDirection;
};

const isOpenSeaForDiagonalHeading = (position: Position) => {
  for (
    let yOffset = -DIAGONAL_OPEN_SEA_RADIUS;
    yOffset <= DIAGONAL_OPEN_SEA_RADIUS;
    yOffset += 1
  ) {
    for (
      let xOffset = -DIAGONAL_OPEN_SEA_RADIUS;
      xOffset <= DIAGONAL_OPEN_SEA_RADIUS;
      xOffset += 1
    ) {
      if (!isWorldSea({ x: position.x + xOffset, y: position.y + yOffset })) {
        return false;
      }
    }
  }

  return true;
};

export const getAutoNavigationHeading = (
  position: Position,
  autoNavigation: AutoNavigationState,
) => {
  let { waypointIndex } = autoNavigation;
  let stagnantMoves = autoNavigation.stagnantMoves || 0;
  let useAlternateAxis = autoNavigation.useAlternateAxis || false;

  if (
    autoNavigation.lastPosition &&
    getDistance(position, autoNavigation.lastPosition) < STAGNANT_MOVE_DISTANCE
  ) {
    stagnantMoves += 1;
  } else {
    stagnantMoves = 0;
    useAlternateAxis = false;
  }

  if (stagnantMoves >= STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS) {
    useAlternateAxis = true;
  }

  while (
    waypointIndex < autoNavigation.path.length &&
    getDistance(position, autoNavigation.path[waypointIndex]) <=
      getReachedDistance(waypointIndex, autoNavigation)
  ) {
    waypointIndex += 1;
    stagnantMoves = 0;
    useAlternateAxis = false;
  }

  if (waypointIndex >= autoNavigation.path.length) {
    return {
      heading: '' as Direction | '',
      waypointIndex,
      arrived: true,
      lastPosition: position,
      stagnantMoves,
      useAlternateAxis,
    };
  }

  return {
    heading: getDirectionToPosition(
      position,
      autoNavigation.path[waypointIndex],
      useAlternateAxis,
      !useAlternateAxis && isOpenSeaForDiagonalHeading(position),
    ),
    waypointIndex,
    arrived: false,
    lastPosition: position,
    stagnantMoves,
    useAlternateAxis,
  };
};

export const createAutoNavigationPath = (
  start: Position,
  target: Position,
  strategyId: AutoNavigationStrategyId = DEFAULT_AUTO_NAVIGATION_STRATEGY_ID,
  maxSearchedNodes = Number.POSITIVE_INFINITY,
  useCoastPenalty = true,
) => {
  const strategy = getAutoNavigationStrategy(strategyId);

  return strategy.gridSizes.reduce<Position[]>(
    (path, gridSize) =>
      path.length
        ? path
        : findSeaPath({
            start,
            target,
            isSea: isWorldSea,
            gridSize,
            maxSearchedNodes,
            useCoastPenalty,
          }),
    [],
  );
};

const getPreviewGridBudgetMultiplier = (gridSize: number) => {
  if (gridSize >= COARSE_GRID_SIZE) {
    return 5;
  }

  if (gridSize >= DEFAULT_GRID_SIZE) {
    return 8;
  }

  return 2;
};

const DEEP_ROUTE_CHUNK_NODES = 3000;
const DEEP_ROUTE_COAST_RADIUS = 2; // check 2 grid-cells out: adjacent=penalty 2, one-step-out=penalty 1

export interface DeepRouteHandle {
  promise: Promise<Position[]>;
  abort: () => void;
}

export const findDeepRoutePath = (
  start: Position,
  target: Position,
  onProgress: (nodesSearched: number) => void,
): DeepRouteHandle => {
  let aborted = false;
  const gridSize = FINE_GRID_SIZE;
  const columns = WORLD_MAP_COLUMNS;
  const rows = WORLD_MAP_ROWS;
  const gridColumns = getGridColumns(columns, gridSize);
  const gridRows = getGridRows(rows, gridSize);
  const startGrid = positionToGrid(start, columns, rows, gridSize);
  const targetGrid = positionToGrid(target, columns, rows, gridSize);
  const startKey = gridKey(startGrid);
  const targetKey = gridKey(targetGrid);

  const openHeap = createOpenHeap();
  let heapSequence = 0;
  const cameFrom = new Map<string, string>();
  const positions = new Map<string, GridPosition>([
    [startKey, startGrid],
    [targetKey, targetGrid],
  ]);
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closedSet = new Set<string>();
  const seaCache = new Map<string, boolean>();
  const coastPenaltyCache = new Map<string, number>();
  let totalSearched = 0;

  openHeap.push({
    position: startGrid,
    key: startKey,
    fScore: getHeuristic(startGrid, targetGrid, gridColumns),
    sequence: heapSequence,
  });
  heapSequence += 1;

  const isDeepGridSea = (gp: GridPosition) => {
    const k = gridKey(gp);
    const cached = seaCache.get(k);

    if (cached !== undefined) {
      return cached;
    }

    const sea = isWorldSea(gridToPosition(gp, columns, rows, gridSize));
    seaCache.set(k, sea);

    return sea;
  };

  const getDeepGridCoastPenalty = (gp: GridPosition) => {
    const k = gridKey(gp);
    const cached = coastPenaltyCache.get(k);

    if (cached !== undefined) {
      return cached;
    }

    // scan ring by ring (dist=1 first) so the nearest land determines penalty
    for (let dist = 1; dist <= DEEP_ROUTE_COAST_RADIUS; dist += 1) {
      for (let yOff = -dist; yOff <= dist; yOff += 1) {
        for (let xOff = -dist; xOff <= dist; xOff += 1) {
          const isRingPerimeter =
            Math.abs(xOff) === dist || Math.abs(yOff) === dist;

          if (!isRingPerimeter) {
            continue;
          }

          const neighbor: GridPosition = {
            x: (gp.x + xOff + gridColumns) % gridColumns,
            y: gp.y + yOff,
          };

          if (
            neighbor.y >= 0 &&
            neighbor.y < gridRows &&
            !isDeepGridSea(neighbor)
          ) {
            const penalty = DEEP_ROUTE_COAST_RADIUS - dist + 1;
            coastPenaltyCache.set(k, penalty);
            return penalty;
          }
        }
      }
    }

    coastPenaltyCache.set(k, 0);
    return 0;
  };

  const promise = new Promise<Position[]>((resolve) => {
    const runChunk = () => {
      if (aborted) {
        resolve([]);
        return;
      }

      let chunkNodes = 0;

      while (openHeap.size > 0 && chunkNodes < DEEP_ROUTE_CHUNK_NODES) {
        const { position: current, key: currentKey } = openHeap.pop();

        if (closedSet.has(currentKey)) {
          continue;
        }

        chunkNodes += 1;
        totalSearched += 1;
        closedSet.add(currentKey);

        if (currentKey === targetKey) {
          const gridPath = reconstructPath(cameFrom, currentKey, positions);

          if (!gridPath.length) {
            resolve([]);
            return;
          }

          resolve(
            gridPath
              .slice(1)
              .map((gp) => gridToPosition(gp, columns, rows, gridSize))
              .concat(target),
          );
          return;
        }

        for (let yDelta = -1; yDelta <= 1; yDelta += 1) {
          for (let xDelta = -1; xDelta <= 1; xDelta += 1) {
            if (xDelta === 0 && yDelta === 0) {
              continue;
            }

            const neighbor: GridPosition = {
              x: (current.x + xDelta + gridColumns) % gridColumns,
              y: current.y + yDelta,
            };
            const neighborKey = gridKey(neighbor);
            const isInBounds = neighbor.y >= 0 && neighbor.y < gridRows;
            const isAllowedSea =
              neighborKey === targetKey ||
              neighborKey === startKey ||
              isDeepGridSea(neighbor);

            if (!closedSet.has(neighborKey) && isInBounds && isAllowedSea) {
              const moveCost =
                (xDelta !== 0 && yDelta !== 0 ? Math.SQRT2 : 1) +
                (neighborKey !== targetKey
                  ? getDeepGridCoastPenalty(neighbor)
                  : 0);
              const tentativeG =
                (gScore.get(currentKey) ?? Infinity) + moveCost;

              if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
                cameFrom.set(neighborKey, currentKey);
                positions.set(neighborKey, neighbor);
                gScore.set(neighborKey, tentativeG);
                openHeap.push({
                  position: neighbor,
                  key: neighborKey,
                  fScore:
                    tentativeG + getHeuristic(neighbor, targetGrid, gridColumns),
                  sequence: heapSequence,
                });
                heapSequence += 1;
              }
            }
          }
        }
      }

      if (openHeap.size === 0) {
        resolve([]);
        return;
      }

      onProgress(totalSearched);
      setTimeout(runChunk, 0);
    };

    setTimeout(runChunk, 0);
  });

  return {
    promise,
    abort: () => {
      aborted = true;
    },
  };
};

export const createAutoNavigationPaths = (
  start: Position,
  target: Position,
  strategyIds: AutoNavigationStrategyId[],
  maxSearchedNodes = PREVIEW_SEARCHED_GRID_NODES,
  useCoastPenalty = false,
) => {
  const pathsByGridSize = new Map<number, Position[]>();
  const isBounded = Number.isFinite(maxSearchedNodes);

  return strategyIds.reduce<
    Partial<Record<AutoNavigationStrategyId, Position[]>>
  >((pathsByStrategy, strategyId) => {
    const strategy = getAutoNavigationStrategy(strategyId);
    const path = strategy.gridSizes.reduce<Position[]>(
      (matchedPath, gridSize) => {
        if (matchedPath.length) {
          return matchedPath;
        }

        if (!pathsByGridSize.has(gridSize)) {
          pathsByGridSize.set(
            gridSize,
            findSeaPath({
              start,
              target,
              isSea: isWorldSea,
              gridSize,
              maxSearchedNodes: isBounded
                ? maxSearchedNodes * getPreviewGridBudgetMultiplier(gridSize)
                : maxSearchedNodes,
              useCoastPenalty,
            }),
          );
        }

        return pathsByGridSize.get(gridSize)!;
      },
      [],
    );

    return {
      ...pathsByStrategy,
      [strategyId]: path,
    };
  }, {});
};

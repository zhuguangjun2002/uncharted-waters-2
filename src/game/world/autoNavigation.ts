import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import type {
  AutoNavigationDebug,
  AutoNavigationDebugReason,
  AutoNavigationState,
} from '../../state/state';
import { directionToChanges, type Direction, type Position } from '../../types';
import {
  getFromToAccountingForWrapAround,
  getXWrapAround,
} from './sharedUtils';
import { calculateDestination } from './worldUtils';

const WORLD_MAP_ROWS = 1080;
const DEFAULT_GRID_SIZE = 8;
const FINE_GRID_SIZE = 4;
const COARSE_GRID_SIZE = 12;
// Tile-resolution fallback for ports reachable only through channels too narrow
// for the coarser grids to represent (e.g. Changan).
const TILE_GRID_SIZE = 1;
const REACHED_WAYPOINT_DISTANCE = DEFAULT_GRID_SIZE * 4;
const REACHED_TARGET_DISTANCE = 8;
const DIRECTION_DEAD_ZONE = 1;
const COAST_PENALTY_RADIUS = 16;
const DIAGONAL_OPEN_SEA_RADIUS = 6;
const STAGNANT_MOVE_DISTANCE = 0.001;
const STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS = 12;
const DEEP_ROUTE_STAGNANT_SKIP_THRESHOLD = STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS;
const DEEP_ROUTE_STAGNANT_SKIP_COUNT = 4;
const DEEP_ROUTE_DETOUR_MIN_DISTANCE = 100;
const DEEP_ROUTE_DETOUR_MAX_SEARCH = 200;
const DEEP_ROUTE_DETOUR_MAX_NODES = 5000;
const DEEP_ROUTE_OPEN_SEA_REACHED_WAYPOINT_DISTANCE = DEFAULT_GRID_SIZE * 8;
const DEEP_ROUTE_COASTAL_REACHED_WAYPOINT_DISTANCE = FINE_GRID_SIZE * 3;
const DEEP_ROUTE_HAZARDOUS_COAST_REACHED_WAYPOINT_DISTANCE = FINE_GRID_SIZE;
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
  useSegmentClearance?: boolean;
}

export type AutoNavigationStrategyId =
  | 'balanced'
  | 'detailed'
  | 'offshore'
  | 'deep';

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
  useSegmentClearance = false,
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
  const segmentSeaCache = new Map<string, boolean>();
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

  const isGridInBounds = (gridPosition: GridPosition) =>
    gridPosition.y >= 0 && gridPosition.y < gridRows;

  const isAllowedSeaGrid = (gridPosition: GridPosition) => {
    const key = gridKey(gridPosition);

    return key === targetKey || key === startKey || isGridSea(gridPosition);
  };

  const isGridSegmentSea = (from: GridPosition, to: GridPosition) => {
    const key = `${gridKey(from)}>${gridKey(to)}`;
    const cached = segmentSeaCache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const fromPosition = gridToPosition(from, columns, rows, gridSize);
    const toPosition = gridToPosition(to, columns, rows, gridSize);
    const xDelta = getFromToAccountingForWrapAround(
      fromPosition.x,
      toPosition.x,
    );
    const yDelta = toPosition.y - fromPosition.y;
    const steps = Math.max(Math.abs(xDelta), Math.abs(yDelta), 1);

    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;

      if (
        !isSea({
          x: getXWrapAround(fromPosition.x + xDelta * t),
          y: fromPosition.y + yDelta * t,
        })
      ) {
        segmentSeaCache.set(key, false);
        return false;
      }
    }

    segmentSeaCache.set(key, true);
    return true;
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
          const isDiagonalMove = xDelta !== 0 && yDelta !== 0;
          const horizontalNeighbor = {
            x: (current.x + xDelta + gridColumns) % gridColumns,
            y: current.y,
          };
          const verticalNeighbor = {
            x: current.x,
            y: current.y + yDelta,
          };
          const hasDiagonalClearance =
            !isDiagonalMove ||
            (isGridInBounds(horizontalNeighbor) &&
              isGridInBounds(verticalNeighbor) &&
              isAllowedSeaGrid(horizontalNeighbor) &&
              isAllowedSeaGrid(verticalNeighbor));
          const isAllowedSeaNode = isAllowedSeaGrid(neighbor);
          const isInBounds = isGridInBounds(neighbor);
          const hasSegmentClearance =
            !useSegmentClearance || isGridSegmentSea(current, neighbor);

          if (
            shouldCheckNeighbor &&
            !closedSet.has(neighborKey) &&
            isInBounds &&
            isAllowedSeaNode &&
            hasDiagonalClearance &&
            hasSegmentClearance
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

// Samples the straight line between two world positions and returns false if any
// sampled point is land. Used to decide whether the ship can head directly from
// one position to another without cutting a corner across the coast.
const isSegmentSea = (
  from: Position,
  to: Position,
  isSea: (position: Position) => boolean,
) => {
  const xDelta = getFromToAccountingForWrapAround(from.x, to.x);
  const yDelta = to.y - from.y;
  const steps = Math.max(Math.abs(xDelta), Math.abs(yDelta), 1);

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;

    if (
      !isSea({
        x: getXWrapAround(from.x + xDelta * t),
        y: from.y + yDelta * t,
      })
    ) {
      return false;
    }
  }

  return true;
};

const isOpenSeaForWaypointReach = (position: Position) =>
  getCoastPenalty(position, isWorldSea) === 0;

const isHazardousCoastForWaypointReach = (position: Position) =>
  getCoastPenalty(position, isWorldSea) >= 8;

const canMoveInDirection = (position: Position, direction: Direction | '') => {
  if (!direction) {
    return false;
  }

  const { xDelta, yDelta } = directionToChanges[direction];
  const collisionAt = (nextPosition: Position) => !isWorldSea(nextPosition);
  const isDiagonal = Math.abs(xDelta) > 0 && Math.abs(yDelta) > 0;
  const multiplier = 1 / (isDiagonal ? Math.SQRT2 : 1);
  const destination = !isDiagonal
    ? calculateDestination(position, xDelta, yDelta, multiplier, collisionAt)
    : calculateDestination(
        calculateDestination(position, xDelta, 0, multiplier, collisionAt),
        0,
        yDelta,
        multiplier,
        collisionAt,
      );

  return (
    getDistance(position, {
      x: getXWrapAround(destination.x),
      y: destination.y,
    }) >= STAGNANT_MOVE_DISTANCE
  );
};

const getReachedDistance = (
  position: Position,
  waypointIndex: number,
  autoNavigation: AutoNavigationState,
) => {
  if (waypointIndex === autoNavigation.path.length - 1)
    return REACHED_TARGET_DISTANCE;
  if (autoNavigation.strategyId === 'deep') {
    const waypoint = autoNavigation.path[waypointIndex];

    if (
      waypoint &&
      (isHazardousCoastForWaypointReach(position) ||
        isHazardousCoastForWaypointReach(waypoint))
    ) {
      return DEEP_ROUTE_HAZARDOUS_COAST_REACHED_WAYPOINT_DISTANCE;
    }

    if (
      waypoint &&
      isOpenSeaForWaypointReach(position) &&
      isOpenSeaForWaypointReach(waypoint)
    ) {
      return DEEP_ROUTE_OPEN_SEA_REACHED_WAYPOINT_DISTANCE;
    }

    return DEEP_ROUTE_COASTAL_REACHED_WAYPOINT_DISTANCE;
  }
  return REACHED_WAYPOINT_DISTANCE;
};

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

interface AutoNavigationDebugOptions {
  reason: AutoNavigationDebugReason;
  message: string;
  detourTarget?: Position | null;
  detourTargetIndex?: number | null;
  detourTargetDistance?: number | null;
  detourPathLength?: number | null;
}

const createAutoNavigationDebug = (
  position: Position,
  autoNavigation: AutoNavigationState,
  waypointIndex: number,
  heading: Direction | '',
  {
    reason,
    message,
    detourTarget = null,
    detourTargetIndex = null,
    detourTargetDistance = null,
    detourPathLength = null,
  }: AutoNavigationDebugOptions,
): AutoNavigationDebug => {
  const waypoint = autoNavigation.path[waypointIndex] || null;
  const shouldInspectOpenSea = autoNavigation.strategyId === 'deep';

  return {
    position,
    heading,
    waypoint,
    waypointIndex,
    waypointCount: autoNavigation.path.length,
    distanceToWaypoint: waypoint ? getDistance(position, waypoint) : null,
    reachedDistance: waypoint
      ? getReachedDistance(position, waypointIndex, autoNavigation)
      : null,
    positionSea: isWorldSea(position),
    waypointSea: waypoint ? isWorldSea(waypoint) : null,
    positionOpenSea: shouldInspectOpenSea
      ? isOpenSeaForWaypointReach(position)
      : null,
    waypointOpenSea:
      shouldInspectOpenSea && waypoint
        ? isOpenSeaForWaypointReach(waypoint)
        : null,
    reason,
    message,
    detourTarget,
    detourTargetIndex,
    detourTargetDistance,
    detourPathLength,
  };
};

const getCoastalSafeHeading = (
  position: Position,
  waypoint: Position,
  preferredHeading: Direction | '',
  useAlternateAxis: boolean,
) => {
  if (
    !preferredHeading ||
    isOpenSeaForWaypointReach(position) ||
    canMoveInDirection(position, preferredHeading)
  ) {
    return {
      heading: preferredHeading,
      switchedAxis: false,
    };
  }

  const alternateHeading = getDirectionToPosition(
    position,
    waypoint,
    !useAlternateAxis,
    false,
  );

  if (
    alternateHeading &&
    alternateHeading !== preferredHeading &&
    canMoveInDirection(position, alternateHeading)
  ) {
    return {
      heading: alternateHeading,
      switchedAxis: true,
    };
  }

  return {
    heading: preferredHeading,
    switchedAxis: false,
  };
};

export const getAutoNavigationHeading = (
  position: Position,
  autoNavigation: AutoNavigationState,
) => {
  let { waypointIndex } = autoNavigation;
  let stagnantMoves = autoNavigation.stagnantMoves || 0;
  let useAlternateAxis = autoNavigation.useAlternateAxis || false;
  let debugReason: AutoNavigationDebugReason = 'tracking';
  let debugMessage = '正在追踪当前导航点。';
  let detourTarget: Position | null = null;
  let detourTargetIndex: number | null = null;
  let detourTargetDistance: number | null = null;
  const detourPathLength: number | null = null;

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
    debugReason = 'stagnant-alternate-axis';
    debugMessage = '连续停滞，正在改用单轴航向尝试脱离岸线碰撞。';
  }

  // Deep-route waypoints are only 4 px apart; when stuck, find a waypoint
  // at least DEEP_ROUTE_DETOUR_MIN_DISTANCE px away (physical distance, not
  // waypoint count) and run a local A* detour to it. Never targets the final
  // waypoint so the middle section of the global path is never discarded.
  if (
    autoNavigation.strategyId === 'deep' &&
    stagnantMoves >= DEEP_ROUTE_STAGNANT_SKIP_THRESHOLD
  ) {
    // Walk ahead until we find a waypoint far enough away (distance-based).
    // Cap at path.length - 2 so we never target the final destination.
    const maxSearchIdx = Math.min(
      waypointIndex + DEEP_ROUTE_DETOUR_MAX_SEARCH,
      autoNavigation.path.length - 2,
    );
    let detourTargetIdx = waypointIndex + 1;
    while (
      detourTargetIdx < maxSearchIdx &&
      getDistance(position, autoNavigation.path[detourTargetIdx]) <
        DEEP_ROUTE_DETOUR_MIN_DISTANCE
    ) {
      detourTargetIdx += 1;
    }

    detourTarget = autoNavigation.path[detourTargetIdx] || null;
    detourTargetIndex = detourTargetIdx;
    detourTargetDistance = detourTarget
      ? getDistance(position, detourTarget)
      : null;
    stagnantMoves = 0;
    useAlternateAxis = false;

    const targetIsReachable =
      detourTargetIdx < autoNavigation.path.length - 1 &&
      getDistance(position, autoNavigation.path[detourTargetIdx]) >=
        DEEP_ROUTE_DETOUR_MIN_DISTANCE;

    if (targetIsReachable) {
      const detourSegment = findSeaPath({
        start: position,
        target: autoNavigation.path[detourTargetIdx],
        isSea: isWorldSea,
        gridSize: FINE_GRID_SIZE,
        maxSearchedNodes: DEEP_ROUTE_DETOUR_MAX_NODES,
        useCoastPenalty: false,
        useSegmentClearance: true,
      });

      if (detourSegment.length > 0) {
        const newPath = [
          ...autoNavigation.path.slice(0, waypointIndex),
          ...detourSegment,
          ...autoNavigation.path.slice(detourTargetIdx),
        ];
        const preferredHeading = getDirectionToPosition(
          position,
          detourSegment[0],
          false,
          isOpenSeaForDiagonalHeading(position),
        );
        const { heading, switchedAxis } = getCoastalSafeHeading(
          position,
          detourSegment[0],
          preferredHeading,
          false,
        );
        const detourAutoNavigation = {
          ...autoNavigation,
          path: newPath,
        };

        return {
          heading,
          waypointIndex,
          arrived: false,
          lastPosition: position,
          stagnantMoves: 0,
          useAlternateAxis: false,
          newPath,
          debug: createAutoNavigationDebug(
            position,
            detourAutoNavigation,
            waypointIndex,
            heading,
            {
              reason: switchedAxis
                ? 'coastal-axis-switch'
                : 'deep-detour-created',
              message: switchedAxis
                ? '局部 A* 已插入绕行航段；当前主轴被岸线挡住，先沿另一轴脱离。'
                : '连续停滞，已用局部 A* 插入绕行航段。',
              detourTarget,
              detourTargetIndex,
              detourTargetDistance,
              detourPathLength: detourSegment.length,
            },
          ),
        };
      }

      debugReason = 'deep-detour-failed';
      debugMessage = '局部 A* 没有找到绕行段，已跳过少量前方航点。';
    } else {
      debugReason = 'deep-detour-target-too-close';
      debugMessage = '前方没有足够远的局部绕行目标，已跳过少量前方航点。';
    }

    // detour skipped or A* exhausted budget — nudge ahead a few waypoints
    waypointIndex = Math.min(
      waypointIndex + DEEP_ROUTE_STAGNANT_SKIP_COUNT,
      autoNavigation.path.length - 1,
    );
  }

  while (
    waypointIndex < autoNavigation.path.length &&
    getDistance(position, autoNavigation.path[waypointIndex]) <=
      getReachedDistance(position, waypointIndex, autoNavigation)
  ) {
    // Deep-route waypoints are tile-dense, so near a concave coastline several
    // of them can fall inside the reach radius at once. Blindly skipping to a
    // later waypoint then lets the ship try to cut the corner straight across
    // land and wedge against the coast (e.g. the narrow channel approaching
    // Stockholm). Only skip a waypoint that is still several px away (absorbed
    // by the large reach radius) when the straight line from the ship to the
    // next waypoint stays on open water; otherwise stop and thread the channel
    // waypoint by waypoint. A waypoint the ship is essentially sitting on is
    // always advanced past so it never stalls inside the heading dead zone.
    const nextWaypoint = autoNavigation.path[waypointIndex + 1];
    const onWaypoint =
      getDistance(position, autoNavigation.path[waypointIndex]) <=
      DIRECTION_DEAD_ZONE * Math.SQRT2;

    if (
      autoNavigation.strategyId === 'deep' &&
      nextWaypoint &&
      !onWaypoint &&
      !isSegmentSea(position, nextWaypoint, isWorldSea)
    ) {
      break;
    }

    waypointIndex += 1;
    stagnantMoves = 0;
    useAlternateAxis = false;

    if (debugReason === 'stagnant-alternate-axis') {
      debugReason = 'tracking';
      debugMessage = '已通过近处导航点，正在追踪后续导航点。';
    }
  }

  if (waypointIndex >= autoNavigation.path.length) {
    const heading = '' as Direction | '';

    return {
      heading,
      waypointIndex,
      arrived: true,
      lastPosition: position,
      stagnantMoves,
      useAlternateAxis,
      debug: createAutoNavigationDebug(
        position,
        autoNavigation,
        waypointIndex,
        heading,
        {
          reason: 'arrived',
          message: '已到达目标港邻近海域。',
          detourTarget,
          detourTargetIndex,
          detourTargetDistance,
          detourPathLength,
        },
      ),
    };
  }

  const preferredHeading = getDirectionToPosition(
    position,
    autoNavigation.path[waypointIndex],
    useAlternateAxis,
    !useAlternateAxis && isOpenSeaForDiagonalHeading(position),
  );
  const { heading, switchedAxis } =
    autoNavigation.strategyId === 'deep'
      ? getCoastalSafeHeading(
          position,
          autoNavigation.path[waypointIndex],
          preferredHeading,
          useAlternateAxis,
        )
      : {
          heading: preferredHeading,
          switchedAxis: false,
        };

  if (switchedAxis) {
    debugReason = 'coastal-axis-switch';
    debugMessage = '当前主轴被岸线挡住，先沿另一轴贴边绕行。';
  }

  return {
    heading,
    waypointIndex,
    arrived: false,
    lastPosition: position,
    stagnantMoves,
    useAlternateAxis,
    debug: createAutoNavigationDebug(
      position,
      autoNavigation,
      waypointIndex,
      heading,
      {
        reason: debugReason,
        message: debugMessage,
        detourTarget,
        detourTargetIndex,
        detourTargetDistance,
        detourPathLength,
      },
    ),
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
const DEEP_ROUTE_COAST_RADIUS = 3; // check 3 grid-cells out: penalty 3/2/1 — keeps bays expensive vs open-sea detour
// Cap the tile-resolution channel escape so a target enclosed by land (or with
// no coarse-reachable water nearby) fails gracefully instead of flooding the
// whole ocean tile by tile. The escape is local — it only has to thread the
// channel out to open water — so it normally finishes in a few thousand nodes.
const DEEP_ROUTE_TILE_MAX_NODES = 300000;

export interface DeepRouteHandle {
  promise: Promise<Position[]>;
  abort: () => void;
}

interface ChunkedSeaSearchResult {
  // Grid-cell waypoints from the start (exclusive) to wherever the search
  // stopped, inclusive of the target when it was reached.
  path: Position[];
  // Whether the search actually reached the target, vs. stopping at the
  // reachable cell closest to it (only possible when returnClosestOnExhaust).
  reachedTarget: boolean;
}

interface ChunkedSeaSearch {
  promise: Promise<ChunkedSeaSearchResult>;
  abort: () => void;
}

/*
  Chunked A* over a sea grid of the given cell size, run in setTimeout slices so
  the UI stays responsive. Resolves with a path to the target, or — when
  returnClosestOnExhaust is set and the target is unreachable — a path to the
  reachable cell closest to it (so a finer search can take over the last leg).
  Extracted so the deep route can retry at finer resolutions.
*/
const createChunkedSeaSearch = (
  start: Position,
  target: Position,
  gridSize: number,
  onProgress: (nodesSearched: number) => void,
  maxNodes = Number.POSITIVE_INFINITY,
  useCoastPenalty = true,
  returnClosestOnExhaust = false,
): ChunkedSeaSearch => {
  let aborted = false;
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
  // Closest reachable cell to the target, by heuristic distance. When the
  // target is unreachable (a narrow channel the grid can't represent), this is
  // the cell at the channel mouth on the reachable side — the hand-off point
  // for a finer search.
  let closestKey = startKey;
  let closestHeuristic = getHeuristic(startGrid, targetGrid, gridColumns);

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

          if (isRingPerimeter) {
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
    }

    coastPenaltyCache.set(k, 0);
    return 0;
  };

  const isDeepGridInBounds = (gp: GridPosition) => gp.y >= 0 && gp.y < gridRows;

  const isAllowedDeepSeaGrid = (gp: GridPosition) => {
    const k = gridKey(gp);

    return k === targetKey || k === startKey || isDeepGridSea(gp);
  };

  const buildPath = (key: string) =>
    reconstructPath(cameFrom, key, positions)
      .slice(1)
      .map((gp) => gridToPosition(gp, columns, rows, gridSize));

  const promise = new Promise<ChunkedSeaSearchResult>((resolve) => {
    const runChunk = () => {
      if (aborted) {
        resolve({ path: [], reachedTarget: false });
        return;
      }

      let chunkNodes = 0;

      while (openHeap.size > 0 && chunkNodes < DEEP_ROUTE_CHUNK_NODES) {
        const { position: current, key: currentKey } = openHeap.pop();

        if (!closedSet.has(currentKey)) {
          chunkNodes += 1;
          totalSearched += 1;
          closedSet.add(currentKey);

          const heuristic = getHeuristic(current, targetGrid, gridColumns);

          if (heuristic < closestHeuristic) {
            closestHeuristic = heuristic;
            closestKey = currentKey;
          }

          if (currentKey === targetKey) {
            const path = buildPath(currentKey);

            if (!path.length) {
              resolve({ path: [], reachedTarget: false });
              return;
            }

            resolve({ path: path.concat(target), reachedTarget: true });
            return;
          }

          for (let yDelta = -1; yDelta <= 1; yDelta += 1) {
            for (let xDelta = -1; xDelta <= 1; xDelta += 1) {
              const shouldCheckNeighbor = xDelta !== 0 || yDelta !== 0;

              if (shouldCheckNeighbor) {
                const neighbor: GridPosition = {
                  x: (current.x + xDelta + gridColumns) % gridColumns,
                  y: current.y + yDelta,
                };
                const neighborKey = gridKey(neighbor);
                const isDiagonalMove = xDelta !== 0 && yDelta !== 0;
                const horizontalNeighbor: GridPosition = {
                  x: (current.x + xDelta + gridColumns) % gridColumns,
                  y: current.y,
                };
                const verticalNeighbor: GridPosition = {
                  x: current.x,
                  y: current.y + yDelta,
                };
                const hasDiagonalClearance =
                  !isDiagonalMove ||
                  (isDeepGridInBounds(horizontalNeighbor) &&
                    isDeepGridInBounds(verticalNeighbor) &&
                    isAllowedDeepSeaGrid(horizontalNeighbor) &&
                    isAllowedDeepSeaGrid(verticalNeighbor));
                const isInBounds = isDeepGridInBounds(neighbor);
                const isAllowedSea = isAllowedDeepSeaGrid(neighbor);

                if (
                  !closedSet.has(neighborKey) &&
                  isInBounds &&
                  isAllowedSea &&
                  hasDiagonalClearance
                ) {
                  const moveCost =
                    (xDelta !== 0 && yDelta !== 0 ? Math.SQRT2 : 1) +
                    (useCoastPenalty && neighborKey !== targetKey
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
                        tentativeG +
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
      }

      if (openHeap.size === 0 || totalSearched >= maxNodes) {
        if (returnClosestOnExhaust && closestKey !== startKey) {
          resolve({ path: buildPath(closestKey), reachedTarget: false });
        } else {
          resolve({ path: [], reachedTarget: false });
        }

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

/*
  Deep route search for long-haul voyages, including ports reachable only
  through channels too narrow for the coarse grid to represent (e.g. Changan).

  Two phases, so the expensive tile resolution stays local:
    1. Long-haul coarse (4x4) search from the start toward the target. If the
       target is open water this reaches it directly and we are done. If it sits
       behind a narrow channel the coarse grid can't represent, the search floods
       the whole reachable ocean and reports the reachable cell closest to the
       target — the channel mouth on the open-sea side.
    2. From that channel mouth, a tile-resolution search threads the final leg
       into the target, capped so an unreachable target fails gracefully.

  Crucially the half-globe leg is never searched at tile resolution, which is
  what made Lisbon -> Changan explore ~400k nodes and fail.
*/
export const findDeepRoutePath = (
  start: Position,
  target: Position,
  onProgress: (nodesSearched: number) => void,
): DeepRouteHandle => {
  let aborted = false;
  let activeSearch: ChunkedSeaSearch | null = null;

  const promise = (async () => {
    let haulNodes = 0;
    const haul = createChunkedSeaSearch(
      start,
      target,
      FINE_GRID_SIZE,
      (nodes) => {
        haulNodes = nodes;
        onProgress(nodes);
      },
      Number.POSITIVE_INFINITY,
      true,
      true,
    );
    activeSearch = haul;

    const { path: haulPath, reachedTarget } = await haul.promise;

    if (aborted) {
      return [];
    }

    if (reachedTarget) {
      return haulPath;
    }

    if (!haulPath.length) {
      return [];
    }

    // haulPath stops at the channel mouth; thread the final narrow leg into the
    // target at tile resolution. Coast penalty is meaningless in a 1-tile
    // channel and its ring-scan would explode memory, so disable it.
    const channelMouth = haulPath[haulPath.length - 1];
    const channel = createChunkedSeaSearch(
      channelMouth,
      target,
      TILE_GRID_SIZE,
      (nodes) => onProgress(haulNodes + nodes),
      DEEP_ROUTE_TILE_MAX_NODES,
      false,
    );
    activeSearch = channel;

    const { path: channelPath, reachedTarget: channelReached } =
      await channel.promise;

    if (aborted || !channelReached) {
      return [];
    }

    // haulPath ends at the channel mouth and channelPath excludes its own start
    // (the mouth), so they stitch without a duplicated point.
    return [...haulPath, ...channelPath];
  })();

  return {
    promise,
    abort: () => {
      aborted = true;
      activeSearch?.abort();
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

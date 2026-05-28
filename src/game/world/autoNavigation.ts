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
const REACHED_WAYPOINT_DISTANCE = DEFAULT_GRID_SIZE * 4;
const REACHED_TARGET_DISTANCE = 8;
const DIRECTION_DEAD_ZONE = 1;
const COAST_PENALTY_RADIUS = 16;
const STAGNANT_MOVE_DISTANCE = 0.001;
const STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS = 12;

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
}

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

const reconstructPath = (
  cameFrom: Map<string, string>,
  currentKey: string,
  positions: Map<string, GridPosition>,
) => {
  const path = [positions.get(currentKey)!];
  let key = currentKey;

  while (cameFrom.has(key)) {
    key = cameFrom.get(key)!;
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
}: PathOptions) => {
  const gridColumns = getGridColumns(columns, gridSize);
  const gridRows = getGridRows(rows, gridSize);
  const startGrid = positionToGrid(start, columns, rows, gridSize);
  const targetGrid = positionToGrid(target, columns, rows, gridSize);
  const targetKey = gridKey(targetGrid);

  const openSet = [startGrid];
  const cameFrom = new Map<string, string>();
  const positions = new Map<string, GridPosition>([
    [gridKey(startGrid), startGrid],
    [targetKey, targetGrid],
  ]);
  const gScore = new Map<string, number>([[gridKey(startGrid), 0]]);
  const fScore = new Map<string, number>([
    [gridKey(startGrid), getHeuristic(startGrid, targetGrid, gridColumns)],
  ]);
  const seaCache = new Map<string, boolean>();
  const coastPenaltyCache = new Map<string, number>();

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

  while (openSet.length) {
    openSet.sort(
      (a, b) =>
        (fScore.get(gridKey(a)) ?? Infinity) -
        (fScore.get(gridKey(b)) ?? Infinity),
    );

    const current = openSet.shift()!;
    const currentKey = gridKey(current);

    if (currentKey === targetKey) {
      return reconstructPath(cameFrom, currentKey, positions)
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
          neighborKey === gridKey(startGrid) ||
          isGridSea(neighbor);
        const isInBounds = neighbor.y >= 0 && neighbor.y < gridRows;

        if (shouldCheckNeighbor && isInBounds && isAllowedSeaNode) {
          const tentativeGScore =
            (gScore.get(currentKey) ?? Infinity) +
            (xDelta !== 0 && yDelta !== 0 ? Math.SQRT2 : 1) +
            getGridCoastPenalty(neighbor);

          if (tentativeGScore < (gScore.get(neighborKey) ?? Infinity)) {
            cameFrom.set(neighborKey, currentKey);
            positions.set(neighborKey, neighbor);
            gScore.set(neighborKey, tentativeGScore);
            fScore.set(
              neighborKey,
              tentativeGScore + getHeuristic(neighbor, targetGrid, gridColumns),
            );

            if (
              !openSet.some((position) => gridKey(position) === neighborKey)
            ) {
              openSet.push(neighbor);
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

  return primaryDirection;
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
    ),
    waypointIndex,
    arrived: false,
    lastPosition: position,
    stagnantMoves,
    useAlternateAxis,
  };
};

export const createAutoNavigationPath = (start: Position, target: Position) => {
  const path = findSeaPath({
    start,
    target,
    isSea: isWorldSea,
  });

  if (path.length) {
    return path;
  }

  return findSeaPath({
    start,
    target,
    isSea: isWorldSea,
    gridSize: FINE_GRID_SIZE,
  });
};

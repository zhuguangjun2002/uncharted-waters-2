import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import type { AutoNavigationState } from '../../state/state';
import type { Direction, Position } from '../../types';
import {
  getFromToAccountingForWrapAround,
  getXWrapAround,
} from './sharedUtils';

const WORLD_MAP_ROWS = 1080;
const DEFAULT_GRID_SIZE = 4;
const REACHED_WAYPOINT_DISTANCE = DEFAULT_GRID_SIZE / 2;
const DIRECTION_DEAD_ZONE = 1;

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
            (xDelta !== 0 && yDelta !== 0 ? Math.SQRT2 : 1);

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

export const getDirectionToPosition = (
  from: Position,
  to: Position,
): Direction | '' => {
  const xDelta = getFromToAccountingForWrapAround(from.x, to.x);
  const yDelta = to.y - from.y;
  let x = '';
  let y = '';

  if (Math.abs(xDelta) > DIRECTION_DEAD_ZONE) {
    x = xDelta > 0 ? 'e' : 'w';
  }

  if (Math.abs(yDelta) > DIRECTION_DEAD_ZONE) {
    y = yDelta > 0 ? 's' : 'n';
  }

  return `${y}${x}` as Direction | '';
};

export const getAutoNavigationHeading = (
  position: Position,
  autoNavigation: AutoNavigationState,
) => {
  let { waypointIndex } = autoNavigation;

  while (
    waypointIndex < autoNavigation.path.length &&
    getDistance(position, autoNavigation.path[waypointIndex]) <=
      REACHED_WAYPOINT_DISTANCE
  ) {
    waypointIndex += 1;
  }

  if (waypointIndex >= autoNavigation.path.length) {
    return {
      heading: '' as Direction | '',
      waypointIndex,
      arrived: true,
    };
  }

  return {
    heading: getDirectionToPosition(
      position,
      autoNavigation.path[waypointIndex],
    ),
    waypointIndex,
    arrived: false,
  };
};

export const createAutoNavigationPath = (start: Position, target: Position) =>
  findSeaPath({
    start,
    target,
    isSea: isWorldSea,
  });

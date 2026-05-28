import fs from 'fs';

import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import type { Direction, Position } from '../../types';
import { directionToChanges } from '../../types';
import { calculateDestination } from './worldUtils';
import {
  getFromToAccountingForWrapAround,
  getXWrapAround,
} from './sharedUtils';
import {
  createAutoNavigationPath,
  createAutoNavigationPaths,
  findSeaPath,
  getAutoNavigationHeading,
  getDirectionToPosition,
} from './autoNavigation';
import type { AutoNavigationState } from '../../state/state';
import { positionAdjacentToPort } from '../../state/selectors';

describe('findSeaPath', () => {
  test('uses horizontal wraparound for shorter paths', () => {
    const path = findSeaPath({
      start: { x: 58, y: 15 },
      target: { x: 2, y: 15 },
      columns: 60,
      rows: 30,
      gridSize: 10,
      isSea: () => true,
    });

    expect(path[0]).toEqual({ x: 5, y: 15 });
    expect(path[path.length - 1]).toEqual({ x: 2, y: 15 });
  });

  test('avoids blocked grid positions', () => {
    const path = findSeaPath({
      start: { x: 5, y: 5 },
      target: { x: 35, y: 5 },
      columns: 50,
      rows: 30,
      gridSize: 10,
      isSea: ({ x, y }) => !(x === 25 && y === 5),
    });

    expect(path).not.toContainEqual({ x: 25, y: 5 });
    expect(path[path.length - 1]).toEqual({ x: 35, y: 5 });
  });

  test('stops searching after the maximum searched nodes', () => {
    const path = findSeaPath({
      start: { x: 5, y: 5 },
      target: { x: 95, y: 95 },
      columns: 100,
      rows: 100,
      gridSize: 1,
      maxSearchedNodes: 10,
      isSea: () => true,
    });

    expect(path).toEqual([]);
  });
});

describe('getDirectionToPosition', () => {
  test('returns wrapped east direction across the map boundary', () => {
    expect(getDirectionToPosition({ x: 2159, y: 10 }, { x: 1, y: 10 })).toBe(
      'e',
    );
  });

  test('uses diagonal headings when both axes need movement', () => {
    expect(getDirectionToPosition({ x: 10, y: 10 }, { x: 20, y: 20 })).toBe(
      'se',
    );
    expect(getDirectionToPosition({ x: 10, y: 10 }, { x: 20, y: 0 })).toBe(
      'ne',
    );
    expect(getDirectionToPosition({ x: 10, y: 10 }, { x: 0, y: 20 })).toBe(
      'sw',
    );
    expect(getDirectionToPosition({ x: 10, y: 10 }, { x: 0, y: 0 })).toBe('nw');
  });

  test('uses one axis at a time only for alternate-axis recovery', () => {
    expect(
      getDirectionToPosition({ x: 10, y: 10 }, { x: 20, y: 20 }, true),
    ).toBe('s');
  });
});

describe('getAutoNavigationHeading', () => {
  const baseAutoNavigation: AutoNavigationState = {
    enabled: true,
    targetPortId: '1',
    targetPosition: { x: 40, y: 10 },
    strategyId: 'balanced',
    path: [
      { x: 10, y: 10 },
      { x: 80, y: 10 },
    ],
    waypointIndex: 0,
    lastPosition: null,
    stagnantMoves: 0,
    useAlternateAxis: false,
  };

  test('advances past reached waypoints', () => {
    expect(
      getAutoNavigationHeading({ x: 10, y: 10 }, baseAutoNavigation),
    ).toMatchObject({
      heading: 'e',
      waypointIndex: 1,
      arrived: false,
    });
  });

  test('advances past near waypoints to avoid getting stuck on coastlines', () => {
    expect(
      getAutoNavigationHeading({ x: 3, y: 10 }, baseAutoNavigation),
    ).toMatchObject({
      heading: 'e',
      waypointIndex: 1,
      arrived: false,
    });
  });

  test('reports arrival after the final waypoint', () => {
    expect(
      getAutoNavigationHeading(
        { x: 80, y: 10 },
        {
          ...baseAutoNavigation,
          waypointIndex: 1,
        },
      ),
    ).toMatchObject({
      heading: '',
      waypointIndex: 2,
      arrived: true,
    });
  });

  test('uses the alternate axis after repeated stagnant moves', () => {
    expect(
      getAutoNavigationHeading(
        { x: 10, y: 10 },
        {
          ...baseAutoNavigation,
          path: [{ x: 0, y: 50 }],
          lastPosition: { x: 10, y: 10 },
          stagnantMoves: 12,
        },
      ),
    ).toMatchObject({
      heading: 'w',
      useAlternateAxis: true,
    });
  });
});

describe('auto navigation simulation', () => {
  const worldTilemap = new Uint8Array(
    fs.readFileSync('src/data/assets/worldTilemap.wasm'),
  );
  const worldMapRows = 1080;
  const testSpeed = 0.5;

  beforeEach(() => {
    jest.spyOn(Assets, 'data').mockReturnValue(worldTilemap);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const tileAt = ({ x, y }: Position) =>
    worldTilemap[Math.floor(y) * WORLD_MAP_COLUMNS + getXWrapAround(x)] || 0;

  const collisionAt = ({ x, y }: Position) => {
    if (y < 0 || y + 1 >= worldMapRows) {
      return true;
    }

    return [
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ].some((offset) => tileAt({ x: x + offset.x, y: y + offset.y }) >= 50);
  };

  const move = (position: Position, direction: Direction) => {
    const { xDelta, yDelta } = directionToChanges[direction];
    const isDiagonal = Math.abs(xDelta) > 0 && Math.abs(yDelta) > 0;
    const multiplier = testSpeed / (isDiagonal ? Math.SQRT2 : 1);

    if (!isDiagonal) {
      return calculateDestination(
        position,
        xDelta,
        yDelta,
        multiplier,
        collisionAt,
      );
    }

    const firstDestination = calculateDestination(
      position,
      xDelta,
      0,
      multiplier,
      collisionAt,
    );

    return calculateDestination(
      firstDestination,
      0,
      yDelta,
      multiplier,
      collisionAt,
    );
  };

  const distance = (from: Position, to: Position) => {
    const x = getFromToAccountingForWrapAround(from.x, to.x);
    const y = to.y - from.y;

    return Math.sqrt(x * x + y * y);
  };

  test('Lisbon to Hormuz does not get stuck', () => {
    let position = { x: 838, y: 358 };
    const targetPosition = { x: 1240, y: 448 };
    const autoNavigation: AutoNavigationState = {
      enabled: true,
      targetPortId: '74',
      targetPosition,
      strategyId: 'balanced',
      path: createAutoNavigationPath(position, targetPosition),
      waypointIndex: 0,
      lastPosition: null,
      stagnantMoves: 0,
      useAlternateAxis: false,
    };
    let stagnantMoves = 0;

    expect(autoNavigation.path.length).toBeGreaterThan(0);

    for (let i = 0; i < 20000; i += 1) {
      const {
        heading,
        waypointIndex,
        arrived,
        lastPosition,
        stagnantMoves: autoNavigationStagnantMoves,
        useAlternateAxis,
      } = getAutoNavigationHeading(position, autoNavigation);

      autoNavigation.waypointIndex = waypointIndex;
      autoNavigation.lastPosition = lastPosition;
      autoNavigation.stagnantMoves = autoNavigationStagnantMoves;
      autoNavigation.useAlternateAxis = useAlternateAxis;

      if (arrived) {
        expect(distance(position, targetPosition)).toBeLessThan(12);
        return;
      }

      if (!heading) {
        throw Error(`Auto navigation returned no heading at step ${i}`);
      }

      const destination = move(position, heading);
      const nextPosition = {
        x: getXWrapAround(destination.x),
        y: destination.y,
      };

      if (distance(position, nextPosition) < 0.001) {
        stagnantMoves += 1;
      } else {
        stagnantMoves = 0;
      }

      if (stagnantMoves >= 30) {
        throw Error(
          `Auto navigation stuck at step ${i}, position ${JSON.stringify(
            position,
          )}, waypoint ${JSON.stringify(autoNavigation.path[waypointIndex])}`,
        );
      }

      position = nextPosition;
    }

    throw Error('Auto navigation did not arrive within 20000 simulated steps');
  });

  test('Hormuz to Changan preview returns without exhausting route search', () => {
    const paths = createAutoNavigationPaths(
      { x: 1240, y: 448 },
      { x: 1560, y: 386 },
      ['balanced', 'detailed', 'offshore'],
      400,
    );

    expect(Object.keys(paths)).toEqual(['balanced', 'detailed', 'offshore']);
  });

  test('Lisbon to Barcelona preview still finds a route', () => {
    const paths = createAutoNavigationPaths(
      { x: 838, y: 358 },
      positionAdjacentToPort('4'),
      ['balanced', 'detailed', 'offshore'],
      3000,
    );

    expect(paths.balanced?.length || 0).toBeGreaterThan(0);
  });

  test('Lisbon to Mombasa preview at production budget finds offshore and balanced routes', () => {
    const paths = createAutoNavigationPaths(
      { x: 838, y: 358 },
      positionAdjacentToPort('70'),
      ['balanced', 'detailed', 'offshore'],
      400,
    );

    expect(paths.balanced?.length || 0).toBeGreaterThan(0);
    expect(paths.offshore?.length || 0).toBeGreaterThan(0);
    expect(paths.detailed?.length || 0).toBe(0);
  });

  const simulateAutoNavigation = (
    start: Position,
    targetPosition: Position,
    path: Position[],
    strategyId: 'balanced' | 'detailed' | 'offshore',
    maxSteps = 40000,
    stagnantLimit = 30,
  ) => {
    let position = start;
    const autoNavigation: AutoNavigationState = {
      enabled: true,
      targetPortId: '70',
      targetPosition,
      strategyId,
      path,
      waypointIndex: 0,
      lastPosition: null,
      stagnantMoves: 0,
      useAlternateAxis: false,
    };
    let stagnantMoves = 0;

    for (let i = 0; i < maxSteps; i += 1) {
      const {
        heading,
        waypointIndex,
        arrived,
        lastPosition,
        stagnantMoves: autoNavigationStagnantMoves,
        useAlternateAxis,
      } = getAutoNavigationHeading(position, autoNavigation);

      autoNavigation.waypointIndex = waypointIndex;
      autoNavigation.lastPosition = lastPosition;
      autoNavigation.stagnantMoves = autoNavigationStagnantMoves;
      autoNavigation.useAlternateAxis = useAlternateAxis;

      if (arrived) {
        return { status: 'arrived' as const, position, steps: i };
      }

      if (!heading) {
        return { status: 'no-heading' as const, position, steps: i };
      }

      const destination = move(position, heading);
      const nextPosition = {
        x: getXWrapAround(destination.x),
        y: destination.y,
      };

      if (distance(position, nextPosition) < 0.001) {
        stagnantMoves += 1;
      } else {
        stagnantMoves = 0;
      }

      if (stagnantMoves >= stagnantLimit) {
        return {
          status: 'stuck' as const,
          position,
          steps: i,
          waypoint: autoNavigation.path[waypointIndex],
          waypointIndex,
        };
      }

      position = nextPosition;
    }

    return { status: 'timeout' as const, position, steps: maxSteps };
  };

  test.each(['balanced', 'offshore'] as const)(
    'Lisbon to Mombasa with %s actual-nav path does not get stuck',
    (strategyId) => {
      const start = { x: 838, y: 358 };
      const targetPosition = positionAdjacentToPort('70');
      const path = createAutoNavigationPath(start, targetPosition, strategyId);

      expect(path.length).toBeGreaterThan(0);

      const result = simulateAutoNavigation(
        start,
        targetPosition,
        path,
        strategyId,
      );

      if (result.status === 'stuck') {
        throw Error(
          `Auto navigation stuck at step ${
            result.steps
          }, position ${JSON.stringify(result.position)}, waypoint #${
            result.waypointIndex
          } ${JSON.stringify(result.waypoint)}`,
        );
      }

      expect(result.status).toBe('arrived');
    },
  );
});

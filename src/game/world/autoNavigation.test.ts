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
  findDeepRoutePath,
  findSeaPath,
  getAutoNavigationHeading,
  getDirectionToPosition,
  isWorldSea,
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
    debug: null,
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

  const move = (
    position: Position,
    direction: Direction,
    speed = testSpeed,
  ) => {
    const { xDelta, yDelta } = directionToChanges[direction];
    const isDiagonal = Math.abs(xDelta) > 0 && Math.abs(yDelta) > 0;
    const multiplier = speed / (isDiagonal ? Math.SQRT2 : 1);

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

  test('deep routes keep a tight waypoint radius near the Cape Town coast', () => {
    const autoNavigation: AutoNavigationState = {
      enabled: true,
      targetPortId: '96',
      targetPosition: { x: 1582, y: 472 },
      strategyId: 'deep',
      path: [
        { x: 993, y: 852 },
        { x: 996, y: 860 },
        { x: 1004, y: 868 },
        { x: 1012, y: 868 },
        { x: 1070, y: 860 },
      ],
      waypointIndex: 0,
      lastPosition: null,
      stagnantMoves: 0,
      useAlternateAxis: false,
      debug: null,
    };

    const result = getAutoNavigationHeading(
      { x: 1001, y: 840 },
      autoNavigation,
    );

    expect(result).toMatchObject({
      heading: 's',
      waypointIndex: 0,
      debug: {
        reachedDistance: 4,
        positionOpenSea: false,
        waypoint: { x: 993, y: 852 },
      },
    });
  });

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
      debug: null,
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
        newPath,
        debug,
      } = getAutoNavigationHeading(position, autoNavigation);

      autoNavigation.waypointIndex = waypointIndex;
      autoNavigation.lastPosition = lastPosition;
      autoNavigation.stagnantMoves = autoNavigationStagnantMoves;
      autoNavigation.useAlternateAxis = useAlternateAxis;
      autoNavigation.debug = debug;
      if (newPath) {
        autoNavigation.path = newPath;
      }

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
    strategyId: AutoNavigationState['strategyId'],
    maxSteps = 40000,
    stagnantLimit = 30,
    speed = testSpeed,
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
      debug: null,
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
        newPath,
        debug,
      } = getAutoNavigationHeading(position, autoNavigation);

      autoNavigation.waypointIndex = waypointIndex;
      autoNavigation.lastPosition = lastPosition;
      autoNavigation.stagnantMoves = autoNavigationStagnantMoves;
      autoNavigation.useAlternateAxis = useAlternateAxis;
      autoNavigation.debug = debug;
      if (newPath) {
        autoNavigation.path = newPath;
      }

      if (arrived) {
        return { status: 'arrived' as const, position, steps: i };
      }

      if (!heading) {
        return { status: 'no-heading' as const, position, steps: i };
      }

      const destination = move(position, heading, speed);
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
          debug: autoNavigation.debug,
          autoNavigationStagnantMoves: autoNavigation.stagnantMoves,
        };
      }

      position = nextPosition;
    }

    return { status: 'timeout' as const, position, steps: maxSteps };
  };

  test('deep detour around the Malaysia island does not skip into the coast', () => {
    const start = { x: 1498, y: 586 };
    const targetPosition = { x: 1572, y: 516 };
    const path = findSeaPath({
      start,
      target: targetPosition,
      isSea: isWorldSea,
      gridSize: 4,
      maxSearchedNodes: 5000,
      useCoastPenalty: false,
      useSegmentClearance: true,
    });

    expect(path.length).toBeGreaterThan(0);

    const firstHeading = getAutoNavigationHeading(start, {
      enabled: true,
      targetPortId: '96',
      targetPosition,
      strategyId: 'deep',
      path,
      waypointIndex: 0,
      lastPosition: null,
      stagnantMoves: 0,
      useAlternateAxis: false,
      debug: null,
    });

    expect(firstHeading).toMatchObject({
      waypointIndex: 1,
      heading: 'w',
      debug: {
        waypoint: { x: 1490, y: 582 },
      },
    });

    const result = simulateAutoNavigation(
      start,
      targetPosition,
      path,
      'deep',
      20000,
      30,
      2,
    );

    if (result.status === 'stuck') {
      throw Error(
        `Auto navigation stuck at step ${
          result.steps
        }, position ${JSON.stringify(result.position)}, waypoint #${
          result.waypointIndex
        } ${JSON.stringify(result.waypoint)}, debug ${JSON.stringify(
          result.debug,
        )}, nav stagnant ${JSON.stringify(result.autoNavigationStagnantMoves)}`,
      );
    }

    expect(result.status).toBe('arrived');
  });

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
          } ${JSON.stringify(result.waypoint)}, debug ${JSON.stringify(
            result.debug,
          )}`,
        );
      }

      expect(result.status).toBe('arrived');
    },
  );

  describe('narrow-channel ports (Lushun -> Changan)', () => {
    // Changan (port 98) sits at the end of a 1-tile-wide channel. The coarse
    // grids can't represent it, so only tile resolution finds the route.
    // (Computed inside each test so the Assets.data mock from beforeEach is set.)
    const lushunAndChangan = () => ({
      start: positionAdjacentToPort('107'),
      target: positionAdjacentToPort('98'),
    });

    test('coarse grids cannot reach it', () => {
      const { start, target } = lushunAndChangan();

      // useCoastPenalty: false keeps A* heuristic-guided so the open set stays
      // small while it exhausts the (disconnected) coarse component.
      expect(
        findSeaPath({
          start,
          target,
          isSea: isWorldSea,
          gridSize: 8,
          maxSearchedNodes: 200000,
          useCoastPenalty: false,
        }),
      ).toEqual([]);
      expect(
        findSeaPath({
          start,
          target,
          isSea: isWorldSea,
          gridSize: 4,
          maxSearchedNodes: 200000,
          useCoastPenalty: false,
        }),
      ).toEqual([]);
    });

    test('tile resolution finds the channel', () => {
      const { start, target } = lushunAndChangan();
      const path = findSeaPath({
        start,
        target,
        isSea: isWorldSea,
        gridSize: 1,
        maxSearchedNodes: 300000,
        useCoastPenalty: false,
      });

      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(target);
    });

    test('deep route falls back to tile resolution and finds a path', async () => {
      const { start, target } = lushunAndChangan();
      const { promise } = findDeepRoutePath(start, target, () => {});
      const path = await promise;

      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual(target);
    }, 60000);
  });
});

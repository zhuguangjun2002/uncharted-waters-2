import {
  findSeaPath,
  getAutoNavigationHeading,
  getDirectionToPosition,
} from './autoNavigation';
import type { AutoNavigationState } from '../../state/state';

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
});

describe('getDirectionToPosition', () => {
  test('returns wrapped east direction across the map boundary', () => {
    expect(getDirectionToPosition({ x: 2159, y: 10 }, { x: 1, y: 10 })).toBe(
      'e',
    );
  });

  test('returns ordinal directions', () => {
    expect(getDirectionToPosition({ x: 10, y: 10 }, { x: 20, y: 20 })).toBe(
      'se',
    );
  });
});

describe('getAutoNavigationHeading', () => {
  const baseAutoNavigation: AutoNavigationState = {
    enabled: true,
    targetPortId: '1',
    targetPosition: { x: 40, y: 10 },
    path: [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
    ],
    waypointIndex: 0,
  };

  test('advances past reached waypoints', () => {
    expect(
      getAutoNavigationHeading({ x: 10, y: 10 }, baseAutoNavigation),
    ).toEqual({
      heading: 'e',
      waypointIndex: 1,
      arrived: false,
    });
  });

  test('reports arrival after the final waypoint', () => {
    expect(
      getAutoNavigationHeading(
        { x: 40, y: 10 },
        {
          ...baseAutoNavigation,
          waypointIndex: 1,
        },
      ),
    ).toEqual({
      heading: '',
      waypointIndex: 2,
      arrived: true,
    });
  });
});

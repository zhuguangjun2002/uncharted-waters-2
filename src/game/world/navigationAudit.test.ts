import type { Position } from '../../types';
import {
  findMidRouteLandCrossings,
  findWaypointsOnLand,
  formatReportMarkdown,
  simulateFollow,
} from './navigationAudit';
import type { AuditReport } from './navigationAudit';

describe('findWaypointsOnLand', () => {
  // Land everywhere except a sea corridor along y === 10.
  const isSea = ({ y }: Position) => y === 10;

  test('flags waypoints whose footprint is not sea', () => {
    const path = [
      { x: 0, y: 10 },
      { x: 5, y: 11 },
      { x: 10, y: 10 },
      { x: 15, y: 9 },
    ];

    expect(findWaypointsOnLand(path, isSea)).toEqual([
      { x: 5, y: 11 },
      { x: 15, y: 9 },
    ]);
  });

  test('returns nothing when every waypoint is sea', () => {
    expect(
      findWaypointsOnLand(
        [
          { x: 0, y: 10 },
          { x: 4, y: 10 },
        ],
        isSea,
      ),
    ).toEqual([]);
  });
});

describe('findMidRouteLandCrossings', () => {
  // A vertical land wall at x === 500; sea everywhere else.
  const isSea = ({ x }: Position) => Math.round(x) !== 500;

  test('detects a mid-route segment that cuts across the wall', () => {
    // The crossing segment (300 -> 700) is well clear of both endpoints, so it
    // is not exempt.
    const start = { x: 0, y: 500 };
    const target = { x: 1000, y: 500 };
    const path = [
      { x: 300, y: 500 },
      { x: 700, y: 500 },
      { x: 1000, y: 500 },
    ];

    const crossings = findMidRouteLandCrossings(path, start, target, isSea);

    expect(crossings).toHaveLength(1);
    expect(Math.round(crossings[0].at.x)).toBe(500);
  });

  test('ignores crossings within the endpoint exemption radius', () => {
    // The only segment that hits the wall ends at the target, so the clipping
    // is an exempt harbour approach.
    const start = { x: 0, y: 500 };
    const target = { x: 1000, y: 500 };
    const path = [{ x: 1000, y: 500 }];

    expect(findMidRouteLandCrossings(path, start, target, isSea)).toHaveLength(
      0,
    );
  });
});

describe('simulateFollow', () => {
  // Open sea everywhere (collisionAt always false) so the follower can run a
  // simple straight path to completion.
  const noCollision = () => false;

  test('reports arrival on a clear straight route', () => {
    const start = { x: 100, y: 100 };
    const target = { x: 140, y: 100 };
    const result = simulateFollow(
      start,
      target,
      [target],
      'balanced',
      noCollision,
      { speed: 2 },
    );

    expect(result.status).toBe('arrived');
  });
});

describe('formatReportMarkdown', () => {
  test('renders a clean-run summary', () => {
    const report: AuditReport = {
      generatedAt: '2026-05-30T00:00:00.000Z',
      strategyId: 'balanced',
      simulated: false,
      totalRoutes: 3,
      passed: 3,
      failed: 0,
      failuresByKind: {},
      results: [],
    };

    const markdown = formatReportMarkdown(report);

    expect(markdown).toContain('Passed: 3');
    expect(markdown).toContain('all audited routes passed');
  });

  test('lists failing routes with their failure kinds', () => {
    const report: AuditReport = {
      generatedAt: '2026-05-30T00:00:00.000Z',
      strategyId: 'balanced',
      simulated: true,
      totalRoutes: 1,
      passed: 0,
      failed: 1,
      failuresByKind: { 'no-path': 1 },
      results: [
        {
          from: { id: '1', name: 'Lisbon', position: { x: 838, y: 358 } },
          to: { id: '98', name: 'Changan', position: { x: 1560, y: 386 } },
          strategyId: 'balanced',
          ok: false,
          pathLength: 0,
          failures: [{ kind: 'no-path', detail: 'planner returned no route' }],
        },
      ],
    };

    const markdown = formatReportMarkdown(report);

    expect(markdown).toContain('Lisbon (1) → Changan (98)');
    expect(markdown).toContain('**no-path**');
  });
});

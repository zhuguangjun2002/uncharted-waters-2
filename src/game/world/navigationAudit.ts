/*
  Batch route audit (P0-A from claude-plan-v1.md).

  Auto-navigation failures are rarely single-point bugs — they cluster around a
  *class* of strait, archipelago, port entrance, or coarse-grid connectivity
  problem. Hand-picked regression cases (autoNavigation.test.ts) miss whole
  swathes of the map. This module sweeps many port pairs and reports, per route:

    - whether a path was found at all,
    - whether every waypoint sits on navigable sea,
    - whether any mid-route segment cuts across land, and
    - (optionally) whether the real follower reaches the target without wedging.

  It is a *tool*, not a gate: it produces a structured report so that newly
  surfaced failures can be triaged and the representative ones distilled back
  into focused unit tests. The pure check functions take an injectable `isSea`
  so they can be unit-tested without loading the world tilemap; the higher-level
  audit entry points default to the real `isWorldSea` / world collision model.
*/

import createMap from '../../map';
import { directionToChanges } from '../../types';
import type { Direction, Position } from '../../types';
import { getPortData } from '../port/portUtils';
import { regularPorts, supplyPorts } from '../../data/portData';
import { applyPositionDelta } from '../../utils';
import { calculateDestination } from './worldUtils';
import {
  getFromToAccountingForWrapAround,
  getXWrapAround,
} from './sharedUtils';
import {
  createAutoNavigationPath,
  findDeepRoutePath,
  getAutoNavigationHeading,
  isWorldSea,
} from './autoNavigation';
import type { AutoNavigationStrategyId } from './autoNavigation';
import type { AutoNavigationState } from '../../state/state';

// Harbour approaches unavoidably clip a little coast, so segments whose
// endpoints fall within this radius of the start/target are exempt from the
// land-crossing check. Matches the segment-clearance exemption used elsewhere.
const SEGMENT_ENDPOINT_EXEMPT_RADIUS = 48;

const DEFAULT_FOLLOW_MAX_STEPS = 40000;
const DEFAULT_FOLLOW_STAGNANT_LIMIT = 30;
const DEFAULT_FOLLOW_SPEED = 0.5;

export type SeaPredicate = (position: Position) => boolean;

export interface RouteEndpoint {
  id: string;
  name: string;
  position: Position;
}

export type RouteFailureKind =
  | 'planning-error'
  | 'no-path'
  | 'waypoint-on-land'
  | 'mid-route-land-crossing'
  | 'follow-stuck'
  | 'follow-no-heading'
  | 'follow-timeout';

export interface RouteFailure {
  kind: RouteFailureKind;
  detail: string;
  position?: Position;
}

export type FollowStatus =
  | 'arrived'
  | 'stuck'
  | 'no-heading'
  | 'timeout'
  | 'skipped';

export interface FollowResult {
  status: FollowStatus;
  steps: number;
  position: Position;
  waypointIndex?: number;
  waypoint?: Position;
}

export interface RouteAuditResult {
  from: RouteEndpoint;
  to: RouteEndpoint;
  strategyId: AutoNavigationStrategyId;
  ok: boolean;
  pathLength: number;
  failures: RouteFailure[];
  follow?: FollowResult;
}

export interface AuditReport {
  generatedAt: string;
  strategyId: AutoNavigationStrategyId;
  simulated: boolean;
  totalRoutes: number;
  passed: number;
  failed: number;
  failuresByKind: Record<string, number>;
  results: RouteAuditResult[];
}

const worldDistance = (from: Position, to: Position) => {
  const x = getFromToAccountingForWrapAround(from.x, to.x);
  const y = to.y - from.y;

  return Math.sqrt(x * x + y * y);
};

/*
  Returns every waypoint whose 2x2 ship footprint is not fully navigable sea.
  A planner that emits a waypoint on land is producing a path the follower can
  never legally stand on.
*/
export const findWaypointsOnLand = (
  path: Position[],
  isSea: SeaPredicate = isWorldSea,
): Position[] => path.filter((waypoint) => !isSea(waypoint));

/*
  Returns the segments (previous -> point) that cross land somewhere between
  their endpoints, ignoring segments anchored at the start/target (harbour
  approaches legitimately clip coast). Mirrors the sampling used by the existing
  regression test's countMidRouteLandCrossings helper.
*/
export const findMidRouteLandCrossings = (
  path: Position[],
  start: Position,
  target: Position,
  isSea: SeaPredicate = isWorldSea,
): { from: Position; to: Position; at: Position }[] => {
  const nearEndpoint = (point: Position) =>
    worldDistance(point, start) <= SEGMENT_ENDPOINT_EXEMPT_RADIUS ||
    worldDistance(point, target) <= SEGMENT_ENDPOINT_EXEMPT_RADIUS;

  const crossings: { from: Position; to: Position; at: Position }[] = [];
  let previous = start;

  path.forEach((point) => {
    const xDelta = getFromToAccountingForWrapAround(previous.x, point.x);
    const yDelta = point.y - previous.y;
    const steps = Math.max(Math.abs(xDelta), Math.abs(yDelta), 1);

    if (!nearEndpoint(previous) && !nearEndpoint(point)) {
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const at = {
          x: getXWrapAround(previous.x + xDelta * t),
          y: previous.y + yDelta * t,
        };

        if (!isSea(at)) {
          crossings.push({ from: previous, to: point, at });
          break;
        }
      }
    }

    previous = point;
  });

  return crossings;
};

interface FollowOptions {
  maxSteps?: number;
  stagnantLimit?: number;
  speed?: number;
}

/*
  Replays the real waypoint follower against the real world collision model
  (createMap world-mode collisionAt), reproducing worldPlayer.move's
  horizontal-then-vertical diagonal sliding. Returns whether the ship reaches
  the target, wedges, or runs out of steps. This is the expensive check, so the
  audit only runs it when explicitly asked.
*/
export const simulateFollow = (
  start: Position,
  target: Position,
  path: Position[],
  strategyId: AutoNavigationStrategyId,
  collisionAt: SeaPredicate,
  { maxSteps, stagnantLimit, speed }: FollowOptions = {},
): FollowResult => {
  const stepSpeed = speed ?? DEFAULT_FOLLOW_SPEED;
  const stepLimit = maxSteps ?? DEFAULT_FOLLOW_MAX_STEPS;
  const stuckThreshold = stagnantLimit ?? DEFAULT_FOLLOW_STAGNANT_LIMIT;

  const move = (position: Position, direction: Direction) => {
    const { xDelta, yDelta } = directionToChanges[direction];
    const isDiagonal = Math.abs(xDelta) > 0 && Math.abs(yDelta) > 0;
    const multiplier = stepSpeed / (isDiagonal ? Math.SQRT2 : 1);

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

  const autoNavigation: AutoNavigationState = {
    enabled: true,
    targetPortId: '0',
    targetPosition: target,
    strategyId,
    path,
    waypointIndex: 0,
    lastPosition: null,
    stagnantMoves: 0,
    useAlternateAxis: false,
    debug: null,
  };

  let position = start;
  let stagnantMoves = 0;

  for (let i = 0; i < stepLimit; i += 1) {
    const {
      heading,
      waypointIndex,
      arrived,
      lastPosition,
      stagnantMoves: navStagnantMoves,
      useAlternateAxis,
      newPath,
      debug,
    } = getAutoNavigationHeading(position, autoNavigation);

    autoNavigation.waypointIndex = waypointIndex;
    autoNavigation.lastPosition = lastPosition;
    autoNavigation.stagnantMoves = navStagnantMoves;
    autoNavigation.useAlternateAxis = useAlternateAxis;
    autoNavigation.debug = debug;
    if (newPath) {
      autoNavigation.path = newPath;
    }

    if (arrived) {
      return { status: 'arrived', steps: i, position };
    }

    if (!heading) {
      return { status: 'no-heading', steps: i, position, waypointIndex };
    }

    const destination = move(position, heading);
    const nextPosition = {
      x: getXWrapAround(destination.x),
      y: destination.y,
    };

    if (worldDistance(position, nextPosition) < 0.001) {
      stagnantMoves += 1;
    } else {
      stagnantMoves = 0;
    }

    if (stagnantMoves >= stuckThreshold) {
      return {
        status: 'stuck',
        steps: i,
        position,
        waypointIndex,
        waypoint: autoNavigation.path[waypointIndex],
      };
    }

    position = nextPosition;
  }

  return { status: 'timeout', steps: stepLimit, position };
};

// The real game plans with an unbounded synchronous A* (see claude-plan-v1.md
// P0-B / 2.2). Sweeping many routes that way OOMs the process on pairs that
// cannot connect at a coarse grid (the search floods the whole ocean). The
// audit therefore caps the search and, by default, plans without the coast
// penalty — connectivity and land-crossing checks do not need it, and it keeps
// the sweep fast (the coast penalty is the documented 18.7s perf cliff).
const DEFAULT_AUDIT_MAX_SEARCHED_NODES = 200000;

export interface AuditRouteOptions {
  isSea?: SeaPredicate;
  collisionAt?: SeaPredicate;
  simulate?: boolean;
  follow?: FollowOptions;
  maxSearchedNodes?: number;
  useCoastPenalty?: boolean;
}

/*
  Plans one route and runs the static checks (and optionally the follow
  simulation). Async because the `deep` strategy plans through the chunked
  search; the other strategies resolve synchronously.
*/
export const auditRoute = async (
  from: RouteEndpoint,
  to: RouteEndpoint,
  strategyId: AutoNavigationStrategyId,
  options: AuditRouteOptions = {},
): Promise<RouteAuditResult> => {
  const isSea = options.isSea ?? isWorldSea;
  const failures: RouteFailure[] = [];
  let path: Position[] = [];

  try {
    if (strategyId === 'deep') {
      const { promise } = findDeepRoutePath(
        from.position,
        to.position,
        () => {},
      );
      path = await promise;
    } else {
      path = createAutoNavigationPath(
        from.position,
        to.position,
        strategyId,
        options.maxSearchedNodes ?? DEFAULT_AUDIT_MAX_SEARCHED_NODES,
        options.useCoastPenalty ?? false,
      );
    }
  } catch (error) {
    failures.push({
      kind: 'planning-error',
      detail: error instanceof Error ? error.message : String(error),
    });

    return {
      from,
      to,
      strategyId,
      ok: false,
      pathLength: 0,
      failures,
    };
  }

  if (!path.length) {
    failures.push({ kind: 'no-path', detail: 'planner returned no route' });

    return { from, to, strategyId, ok: false, pathLength: 0, failures };
  }

  // Harbour-approach waypoints next to the start/target legitimately clip
  // coast (the chosen endpoint is a tile beside the port), so exempt them just
  // like the land-crossing check does.
  const nearEndpoint = (point: Position) =>
    worldDistance(point, from.position) <= SEGMENT_ENDPOINT_EXEMPT_RADIUS ||
    worldDistance(point, to.position) <= SEGMENT_ENDPOINT_EXEMPT_RADIUS;

  findWaypointsOnLand(path, isSea)
    .filter((waypoint) => !nearEndpoint(waypoint))
    .forEach((waypoint) => {
      failures.push({
        kind: 'waypoint-on-land',
        detail: 'waypoint footprint is not navigable sea',
        position: waypoint,
      });
    });

  findMidRouteLandCrossings(path, from.position, to.position, isSea).forEach(
    ({ from: segFrom, to: segTo, at }) => {
      failures.push({
        kind: 'mid-route-land-crossing',
        detail: `segment ${JSON.stringify(segFrom)} -> ${JSON.stringify(
          segTo,
        )} crosses land`,
        position: at,
      });
    },
  );

  let follow: FollowResult | undefined;

  if (options.simulate) {
    const collisionAt = options.collisionAt ?? createMap([0, 0]).collisionAt;
    follow = simulateFollow(
      from.position,
      to.position,
      path,
      strategyId,
      collisionAt,
      options.follow,
    );

    if (follow.status === 'stuck') {
      failures.push({
        kind: 'follow-stuck',
        detail: `wedged at step ${follow.steps}, waypoint #${follow.waypointIndex}`,
        position: follow.position,
      });
    } else if (follow.status === 'no-heading') {
      failures.push({
        kind: 'follow-no-heading',
        detail: `follower returned no heading at step ${follow.steps}`,
        position: follow.position,
      });
    } else if (follow.status === 'timeout') {
      failures.push({
        kind: 'follow-timeout',
        detail: `did not arrive within ${follow.steps} steps`,
        position: follow.position,
      });
    }
  }

  return {
    from,
    to,
    strategyId,
    ok: failures.length === 0,
    pathLength: path.length,
    failures,
    follow,
  };
};

/*
  Builds a RouteEndpoint for a port id, choosing a navigable tile adjacent to
  the port (the same approach the game uses to drop the ship outside a harbour).
  Returns null if the port has no reachable adjacent water (recorded by callers
  as a skipped endpoint rather than a route failure).
*/
export const buildPortEndpoint = (portId: string): RouteEndpoint | null => {
  let portData: ReturnType<typeof getPortData>;

  try {
    portData = getPortData(portId);
  } catch {
    return null;
  }

  const map = createMap([0, 0]);
  const offsets = [
    { x: 0, y: -2 },
    { x: 2, y: 0 },
    { x: 0, y: 2 },
    { x: -2, y: 0 },
  ];
  const position = offsets
    .map((offset) => applyPositionDelta(portData.position, offset))
    .find((candidate) => !map.collisionAt(candidate));

  if (!position) {
    return null;
  }

  return { id: portId, name: portData.name, position };
};

/* All regular + supply port ids, in id order. */
export const allPortIds = (): string[] =>
  Array.from({ length: regularPorts.length + supplyPorts.length }, (_, i) =>
    String(i + 1),
  );

/*
  Representative anchor ports spanning the major regions/choke points the
  navigator has historically struggled with. Sweeping every port against these
  anchors gives broad map coverage at a fraction of the cost of all-pairs.
*/
export const DEFAULT_ANCHOR_PORT_IDS = [
  '1', // Lisbon — Atlantic hub
  '38', // Stockholm — Baltic archipelago channel
  '70', // Mombasa — East Africa, round the Cape
  '74', // Hormuz — Persian Gulf
  '87', // Malacca — Strait of Malacca
  '96', // Macao — South China Sea
  '98', // Changan — 1-tile narrow channel
  '118', // Nome — North Pacific, high latitude
  '123', // Santa Barbara — Pacific island chain
  '51', // Jamaica — Caribbean, Panama isthmus
];

export interface AuditRoutesOptions extends AuditRouteOptions {
  strategyId?: AutoNavigationStrategyId;
  onProgress?: (done: number, total: number, result: RouteAuditResult) => void;
}

/*
  Audits a list of (from, to) endpoint pairs and aggregates the results.
*/
export const auditRoutePairs = async (
  pairs: { from: RouteEndpoint; to: RouteEndpoint }[],
  options: AuditRoutesOptions = {},
): Promise<AuditReport> => {
  const strategyId = options.strategyId ?? 'balanced';
  const results: RouteAuditResult[] = [];
  const failuresByKind: Record<string, number> = {};

  for (let i = 0; i < pairs.length; i += 1) {
    const { from, to } = pairs[i];
    // eslint-disable-next-line no-await-in-loop
    const result = await auditRoute(from, to, strategyId, options);
    results.push(result);
    result.failures.forEach((failure) => {
      failuresByKind[failure.kind] = (failuresByKind[failure.kind] || 0) + 1;
    });
    options.onProgress?.(i + 1, pairs.length, result);
  }

  const failed = results.filter((result) => !result.ok).length;

  return {
    generatedAt: new Date().toISOString(),
    strategyId,
    simulated: Boolean(options.simulate),
    totalRoutes: results.length,
    passed: results.length - failed,
    failed,
    failuresByKind,
    results,
  };
};

/*
  Builds the cross product of `originIds` x `anchorIds` (skipping self pairs and
  ports with no reachable adjacent water), then audits every pair.
*/
export const auditPortsAgainstAnchors = async (
  originIds: string[],
  anchorIds: string[],
  options: AuditRoutesOptions = {},
): Promise<{ report: AuditReport; skippedPortIds: string[] }> => {
  const skippedPortIds: string[] = [];
  const endpointCache = new Map<string, RouteEndpoint | null>();
  const endpointFor = (id: string) => {
    if (!endpointCache.has(id)) {
      const endpoint = buildPortEndpoint(id);
      endpointCache.set(id, endpoint);
      if (!endpoint) {
        skippedPortIds.push(id);
      }
    }

    return endpointCache.get(id) ?? null;
  };

  const pairs: { from: RouteEndpoint; to: RouteEndpoint }[] = [];

  originIds.forEach((originId) => {
    const from = endpointFor(originId);
    if (!from) {
      return;
    }

    anchorIds.forEach((anchorId) => {
      if (originId === anchorId) {
        return;
      }

      const to = endpointFor(anchorId);
      if (to) {
        pairs.push({ from, to });
      }
    });
  });

  const report = await auditRoutePairs(pairs, options);

  return { report, skippedPortIds };
};

const formatPosition = (position?: Position) =>
  position ? `(${Math.round(position.x)}, ${Math.round(position.y)})` : '';

/*
  Renders a human-readable Markdown report: a summary table plus one section
  per failing route with its individual failures.
*/
export const formatReportMarkdown = (
  report: AuditReport,
  skippedPortIds: string[] = [],
): string => {
  const lines: string[] = [];

  lines.push('# Navigation Audit Report');
  lines.push('');
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Strategy: \`${report.strategyId}\``);
  lines.push(`- Follow simulation: ${report.simulated ? 'on' : 'off'}`);
  lines.push(
    `- Routes: ${report.totalRoutes} · Passed: ${report.passed} · Failed: ${report.failed}`,
  );
  if (skippedPortIds.length) {
    lines.push(
      `- Skipped ports (no adjacent water): ${skippedPortIds.join(', ')}`,
    );
  }
  lines.push('');

  lines.push('## Failures by kind');
  lines.push('');
  const kinds = Object.keys(report.failuresByKind);
  if (!kinds.length) {
    lines.push('None — all audited routes passed. 🎉');
  } else {
    lines.push('| Kind | Count |');
    lines.push('|---|---|');
    kinds
      .sort((a, b) => report.failuresByKind[b] - report.failuresByKind[a])
      .forEach((kind) => {
        lines.push(`| ${kind} | ${report.failuresByKind[kind]} |`);
      });
  }
  lines.push('');

  const failing = report.results.filter((result) => !result.ok);
  if (failing.length) {
    lines.push('## Failing routes');
    lines.push('');
    failing.forEach((result) => {
      lines.push(
        `### ${result.from.name} (${result.from.id}) → ${result.to.name} (${result.to.id})`,
      );
      lines.push('');
      lines.push(
        `- from ${formatPosition(result.from.position)} to ${formatPosition(
          result.to.position,
        )} · path length ${result.pathLength}`,
      );
      if (result.follow) {
        lines.push(
          `- follow: ${result.follow.status} after ${
            result.follow.steps
          } steps at ${formatPosition(result.follow.position)}`,
        );
      }
      result.failures.forEach((failure) => {
        lines.push(
          `- **${failure.kind}**: ${failure.detail}${
            failure.position ? ` @ ${formatPosition(failure.position)}` : ''
          }`,
        );
      });
      lines.push('');
    });
  }

  return lines.join('\n');
};

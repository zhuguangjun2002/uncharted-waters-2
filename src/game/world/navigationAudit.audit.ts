/*
  Runner for the batch navigation audit (see navigationAudit.ts).

  This is executed via `npm run audit:navigation`, which points jest at the
  separate jest.audit.config.js (matching *.audit.ts, not *.test.ts) so the
  sweep never runs as part of the normal `npm test`. It loads the real world
  tilemap, runs the audit, writes a Markdown + JSON report to the repo root, and
  prints a summary. It is a reporting tool, so it passes as long as it manages
  to audit at least one route — surfaced failures live in the report, ready to
  be triaged into focused regression tests.

  Configuration via environment variables:
    AUDIT_STRATEGY   balanced | detailed | offshore | deep   (default balanced)
    AUDIT_SIMULATE   1 to also replay the follower (slow)     (default off)
    AUDIT_FULL       1 for all-pairs (every port x every port; very slow)
    AUDIT_ANCHORS    comma-separated port ids to use as anchors (overrides default)
    AUDIT_ORIGINS    comma-separated port ids to use as origins (overrides all)
    AUDIT_LIMIT      cap the number of origin ports (quick smoke run)
    AUDIT_MAX_NODES  per-grid A* node budget (default 200000)
    AUDIT_COAST      1 to plan with the coast penalty (slower; default off)
    AUDIT_OUT        output path for the Markdown report (default repo root)
*/

import fs from 'fs';
import path from 'path';

import Assets from '../../assets';
import {
  DEFAULT_ANCHOR_PORT_IDS,
  allPortIds,
  auditPortsAgainstAnchors,
  formatReportMarkdown,
} from './navigationAudit';
import type { AuditReport } from './navigationAudit';
import type { AutoNavigationStrategyId } from './autoNavigation';

const { env } = process;
const strategyId = (env.AUDIT_STRATEGY ||
  'balanced') as AutoNavigationStrategyId;
const simulate = env.AUDIT_SIMULATE === '1';
const full = env.AUDIT_FULL === '1';
const parseIds = (value?: string) =>
  value
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

const writeReport = (report: AuditReport, skippedPortIds: string[]) => {
  const mdOut = env.AUDIT_OUT
    ? path.resolve(env.AUDIT_OUT)
    : path.resolve('navigation-audit-report.md');
  const jsonOut = mdOut.replace(/\.md$/, '.json');

  fs.writeFileSync(mdOut, formatReportMarkdown(report, skippedPortIds));
  fs.writeFileSync(
    jsonOut,
    JSON.stringify({ ...report, skippedPortIds }, null, 2),
  );

  // eslint-disable-next-line no-console
  console.log(`\nReport written to ${mdOut} and ${jsonOut}`);
};

describe('navigation audit', () => {
  const worldTilemap = new Uint8Array(
    fs.readFileSync('src/data/assets/worldTilemap.wasm'),
  );

  beforeEach(() => {
    jest.spyOn(Assets, 'data').mockReturnValue(worldTilemap);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Deep planning / follow simulation over many pairs can take a long time.
  const timeout =
    simulate || strategyId === 'deep' ? 30 * 60 * 1000 : 10 * 60 * 1000;

  test(
    `sweeps routes with the ${strategyId} strategy`,
    async () => {
      const everyPort = allPortIds();
      const origins = parseIds(env.AUDIT_ORIGINS) ?? everyPort;
      const limitedOrigins = env.AUDIT_LIMIT
        ? origins.slice(0, Number(env.AUDIT_LIMIT))
        : origins;
      const anchors =
        parseIds(env.AUDIT_ANCHORS) ??
        (full ? everyPort : DEFAULT_ANCHOR_PORT_IDS);

      let lastLogged = Date.now();
      const { report, skippedPortIds } = await auditPortsAgainstAnchors(
        limitedOrigins,
        anchors,
        {
          strategyId,
          simulate,
          maxSearchedNodes: env.AUDIT_MAX_NODES
            ? Number(env.AUDIT_MAX_NODES)
            : undefined,
          useCoastPenalty: env.AUDIT_COAST === '1',
          onProgress: (done, total, result) => {
            // Throttle progress logging and always announce a fresh failure.
            if (!result.ok) {
              // eslint-disable-next-line no-console
              console.log(
                `  ✗ ${result.from.name} → ${result.to.name}: ${result.failures
                  .map((failure) => failure.kind)
                  .join(', ')}`,
              );
            }
            if (Date.now() - lastLogged > 5000) {
              lastLogged = Date.now();
              // eslint-disable-next-line no-console
              console.log(`  …audited ${done}/${total} routes`);
            }
          },
        },
      );

      writeReport(report, skippedPortIds);

      // eslint-disable-next-line no-console
      console.log(
        `\nNavigation audit (${strategyId}): ${report.passed}/${report.totalRoutes} passed, ${report.failed} failed.`,
      );
      if (report.failed) {
        // eslint-disable-next-line no-console
        console.log('Failures by kind:', report.failuresByKind);
      }

      expect(report.totalRoutes).toBeGreaterThan(0);
    },
    timeout,
  );
});

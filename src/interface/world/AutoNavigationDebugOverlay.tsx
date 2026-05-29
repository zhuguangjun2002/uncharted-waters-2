import React from 'react';

import { TILE_SIZE } from '../../constants';
import {
  getFromToAccountingForWrapAround,
  getXWrapAround,
} from '../../game/world/sharedUtils';
import type { AutoNavigationState } from '../../state/state';
import type { Position } from '../../types';

const CAMERA_WIDTH_TILES = 40;
const CAMERA_HEIGHT_TILES = 25;
const CAMERA_WIDTH = CAMERA_WIDTH_TILES * TILE_SIZE;
const CAMERA_HEIGHT = CAMERA_HEIGHT_TILES * TILE_SIZE;
const PLAYER_SIZE_TILES = 2;
const WORLD_MAP_ROWS = 1080;

interface Props {
  position: Position;
  autoNavigation: AutoNavigationState;
}

type AutoNavigationDebugReason = NonNullable<
  AutoNavigationState['debug']
>['reason'];

const DEBUG_REASON_LABELS: Record<AutoNavigationDebugReason, string> = {
  tracking: '追踪中',
  arrived: '已到达',
  'stagnant-alternate-axis': '单轴脱困',
  'coastal-axis-switch': '近岸切轴',
  'deep-detour-created': 'A* 绕行已插入',
  'deep-detour-failed': 'A* 绕行失败',
  'deep-detour-target-too-close': '绕行目标过近',
  'deep-stagnant-skip': '跳过航点',
};

const formatPosition = (position: Position | null) =>
  position ? `${Math.round(position.x)}, ${Math.round(position.y)}` : '无';

const formatDistance = (distance: number | null) =>
  distance === null ? '无' : distance.toFixed(1);

const getCameraPosition = ({ x, y }: Position) => ({
  x: getXWrapAround(x + PLAYER_SIZE_TILES / 2 - CAMERA_WIDTH_TILES / 2),
  y: Math.min(
    WORLD_MAP_ROWS - CAMERA_HEIGHT_TILES,
    Math.max(0, y + PLAYER_SIZE_TILES / 2 - CAMERA_HEIGHT_TILES / 2),
  ),
});

const getScreenPosition = (
  playerPosition: Position,
  waypoint: Position | null,
) => {
  if (!waypoint) {
    return null;
  }

  const camera = getCameraPosition(playerPosition);
  const x = getFromToAccountingForWrapAround(camera.x, waypoint.x) * TILE_SIZE;
  const y = (waypoint.y - camera.y) * TILE_SIZE;
  const margin = TILE_SIZE;

  if (
    x < -margin ||
    x > CAMERA_WIDTH + margin ||
    y < -margin ||
    y > CAMERA_HEIGHT + margin
  ) {
    return null;
  }

  return { x, y };
};

export default function AutoNavigationDebugOverlay({
  position,
  autoNavigation,
}: Props) {
  const { debug } = autoNavigation;

  if (!autoNavigation.enabled || !debug) {
    return null;
  }

  const shouldShow =
    autoNavigation.stagnantMoves > 0 || debug.reason !== 'tracking';

  if (!shouldShow) {
    return null;
  }

  const screenPosition = getScreenPosition(position, debug.waypoint);

  return (
    <>
      {screenPosition && (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            left: screenPosition.x - 6,
            top: screenPosition.y - 6,
          }}
        >
          <div className="h-3 w-3 border-2 border-rose-400 bg-black/70" />
          <div className="mt-1 whitespace-nowrap bg-black/80 px-1 text-xs text-rose-200">
            WP {debug.waypointIndex + 1}
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[560px] border border-amber-500 bg-black/80 px-3 py-2 text-xs leading-5 text-amber-100">
        <div>
          自动导航诊断：{DEBUG_REASON_LABELS[debug.reason]} · {debug.message}
        </div>
        <div>
          目标 WP {debug.waypointIndex + 1}/{debug.waypointCount} @{' '}
          {formatPosition(debug.waypoint)} · 距离{' '}
          {formatDistance(debug.distanceToWaypoint)} / 判定{' '}
          {formatDistance(debug.reachedDistance)} px · 航向{' '}
          {debug.heading || '无'}
        </div>
        <div>
          停滞 {autoNavigation.stagnantMoves} · 当前{' '}
          {formatPosition(debug.position)}
          {debug.detourTarget && (
            <>
              {' '}
              · A* 目标 WP {(debug.detourTargetIndex ?? 0) + 1} @{' '}
              {formatPosition(debug.detourTarget)} · 新增{' '}
              {debug.detourPathLength ?? 0} 点
            </>
          )}
        </div>
      </div>
    </>
  );
}

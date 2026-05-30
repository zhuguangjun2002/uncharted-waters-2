/* eslint-disable no-param-reassign */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import Assets from '../../assets';
import { DEBUG, WORLD_MAP_COLUMNS } from '../../constants';
import { regularPorts, supplyPorts } from '../../data/portData';
import {
  cancelAutoNavigation,
  startAutoNavigation,
  teleportToPort,
  teleportToSea,
} from '../../state/actionsWorld';
import { latLngToWorld, worldToLatLng } from '../../game/world/geo';
import type { AutoNavigationState } from '../../state/state';
import type { Position } from '../../types';
import {
  AUTO_NAVIGATION_STRATEGIES,
  DEFAULT_AUTO_NAVIGATION_STRATEGY_ID,
  createAutoNavigationPaths,
  findDeepRoutePath,
  type AutoNavigationStrategyId,
  type DeepRouteHandle,
} from '../../game/world/autoNavigation';
import { positionAdjacentToPort } from '../../state/selectors';

const MAP_WIDTH = 720;
const MAP_HEIGHT = 360;
const WORLD_MAP_ROWS = 1080;
const NEAR_PREVIEW_DISTANCE = 160;
const MEDIUM_PREVIEW_DISTANCE = 260;
const NEAR_PREVIEW_MAX_SEARCHED_GRID_NODES = 3000;
const MEDIUM_PREVIEW_MAX_SEARCHED_GRID_NODES = 1200;
const FAR_PREVIEW_MAX_SEARCHED_GRID_NODES = 400;
const VISIBLE_PORT_COUNT = 6;

interface Props {
  position: Position;
  autoNavigation: AutoNavigationState;
}

type PreviewStatus = 'dirty' | 'calculating' | 'ready' | 'failed';
type DeepRouteStatus = 'idle' | 'computing' | 'ready' | 'failed';
type PreviewPaths = Partial<Record<AutoNavigationStrategyId, Position[]>>;

const STRATEGY_COLORS: Record<AutoNavigationStrategyId, string> = {
  balanced: '#38bdf8',
  detailed: '#f97316',
  offshore: '#a78bfa',
  deep: '#4ade80',
};

const NAVIGABLE_STRATEGIES = AUTO_NAVIGATION_STRATEGIES.filter(
  ({ id }) => id !== 'deep',
);

const portOptions = regularPorts
  .map(({ name }, i) => ({
    id: String(i + 1),
    name,
  }))
  .concat(
    supplyPorts.map(({ name }, i) => ({
      id: String(regularPorts.length + i + 1),
      name,
    })),
  );

// The tileset packs every world tile value across its columns (one tile per
// 8-bit value), with each row a time-of-day variant; row 0 is midday.
const TILE_VALUE_COUNT = 128;
const DAYTIME_TILESET_ROW = 0;

// Average midday colour of each tile value, sampled straight from the tileset.
// Driving the minimap off the real tile colours makes it a faithful low-res map
// (ice white, desert tan, forest green, sea blue) instead of guessing land vs
// sea — and vs ice — from tile-value ranges, which mis-painted temperate land
// (e.g. southern Australia) as ice. Built once and cached.
let tilePalette: number[][] | null = null;

const buildTilePalette = (): number[][] | null => {
  const tileset = Assets.images('worldTileset');

  if (!tileset) {
    return null;
  }

  try {
    const tileSize = Math.floor(tileset.width / TILE_VALUE_COUNT);
    const context = tileset.getContext('2d')!;
    const { data } = context.getImageData(
      0,
      DAYTIME_TILESET_ROW * tileSize,
      tileset.width,
      tileSize,
    );
    const palette: number[][] = [];

    for (let tile = 0; tile < TILE_VALUE_COUNT; tile += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      const pixelCount = tileSize * tileSize;

      for (let yOffset = 0; yOffset < tileSize; yOffset += 1) {
        for (let xOffset = 0; xOffset < tileSize; xOffset += 1) {
          const offset =
            (yOffset * tileset.width + tile * tileSize + xOffset) * 4;

          r += data[offset];
          g += data[offset + 1];
          b += data[offset + 2];
        }
      }

      palette[tile] = [
        Math.round(r / pixelCount),
        Math.round(g / pixelCount),
        Math.round(b / pixelCount),
      ];
    }

    return palette;
  } catch {
    // getImageData can throw on a tainted canvas; fall back to flat colours.
    return null;
  }
};

const getTilePalette = (): number[][] | null => {
  if (!tilePalette) {
    tilePalette = buildTilePalette();
  }

  return tilePalette;
};

const toMapPosition = ({ x, y }: Position) => ({
  x: Math.floor((x / WORLD_MAP_COLUMNS) * MAP_WIDTH),
  y: Math.floor((y / WORLD_MAP_ROWS) * MAP_HEIGHT),
});

const getPreviewSearchBudget = (from: Position, to: Position) => {
  const rawX = Math.abs(to.x - from.x);
  const x = Math.min(rawX, WORLD_MAP_COLUMNS - rawX);
  const y = to.y - from.y;
  const distance = Math.sqrt(x * x + y * y);

  if (distance <= NEAR_PREVIEW_DISTANCE) {
    return NEAR_PREVIEW_MAX_SEARCHED_GRID_NODES;
  }

  if (distance <= MEDIUM_PREVIEW_DISTANCE) {
    return MEDIUM_PREVIEW_MAX_SEARCHED_GRID_NODES;
  }

  return FAR_PREVIEW_MAX_SEARCHED_GRID_NODES;
};

const drawBaseMap = (context: CanvasRenderingContext2D) => {
  const imageData = context.createImageData(MAP_WIDTH, MAP_HEIGHT);
  const worldTilemap = Assets.data('worldTilemap');
  const palette = getTilePalette();

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const worldX = Math.floor((x / MAP_WIDTH) * WORLD_MAP_COLUMNS);
      const worldY = Math.floor((y / MAP_HEIGHT) * WORLD_MAP_ROWS);
      const tile = worldTilemap[worldY * WORLD_MAP_COLUMNS + worldX] || 0;
      const offset = (y * MAP_WIDTH + x) * 4;
      const color = palette?.[tile];

      if (color) {
        const [r, g, b] = color;

        imageData.data[offset] = r;
        imageData.data[offset + 1] = g;
        imageData.data[offset + 2] = b;
      } else if (tile >= 50) {
        // Fallback when the tileset can't be sampled: flat land green.
        imageData.data[offset] = 34;
        imageData.data[offset + 1] = 90;
        imageData.data[offset + 2] = 64;
      } else {
        imageData.data[offset] = 17;
        imageData.data[offset + 1] = 78;
        imageData.data[offset + 2] = 134;
      }

      imageData.data[offset + 3] = 255;
    }
  }

  context.putImageData(imageData, 0, 0);
};

const drawPosition = (
  context: CanvasRenderingContext2D,
  position: Position,
) => {
  const { x: markerX, y: markerY } = toMapPosition(position);

  context.fillStyle = '#fef08a';
  context.fillRect(markerX - 2, markerY - 2, 5, 5);
  context.fillStyle = '#ef4444';
  context.fillRect(markerX - 1, markerY - 1, 3, 3);
};

const drawPath = (
  context: CanvasRenderingContext2D,
  path: Position[],
  targetPosition: Position | null,
  color: string,
  lineWidth: number,
) => {
  if (!path.length) {
    return;
  }

  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();

  path.forEach((pathPosition, i) => {
    const point = toMapPosition(pathPosition);

    if (i === 0) {
      context.moveTo(point.x, point.y);
      return;
    }

    const previous = toMapPosition(path[i - 1]);
    const dx = point.x - previous.x;

    // The world wraps east-west, so a map-x jump wider than half the map is
    // really a short hop across the seam (e.g. the Pacific between Alaska and
    // Siberia). Drawing it straight would streak a horizontal line back across
    // the whole map; instead draw two segments that run off opposite edges.
    if (Math.abs(dx) > MAP_WIDTH / 2) {
      const wrappedDx = dx - Math.sign(dx) * MAP_WIDTH;

      context.lineTo(previous.x + wrappedDx, point.y);
      context.moveTo(point.x - wrappedDx, previous.y);
      context.lineTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });

  context.stroke();

  if (!targetPosition) {
    return;
  }

  const { x, y } = toMapPosition(targetPosition);
  context.fillStyle = color;
  context.fillRect(x - 2, y - 2, 5, 5);
};

const drawAutoNavigation = (
  context: CanvasRenderingContext2D,
  { path, waypointIndex, targetPosition }: AutoNavigationState,
) => {
  drawPath(context, path.slice(waypointIndex), targetPosition, '#facc15', 2);
};

const drawDebugPoint = (
  context: CanvasRenderingContext2D,
  position: Position,
  color: string,
) => {
  const { x, y } = toMapPosition(position);

  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(x - 3, y - 3, 7, 7);
  context.fillStyle = color;
  context.fillRect(x - 1, y - 1, 3, 3);
};

const drawAutoNavigationDebug = (
  context: CanvasRenderingContext2D,
  { debug }: AutoNavigationState,
) => {
  if (!debug) {
    return;
  }

  if (debug.waypoint) {
    drawDebugPoint(context, debug.waypoint, '#fb7185');
  }

  if (debug.detourTarget) {
    drawDebugPoint(context, debug.detourTarget, '#f97316');
  }
};

const getAutoNavigationProgress = ({
  enabled,
  path,
  waypointIndex,
}: AutoNavigationState) => {
  if (!enabled || !path.length) {
    return 0;
  }

  return Math.min(100, Math.floor((waypointIndex / path.length) * 100));
};

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

const formatDebugPosition = (position: Position | null) =>
  position ? `${Math.round(position.x)}, ${Math.round(position.y)}` : '无';

const formatDebugDistance = (distance: number | null) =>
  distance === null ? '无' : distance.toFixed(1);

const formatSeaState = (isSea: boolean | null, isOpenSea: boolean | null) => {
  if (isSea === null || isOpenSea === null) {
    return '未知';
  }

  if (!isSea) {
    return '陆地/碰撞';
  }

  return isOpenSea ? '开阔海面' : '近岸海面';
};

const getDeepRouteButtonClassName = (deepRouteStatus: DeepRouteStatus) => {
  if (deepRouteStatus === 'computing') {
    return 'border-lime-700 text-lime-400 hover:bg-slate-800';
  }

  if (deepRouteStatus === 'ready') {
    return 'border-lime-500 text-lime-300 hover:bg-slate-800';
  }

  return 'border-slate-500 hover:bg-slate-800';
};

const getDeepRouteButtonLabel = (deepRouteStatus: DeepRouteStatus) => {
  if (deepRouteStatus === 'computing') {
    return '搜索中...';
  }

  if (deepRouteStatus === 'ready') {
    return '重新深度搜索';
  }

  return '深度搜索';
};

export default function WorldMap({ position, autoNavigation }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseMapRef = useRef<HTMLCanvasElement>();
  const [selectedPortId, setSelectedPortId] = useState(portOptions[0].id);
  const [selectedStrategyId, setSelectedStrategyId] =
    useState<AutoNavigationStrategyId>(DEFAULT_AUTO_NAVIGATION_STRATEGY_ID);
  const [status, setStatus] = useState('');
  const [previewPaths, setPreviewPaths] = useState<PreviewPaths>({});
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('dirty');
  const [deepRouteStatus, setDeepRouteStatus] =
    useState<DeepRouteStatus>('idle');
  const [deepRoutePath, setDeepRoutePath] = useState<Position[]>([]);
  const [deepRouteNodes, setDeepRouteNodes] = useState(0);
  const deepRouteHandleRef = useRef<DeepRouteHandle | null>(null);
  const [portFilter, setPortFilter] = useState('');
  const visiblePortOptions = useMemo(() => {
    const query = portFilter.trim().toLowerCase();

    if (!query) {
      return portOptions;
    }

    return portOptions.filter(
      ({ id, name }) =>
        name.toLowerCase().includes(query) || id.includes(query),
    );
  }, [portFilter]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const previewTargetPosition = useMemo(
    () => positionAdjacentToPort(selectedPortId),
    [selectedPortId],
  );
  const [clickTeleport, setClickTeleport] = useState(false);
  const [dockHere, setDockHere] = useState(false);
  const [xyInput, setXyInput] = useState('');
  const [latLngInput, setLatLngInput] = useState('');

  useEffect(() => {
    if (!baseMapRef.current) {
      baseMapRef.current = document.createElement('canvas');
      baseMapRef.current.width = MAP_WIDTH;
      baseMapRef.current.height = MAP_HEIGHT;
      drawBaseMap(baseMapRef.current.getContext('2d')!);
    }

    const context = canvasRef.current!.getContext('2d')!;
    context.drawImage(baseMapRef.current, 0, 0);
    NAVIGABLE_STRATEGIES.forEach(({ id }) => {
      drawPath(
        context,
        previewPaths[id] || [],
        previewTargetPosition,
        STRATEGY_COLORS[id],
        id === selectedStrategyId ? 2 : 1,
      );
    });
    if (deepRoutePath.length) {
      drawPath(
        context,
        deepRoutePath,
        previewTargetPosition,
        STRATEGY_COLORS.deep,
        2,
      );
    }
    drawAutoNavigation(context, autoNavigation);
    drawAutoNavigationDebug(context, autoNavigation);
    drawPosition(context, position);
  }, [
    autoNavigation,
    deepRoutePath,
    position,
    previewPaths,
    previewTargetPosition,
    selectedStrategyId,
  ]);

  useEffect(() => {
    setHighlightIndex(0);
    setScrollOffset(0);
  }, [portFilter]);

  useEffect(() => {
    if (highlightIndex < scrollOffset) {
      setScrollOffset(highlightIndex);
    } else if (highlightIndex >= scrollOffset + VISIBLE_PORT_COUNT) {
      setScrollOffset(highlightIndex - VISIBLE_PORT_COUNT + 1);
    }
  }, [highlightIndex, scrollOffset]);

  const targetPort = portOptions.find(
    ({ id }) => id === autoNavigation.targetPortId,
  );
  const selectedPort = portOptions.find(({ id }) => id === selectedPortId)!;
  const selectedStrategy = AUTO_NAVIGATION_STRATEGIES.find(
    ({ id }) => id === selectedStrategyId,
  )!;
  const activeStrategy = AUTO_NAVIGATION_STRATEGIES.find(
    ({ id }) => id === autoNavigation.strategyId,
  );
  const progress = getAutoNavigationProgress(autoNavigation);
  const completedWaypoints = Math.min(
    autoNavigation.waypointIndex,
    autoNavigation.path.length,
  );
  const activeWaypoint = Math.min(
    autoNavigation.waypointIndex + 1,
    autoNavigation.path.length,
  );
  const remainingWaypoints = Math.max(
    0,
    autoNavigation.path.length - completedWaypoints,
  );
  const autoNavigationDebug = autoNavigation.debug;

  const handleSelectionChange = () => {
    setPreviewPaths({});
    setPreviewStatus('dirty');
    deepRouteHandleRef.current?.abort();
    deepRouteHandleRef.current = null;
    setDeepRouteStatus('idle');
    setDeepRoutePath([]);
    setDeepRouteNodes(0);
    setStatus('已更改目标，请点击”预览航线”重新计算三种路线。');
  };

  const handleCancelDeepRoute = () => {
    deepRouteHandleRef.current?.abort();
    deepRouteHandleRef.current = null;
    setDeepRouteStatus('idle');
    setDeepRoutePath([]);
    setDeepRouteNodes(0);
    setStatus('已取消深度搜索。');
  };

  const handleDeepRoute = () => {
    deepRouteHandleRef.current?.abort();
    setDeepRouteStatus('computing');
    setDeepRoutePath([]);
    setDeepRouteNodes(0);
    setStatus(`正在深度搜索至 ${selectedPort.name} 的航线，请稍候...`);

    let finalNodes = 0;

    const handle = findDeepRoutePath(
      position,
      previewTargetPosition,
      (nodesSearched) => {
        finalNodes = nodesSearched;
        setDeepRouteNodes(nodesSearched);
        setStatus(
          `深度搜索中... 已探索 ${nodesSearched.toLocaleString()} 个节点`,
        );
      },
    );

    deepRouteHandleRef.current = handle;

    handle.promise.then((path) => {
      if (deepRouteHandleRef.current !== handle) {
        return;
      }

      deepRouteHandleRef.current = null;

      if (path.length) {
        setDeepRoutePath(path);
        setDeepRouteNodes(finalNodes);
        setDeepRouteStatus('ready');
        setStatus(
          `深度搜索完成：找到 ${
            selectedPort.name
          } 的航线（共探索 ${finalNodes.toLocaleString()} 个节点）。`,
        );
      } else {
        setDeepRouteStatus('failed');
        setStatus(`深度搜索失败：无法找到到 ${selectedPort.name} 的海上路线。`);
      }
    });
  };

  const commitPortAt = (index: number) => {
    const port = visiblePortOptions[index];

    if (!port || port.id === selectedPortId) {
      return;
    }

    setSelectedPortId(port.id);
    handleSelectionChange();
  };

  const handlePortFilterKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) =>
        Math.min(Math.max(0, visiblePortOptions.length - 1), i + 1),
      );
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      commitPortAt(highlightIndex);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setPortFilter('');
    }
  };

  const handlePreviewPath = () => {
    setPreviewPaths({});
    setPreviewStatus('calculating');
    setStatus(`正在计算到 ${selectedPort.name} 的三种自动导航路线...`);

    window.setTimeout(() => {
      const paths = createAutoNavigationPaths(
        position,
        previewTargetPosition,
        NAVIGABLE_STRATEGIES.map(({ id }) => id),
        getPreviewSearchBudget(position, previewTargetPosition),
      );
      const availableStrategies = NAVIGABLE_STRATEGIES.filter(
        ({ id }) => (paths[id] || []).length,
      );

      setPreviewPaths(paths);
      setPreviewStatus(availableStrategies.length ? 'ready' : 'failed');
      setStatus(
        availableStrategies.length
          ? `预览完成：${selectedPort.name}，找到 ${availableStrategies.length} 条可用路线。`
          : `三种算法都无法规划到 ${selectedPort.name} 的海上航线。`,
      );
    }, 50);
  };

  const handleStartAutoNavigation = () => {
    const isDeepReady = deepRouteStatus === 'ready' && deepRoutePath.length > 0;
    const selectedPath = previewPaths[selectedStrategyId] || [];
    const canStart =
      isDeepReady || (previewStatus === 'ready' && selectedPath.length > 0);

    if (!canStart) {
      setStatus(
        '请先点击”预览航线”，选择一条有颜色路线的算法；或使用”深度搜索”规划超远距离航线。',
      );
      return;
    }

    if (isDeepReady) {
      const result = startAutoNavigation(
        selectedPortId,
        position,
        'deep',
        deepRoutePath,
      );

      if (result === 'started') {
        setStatus(
          `自动导航已开始：${selectedPort.name}，超远航线。按 F4 关闭地图查看航行。`,
        );
        return;
      }

      if (result === 'already-there') {
        setStatus(`已经在 ${selectedPort.name} 附近。可按 E 靠港。`);
        return;
      }

      setStatus(`无法规划到 ${selectedPort.name} 的海上航线。`);
      return;
    }

    setStatus(
      `正在为 ${selectedPort.name} 规划安全航线（避开海岸），请稍候...`,
    );

    window.setTimeout(() => {
      const result = startAutoNavigation(
        selectedPortId,
        position,
        selectedStrategyId,
      );

      if (result === 'started') {
        setStatus(
          `自动导航已开始：${selectedPort.name}，${selectedStrategy.name}。按 F4 关闭地图查看航行。`,
        );
        return;
      }

      if (result === 'already-there') {
        setStatus(`已经在 ${selectedPort.name} 附近。可按 E 靠港。`);
        return;
      }

      setStatus(`无法规划到 ${selectedPort.name} 的海上航线。`);
    }, 50);
  };

  const announceTeleport = (target: Position) => {
    const { lat, lng } = worldToLatLng(target);
    setStatus(
      `已传送到 x=${target.x}, y=${target.y}（约 ${lat.toFixed(1)}°, ${lng.toFixed(
        1,
      )}°）。`,
    );
  };

  const parsePair = (value: string): [number, number] | null => {
    const parts = value.split(/[,\s]+/).map(Number);

    if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) {
      return null;
    }

    return [parts[0], parts[1]];
  };

  const handleTeleportXY = () => {
    const pair = parsePair(xyInput);

    if (!pair) {
      setStatus('请输入合法的 x,y（例如 840,358）。');
      return;
    }

    announceTeleport(teleportToSea({ x: pair[0], y: pair[1] }));
  };

  const handleTeleportLatLng = () => {
    const pair = parsePair(latLngInput);

    if (!pair) {
      setStatus('请输入合法的 纬度,经度（例如 38.7,-9.1）。');
      return;
    }

    announceTeleport(teleportToSea(latLngToWorld(pair[0], pair[1])));
  };

  const handleTeleportToPort = () => {
    const target = teleportToPort(selectedPortId, dockHere);
    setStatus(
      dockHere
        ? `已直接靠港：${selectedPort.name}。`
        : `已传送到 ${selectedPort.name} 附近海域（x=${target.x}, y=${target.y}）。`,
    );
  };

  const handleMapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!clickTeleport) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * WORLD_MAP_COLUMNS);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * WORLD_MAP_ROWS);

    announceTeleport(teleportToSea({ x, y }));
  };

  const currentLatLng = worldToLatLng(position);

  return (
    // items-start + overflow so a panel taller than the viewport scrolls instead
    // of centring — centring clipped the top of the map (the Arctic / northern
    // Canada) off-screen, worst during auto-navigation when the extra progress
    // panel makes the overlay tallest.
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/80 p-4">
      <div className="border-4 border-slate-300 bg-black p-4 text-slate-200">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          // Cap to the viewport (preserving the 2:1 aspect) so the whole map
          // stays visible on short or narrow screens.
          className={`block aspect-[2/1] h-auto w-[1080px] max-w-[92vw] ${
            clickTeleport ? 'cursor-crosshair' : ''
          }`}
          onClick={handleMapClick}
        />
        <div className="mt-3 flex items-center gap-3 text-xl">
          <div className="w-36">F4 世界地图</div>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="flex-1 bg-slate-900 border border-slate-500 px-2 py-1 text-base"
            type="text"
            value={portFilter}
            onChange={(e) => setPortFilter(e.target.value)}
            onKeyDown={handlePortFilterKeyDown}
            placeholder={`搜索港口（当前：${selectedPort.id}. ${selectedPort.name}）`}
          />
          <select
            className="w-40 bg-slate-900 border border-slate-500 px-2 py-1 text-base"
            value={selectedStrategyId}
            onChange={(e) => {
              setSelectedStrategyId(e.target.value as AutoNavigationStrategyId);
              setStatus('已切换实际运行算法；地图上的三种预览路线保持不变。');
            }}
          >
            {NAVIGABLE_STRATEGIES.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button
            className="border border-slate-500 px-3 py-1 text-base hover:bg-slate-800 disabled:text-slate-500"
            disabled={previewStatus === 'calculating'}
            type="button"
            onClick={handlePreviewPath}
          >
            {previewStatus === 'calculating' ? '计算中' : '预览航线'}
          </button>
          {/* Always offer the deep search: a coarse preview can "succeed" yet
              still route the greedy follower into an island bay it can't back
              out of (e.g. Nome -> Santa Barbara through the Pacific chain). The
              deep route's tile-dense path and local A* detour thread those, so
              the player needs access to it even when a preview line exists. */}
          <button
            className={`border px-3 py-1 text-base disabled:text-slate-500 ${getDeepRouteButtonClassName(
              deepRouteStatus,
            )}`}
            disabled={deepRouteStatus === 'computing'}
            type="button"
            onClick={
              deepRouteStatus === 'computing'
                ? handleCancelDeepRoute
                : handleDeepRoute
            }
          >
            {getDeepRouteButtonLabel(deepRouteStatus)}
          </button>
          <button
            className="border border-slate-500 px-3 py-1 text-base hover:bg-slate-800"
            type="button"
            onClick={handleStartAutoNavigation}
          >
            自动导航
          </button>
          <button
            className="border border-slate-500 px-3 py-1 text-base hover:bg-slate-800 disabled:text-slate-500"
            disabled={!autoNavigation.enabled}
            type="button"
            onClick={() => {
              cancelAutoNavigation();
              setStatus('自动导航已取消。');
            }}
          >
            取消
          </button>
        </div>
        {DEBUG && (
          <div className="mt-2 border border-fuchsia-700 bg-slate-950 px-3 py-2 text-sm text-fuchsia-200">
            <div className="mb-2">
              调试传送（仅开发可见）· 当前 x={Math.round(position.x)}, y=
              {Math.round(position.y)} · 约 {currentLatLng.lat.toFixed(1)}°,{' '}
              {currentLatLng.lng.toFixed(1)}°
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={clickTeleport}
                  onChange={(e) => setClickTeleport(e.target.checked)}
                />
                点击地图传送
              </label>
              <span className="text-slate-600">|</span>
              <span>x,y</span>
              <input
                className="w-28 bg-slate-900 border border-slate-500 px-2 py-0.5 text-slate-100"
                type="text"
                value={xyInput}
                placeholder="840,358"
                onChange={(e) => setXyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTeleportXY()}
              />
              <button
                className="border border-slate-500 px-2 py-0.5 hover:bg-slate-800"
                type="button"
                onClick={handleTeleportXY}
              >
                传送
              </button>
              <span className="text-slate-600">|</span>
              <span>纬度,经度</span>
              <input
                className="w-28 bg-slate-900 border border-slate-500 px-2 py-0.5 text-slate-100"
                type="text"
                value={latLngInput}
                placeholder="38.7,-9.1"
                onChange={(e) => setLatLngInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleTeleportLatLng()}
              />
              <button
                className="border border-slate-500 px-2 py-0.5 hover:bg-slate-800"
                type="button"
                onClick={handleTeleportLatLng}
              >
                传送
              </button>
              <span className="text-slate-600">|</span>
              <button
                className="border border-slate-500 px-2 py-0.5 hover:bg-slate-800"
                type="button"
                onClick={handleTeleportToPort}
              >
                传送到 {selectedPort.name}
              </button>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={dockHere}
                  onChange={(e) => setDockHere(e.target.checked)}
                />
                直接靠港
              </label>
            </div>
          </div>
        )}
        <div className="mt-2 border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-base">
          {visiblePortOptions.length === 0 ? (
            <div className="text-slate-500">无匹配港口</div>
          ) : (
            visiblePortOptions
              .slice(scrollOffset, scrollOffset + VISIBLE_PORT_COUNT)
              .map(({ id, name }, i) => {
                const absoluteIndex = scrollOffset + i;
                const isHighlighted = absoluteIndex === highlightIndex;

                return (
                  <button
                    key={id}
                    type="button"
                    className={`block w-full cursor-pointer text-left ${
                      isHighlighted
                        ? 'text-amber-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    onClick={() => {
                      setHighlightIndex(absoluteIndex);
                      commitPortAt(absoluteIndex);
                    }}
                  >
                    {isHighlighted ? '▶ ' : '   '}
                    {id}. {name}
                  </button>
                );
              })
          )}
          {visiblePortOptions.length > VISIBLE_PORT_COUNT && (
            <div className="text-slate-500">
              … 还有 {visiblePortOptions.length - VISIBLE_PORT_COUNT} 个港口
            </div>
          )}
        </div>
        <div className="mt-1 text-sm text-slate-500">
          ↑↓ 选择 · Enter 确认 · Esc 清空过滤 · 也可直接点击列表行
        </div>
        <div className="mt-2 h-12 text-center text-base text-slate-300">
          <div>
            {status ||
              (targetPort ? `目标：${targetPort.name}` : '') ||
              (previewStatus === 'ready'
                ? `预览：${selectedPort.name}，三种算法已显示在同一张地图上`
                : `选择目标和算法后，点击“预览航线”计算三种路线`)}
          </div>
          <div className="text-sm text-slate-400">
            黄色为正在执行的自动导航航线。预览颜色：
            {NAVIGABLE_STRATEGIES.map(({ id, name }) => (
              <span key={id} className="ml-3">
                <span style={{ color: STRATEGY_COLORS[id] }}>■</span> {name}
              </span>
            ))}
            <span className="ml-3">
              <span style={{ color: STRATEGY_COLORS.deep }}>■</span> 超远航线
            </span>
            {selectedStrategy.description}
          </div>
          <div className="text-xs text-slate-500">
            预览为快速近似路线，不计算海岸惩罚；点击“自动导航”时会重新规划一条避开海岸的安全航线，
            实际黄色航线可能与预览略有差异。
          </div>
        </div>
        {deepRouteStatus === 'computing' && (
          <div className="mt-3 border border-lime-800 bg-slate-950 px-3 py-2 text-sm text-lime-300">
            <div className="mb-1 flex items-center justify-between">
              <span>
                深度搜索中... 已探索{' '}
                <span className="font-mono">
                  {deepRouteNodes.toLocaleString()}
                </span>{' '}
                个节点
              </span>
              <button
                className="border border-slate-500 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
                type="button"
                onClick={handleCancelDeepRoute}
              >
                取消
              </button>
            </div>
            <div className="h-2 overflow-hidden border border-lime-900 bg-slate-900">
              <div className="h-full w-full animate-pulse bg-lime-500" />
            </div>
            <div className="mt-1 text-xs text-slate-500">
              使用 4×4 精细网格、轻量海岸惩罚（4px
              内），确保穿越海峡同时远离峭壁。算法分块执行，界面保持响应。
            </div>
          </div>
        )}
        {deepRouteStatus === 'ready' && (
          <div className="mt-3 border border-lime-700 bg-slate-950 px-3 py-2 text-sm text-lime-300">
            <div className="flex items-center justify-between">
              <span>
                <span style={{ color: STRATEGY_COLORS.deep }}>■</span>{' '}
                超远航线就绪（共探索{' '}
                <span className="font-mono">
                  {deepRouteNodes.toLocaleString()}
                </span>{' '}
                个节点）—— 点击“自动导航”出发。
              </span>
            </div>
          </div>
        )}
        {autoNavigation.enabled && (
          <div className="mt-3 border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-300">
            <div className="mb-1 flex items-center justify-between">
              <span>
                航线完成：{progress}% · 已通过 {completedWaypoints} 个，还剩{' '}
                {remainingWaypoints} 个导航点
              </span>
              <span>
                {activeStrategy?.name || '未知航线'}
                {autoNavigation.useAlternateAxis ? ' · 脱困中' : ''}
              </span>
            </div>
            <div className="h-3 border border-slate-500 bg-slate-900">
              <div
                className="h-full bg-amber-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-1 text-slate-400">
              正在前往第 {activeWaypoint}{' '}
              个导航点。如果“已通过”不变且停滞次数持续增加，就是卡住。连续停滞：
              {autoNavigation.stagnantMoves} · 当前坐标：
              {Math.round(position.x)}, {Math.round(position.y)}
            </div>
            {autoNavigationDebug && (
              <div className="mt-2 space-y-1 border-t border-slate-800 pt-2 text-xs text-slate-400">
                <div>
                  诊断：{DEBUG_REASON_LABELS[autoNavigationDebug.reason]} ·{' '}
                  {autoNavigationDebug.message}
                </div>
                <div>
                  当前目标：第 {autoNavigationDebug.waypointIndex + 1}/
                  {autoNavigationDebug.waypointCount} 个 @{' '}
                  {formatDebugPosition(autoNavigationDebug.waypoint)} · 距离{' '}
                  {formatDebugDistance(autoNavigationDebug.distanceToWaypoint)}
                  px / 判定半径{' '}
                  {formatDebugDistance(autoNavigationDebug.reachedDistance)}
                  px · 航向 {autoNavigationDebug.heading || '无'}
                </div>
                <div>
                  海况：当前位置{' '}
                  {formatSeaState(
                    autoNavigationDebug.positionSea,
                    autoNavigationDebug.positionOpenSea,
                  )}{' '}
                  · 目标点{' '}
                  {formatSeaState(
                    autoNavigationDebug.waypointSea,
                    autoNavigationDebug.waypointOpenSea,
                  )}
                </div>
                {autoNavigationDebug.detourTarget && (
                  <div>
                    局部 A*：目标第{' '}
                    {(autoNavigationDebug.detourTargetIndex ?? 0) + 1} 个 @{' '}
                    {formatDebugPosition(autoNavigationDebug.detourTarget)} ·
                    距离{' '}
                    {formatDebugDistance(
                      autoNavigationDebug.detourTargetDistance,
                    )}
                    px · 新增航点 {autoNavigationDebug.detourPathLength ?? 0}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

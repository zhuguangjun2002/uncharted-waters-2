/* eslint-disable no-param-reassign */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import { regularPorts, supplyPorts } from '../../data/portData';
import {
  cancelAutoNavigation,
  startAutoNavigation,
} from '../../state/actionsWorld';
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

  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      const worldX = Math.floor((x / MAP_WIDTH) * WORLD_MAP_COLUMNS);
      const worldY = Math.floor((y / MAP_HEIGHT) * WORLD_MAP_ROWS);
      const tile = worldTilemap[worldY * WORLD_MAP_COLUMNS + worldX] || 0;
      const offset = (y * MAP_WIDTH + x) * 4;

      if (tile >= 50) {
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
    const { x, y } = toMapPosition(pathPosition);

    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
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
          `深度搜索完成：找到 ${selectedPort.name} 的航线（共探索 ${finalNodes.toLocaleString()} 个节点）。`,
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

  const handlePortFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    const canStart = isDeepReady || (previewStatus === 'ready' && selectedPath.length > 0);

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

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
      <div className="border-4 border-slate-300 bg-black p-4 text-slate-200">
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          className="w-[1080px] h-[540px]"
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
          {(previewStatus === 'failed' ||
            deepRouteStatus === 'computing' ||
            deepRouteStatus === 'ready' ||
            deepRouteStatus === 'failed') && (
            <button
              className={`border px-3 py-1 text-base disabled:text-slate-500 ${
                deepRouteStatus === 'computing'
                  ? 'border-lime-700 text-lime-400 hover:bg-slate-800'
                  : deepRouteStatus === 'ready'
                    ? 'border-lime-500 text-lime-300 hover:bg-slate-800'
                    : 'border-slate-500 hover:bg-slate-800'
              }`}
              disabled={deepRouteStatus === 'computing'}
              type="button"
              onClick={
                deepRouteStatus === 'computing'
                  ? handleCancelDeepRoute
                  : handleDeepRoute
              }
            >
              {deepRouteStatus === 'computing'
                ? '搜索中...'
                : deepRouteStatus === 'ready'
                  ? '重新深度搜索'
                  : '深度搜索'}
            </button>
          )}
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
              使用 4×4 精细网格、无海岸惩罚，确保穿越海峡。算法分块执行，界面保持响应。
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
                个节点）—— 点击"自动导航"出发。
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
          </div>
        )}
      </div>
    </div>
  );
}

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
  createAutoNavigationPath,
  type AutoNavigationStrategyId,
} from '../../game/world/autoNavigation';
import { positionAdjacentToPort } from '../../state/selectors';

const MAP_WIDTH = 720;
const MAP_HEIGHT = 360;
const WORLD_MAP_ROWS = 1080;

interface Props {
  position: Position;
  autoNavigation: AutoNavigationState;
}

type PreviewStatus = 'dirty' | 'calculating' | 'ready' | 'failed';
type PreviewPaths = Partial<Record<AutoNavigationStrategyId, Position[]>>;

const STRATEGY_COLORS: Record<AutoNavigationStrategyId, string> = {
  balanced: '#38bdf8',
  detailed: '#f97316',
  offshore: '#a78bfa',
};

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
    AUTO_NAVIGATION_STRATEGIES.forEach(({ id }) => {
      drawPath(
        context,
        previewPaths[id] || [],
        previewTargetPosition,
        STRATEGY_COLORS[id],
        id === selectedStrategyId ? 2 : 1,
      );
    });
    drawAutoNavigation(context, autoNavigation);
    drawPosition(context, position);
  }, [
    autoNavigation,
    position,
    previewPaths,
    previewTargetPosition,
    selectedStrategyId,
  ]);

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
    setStatus('已更改目标或算法，请点击“预览航线”重新计算三种路线。');
  };

  const handlePreviewPath = () => {
    setPreviewPaths({});
    setPreviewStatus('calculating');
    setStatus(`正在计算到 ${selectedPort.name} 的三种自动导航路线...`);

    window.setTimeout(() => {
      const paths = AUTO_NAVIGATION_STRATEGIES.reduce<PreviewPaths>(
        (strategyPaths, { id }) => ({
          ...strategyPaths,
          [id]: createAutoNavigationPath(position, previewTargetPosition, id),
        }),
        {},
      );
      const availableStrategies = AUTO_NAVIGATION_STRATEGIES.filter(
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
    const selectedPath = previewPaths[selectedStrategyId] || [];

    if (previewStatus !== 'ready' || !selectedPath.length) {
      setStatus('请先点击“预览航线”，并选择一条有颜色路线的算法。');
      return;
    }

    const result = startAutoNavigation(
      selectedPortId,
      position,
      selectedStrategyId,
      selectedPath,
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
          <select
            className="flex-1 bg-slate-900 border border-slate-500 px-2 py-1 text-base"
            value={selectedPortId}
            onChange={(e) => {
              setSelectedPortId(e.target.value);
              handleSelectionChange();
            }}
          >
            {portOptions.map(({ id, name }) => (
              <option key={id} value={id}>
                {id}. {name}
              </option>
            ))}
          </select>
          <select
            className="w-40 bg-slate-900 border border-slate-500 px-2 py-1 text-base"
            value={selectedStrategyId}
            onChange={(e) => {
              setSelectedStrategyId(e.target.value as AutoNavigationStrategyId);
              setStatus('已切换实际运行算法；地图上的三种预览路线保持不变。');
            }}
          >
            {AUTO_NAVIGATION_STRATEGIES.map(({ id, name }) => (
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
            {AUTO_NAVIGATION_STRATEGIES.map(({ id, name }) => (
              <span key={id} className="ml-3">
                <span style={{ color: STRATEGY_COLORS[id] }}>■</span> {name}
              </span>
            ))}
            {selectedStrategy.description}
          </div>
        </div>
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

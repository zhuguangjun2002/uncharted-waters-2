/* eslint-disable no-param-reassign */

import React, { useEffect, useRef, useState } from 'react';

import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import { regularPorts, supplyPorts } from '../../data/portData';
import {
  cancelAutoNavigation,
  startAutoNavigation,
} from '../../state/actionsWorld';
import type { AutoNavigationState } from '../../state/state';
import type { Position } from '../../types';

const MAP_WIDTH = 360;
const MAP_HEIGHT = 180;
const WORLD_MAP_ROWS = 1080;

interface Props {
  position: Position;
  autoNavigation: AutoNavigationState;
}

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

const drawAutoNavigation = (
  context: CanvasRenderingContext2D,
  { path, waypointIndex, targetPosition }: AutoNavigationState,
) => {
  if (!path.length) {
    return;
  }

  context.strokeStyle = '#facc15';
  context.lineWidth = 1;
  context.beginPath();

  path.slice(waypointIndex).forEach((pathPosition, i) => {
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
  context.fillStyle = '#fde047';
  context.fillRect(x - 2, y - 2, 5, 5);
};

export default function WorldMap({ position, autoNavigation }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseMapRef = useRef<HTMLCanvasElement>();
  const [selectedPortId, setSelectedPortId] = useState(portOptions[0].id);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!baseMapRef.current) {
      baseMapRef.current = document.createElement('canvas');
      baseMapRef.current.width = MAP_WIDTH;
      baseMapRef.current.height = MAP_HEIGHT;
      drawBaseMap(baseMapRef.current.getContext('2d')!);
    }

    const context = canvasRef.current!.getContext('2d')!;
    context.drawImage(baseMapRef.current, 0, 0);
    drawAutoNavigation(context, autoNavigation);
    drawPosition(context, position);
  }, [autoNavigation, position]);

  const targetPort = portOptions.find(
    ({ id }) => id === autoNavigation.targetPortId,
  );
  const selectedPort = portOptions.find(({ id }) => id === selectedPortId)!;

  const handleStartAutoNavigation = () => {
    const result = startAutoNavigation(selectedPortId, position);

    if (result === 'started') {
      setStatus(
        `自动导航已开始：${selectedPort.name}。按 F4 关闭地图查看航行。`,
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
          className="w-[720px] h-[360px]"
        />
        <div className="mt-3 flex items-center gap-3 text-xl">
          <div className="w-40">F4 世界地图</div>
          <select
            className="flex-1 bg-slate-900 border border-slate-500 px-2 py-1 text-base"
            value={selectedPortId}
            onChange={(e) => setSelectedPortId(e.target.value)}
          >
            {portOptions.map(({ id, name }) => (
              <option key={id} value={id}>
                {id}. {name}
              </option>
            ))}
          </select>
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
        <div className="mt-2 h-6 text-center text-base text-slate-300">
          {status || (targetPort ? `目标：${targetPort.name}` : '')}
        </div>
      </div>
    </div>
  );
}

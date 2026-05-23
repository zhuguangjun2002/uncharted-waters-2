import React, { useEffect, useRef } from 'react';

import Assets from '../../assets';
import { WORLD_MAP_COLUMNS } from '../../constants';
import type { Position } from '../../types';

const MAP_WIDTH = 360;
const MAP_HEIGHT = 180;
const WORLD_MAP_ROWS = 1080;

interface Props {
  position: Position;
}

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
  { x, y }: Position,
) => {
  const markerX = Math.floor((x / WORLD_MAP_COLUMNS) * MAP_WIDTH);
  const markerY = Math.floor((y / WORLD_MAP_ROWS) * MAP_HEIGHT);

  context.fillStyle = '#fef08a';
  context.fillRect(markerX - 2, markerY - 2, 5, 5);
  context.fillStyle = '#ef4444';
  context.fillRect(markerX - 1, markerY - 1, 3, 3);
};

export default function WorldMap({ position }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseMapRef = useRef<HTMLCanvasElement>();

  useEffect(() => {
    if (!baseMapRef.current) {
      baseMapRef.current = document.createElement('canvas');
      baseMapRef.current.width = MAP_WIDTH;
      baseMapRef.current.height = MAP_HEIGHT;
      drawBaseMap(baseMapRef.current.getContext('2d')!);
    }

    const context = canvasRef.current!.getContext('2d')!;
    context.drawImage(baseMapRef.current, 0, 0);
    drawPosition(context, position);
  }, [position]);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80">
      <div className="border-4 border-slate-300 bg-black p-4">
        <canvas
          ref={canvasRef}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
          className="w-[720px] h-[360px]"
        />
        <div className="mt-3 text-center text-xl text-slate-200">
          F4 世界地图
        </div>
      </div>
    </div>
  );
}

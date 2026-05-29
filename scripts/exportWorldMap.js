/*
  Exports the full world map as a single PNG.

  The world isn't stored as an image. It's a 2160 x 1080 grid of tile indices
  (`src/data/assets/worldTilemap.wasm`, one byte per tile), and the game draws
  each tile by copying a 16 x 16 block from the tileset
  (`src/game/images/worldTileset.png`) at runtime. This script replicates that
  compositing offline and writes the result to a PNG.

  The tileset has 31 rows of time-of-day variants; row 0 is full daylight.
  In-game tiles are 32 px because game images are upscaled 2x on load, but the
  source PNG tiles are 16 px — this script reads the source directly.

  Full resolution (16 px/tile) would be 34560 x 17280 ≈ 600M px, which is too
  large for a single PNG buffer, so the output is scaled down to `--tile` px
  per tile (default 4 → 8640 x 4320).

  Usage:
    node scripts/exportWorldMap.js [--tile=4] [--row=0] [--out=world-map.png]

    --tile  Pixels per tile in the output (1-16). Higher = larger/sharper.
    --row   Tileset row (time of day), 0-30. 0 is daytime.
    --out   Output file path.
*/

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const TILEMAP_PATH = path.join(ROOT, 'src/data/assets/worldTilemap.wasm');
const TILESET_PATH = path.join(ROOT, 'src/game/images/worldTileset.png');

const WORLD_COLS = 2160;
const WORLD_ROWS = 1080;
const SRC_TILE = 16; // tile size in the source tileset PNG

const parseArgs = () => {
  const args = {};
  process.argv.slice(2).forEach((arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  });
  return args;
};

const args = parseArgs();
const dst = Math.max(1, Math.min(16, parseInt(args.tile || '4', 10)));
const tilesetRow = Math.max(0, Math.min(30, parseInt(args.row || '0', 10)));
const outPath = path.resolve(args.out || path.join(ROOT, 'world-map.png'));

const tilemap = fs.readFileSync(TILEMAP_PATH);
if (tilemap.length !== WORLD_COLS * WORLD_ROWS) {
  throw new Error(
    `Unexpected tilemap size ${tilemap.length}, expected ${WORLD_COLS * WORLD_ROWS}`,
  );
}

const tileset = PNG.sync.read(fs.readFileSync(TILESET_PATH));
const tsData = tileset.data;
const tsW = tileset.width;

const outW = WORLD_COLS * dst;
const outH = WORLD_ROWS * dst;

console.log(
  `Tileset ${tileset.width}x${tileset.height}, world ${WORLD_COLS}x${WORLD_ROWS} tiles`,
);
console.log(
  `Rendering at ${dst} px/tile (row ${tilesetRow}) -> ${outW}x${outH} px`,
);

const out = new PNG({ width: outW, height: outH });
const outData = out.data;

// Nearest-neighbour sample positions within a tile (16 px -> dst px).
const sample = new Int32Array(dst);
for (let i = 0; i < dst; i += 1) {
  sample[i] = Math.floor((i * SRC_TILE) / dst);
}

const rowYBase = tilesetRow * SRC_TILE;

for (let ty = 0; ty < WORLD_ROWS; ty += 1) {
  for (let tx = 0; tx < WORLD_COLS; tx += 1) {
    const tile = tilemap[ty * WORLD_COLS + tx] || 0;
    const srcTileX = tile * SRC_TILE;

    for (let py = 0; py < dst; py += 1) {
      const srcRowOff = ((rowYBase + sample[py]) * tsW + srcTileX) * 4;
      const dstY = ty * dst + py;
      let dstOff = (dstY * outW + tx * dst) * 4;

      for (let px = 0; px < dst; px += 1) {
        const so = srcRowOff + sample[px] * 4;
        outData[dstOff] = tsData[so];
        outData[dstOff + 1] = tsData[so + 1];
        outData[dstOff + 2] = tsData[so + 2];
        outData[dstOff + 3] = tsData[so + 3];
        dstOff += 4;
      }
    }
  }

  if (ty % 100 === 0 || ty === WORLD_ROWS - 1) {
    process.stdout.write(`\r  rows ${ty + 1}/${WORLD_ROWS}`);
  }
}

process.stdout.write('\n');
console.log('Encoding PNG...');

fs.writeFileSync(outPath, PNG.sync.write(out));

const { size } = fs.statSync(outPath);
console.log(`Wrote ${outPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);

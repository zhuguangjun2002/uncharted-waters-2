# 世界地图：设计与实现

本文详细讲解游戏的世界地图是如何存储、如何在运行时绘制的，以及如何用
[scripts/exportWorldMap.js](/home/laozhu/project/uncharted-waters-2/scripts/exportWorldMap.js)
把它离线拼接成一张完整的 PNG。

记录日期：2026-05-29

## 一句话结论

**源代码里没有一张完整的世界地图 PNG。** 世界地图是运行时用瓦片（tile）实时拼出来的，由
两份资源组合而成：

- `src/data/assets/worldTilemap.wasm`：`2160 × 1080` 的瓦片**索引**数组，每个格子一个字节。
- `src/game/images/worldTileset.png`：瓦片**图集**，把索引映射成实际的 `16 × 16` 小图块。

游戏每帧只绘制相机可见范围内的瓦片，从不生成整张大图。

## 数据结构

### tilemap：地形索引

| 属性 | 值 |
|---|---|
| 文件 | `src/data/assets/worldTilemap.wasm` |
| 尺寸 | `2160 × 1080` 格（`WORLD_MAP_COLUMNS = 2160`，rows = 1080） |
| 每格 | 1 字节（`Uint8Array`），即一个瓦片索引 |
| 文件大小 | `2160 × 1080 = 2,332,800` 字节 |
| 取值范围 | `0 – 127`（实测） |

`.wasm` 扩展名只是个技巧：这样静态服务器会用能压缩的 content-type 返回它，文件本身是
**原始字节**，不是 WebAssembly 模块。加载代码见 `src/assets.ts` 的 `loadBinary()`：

```ts
const loadBinary = async (url: string) => {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
};
```

读取某格地形的索引（`src/map.ts`）：

```ts
const tiles = ({ x, y }) => tilemap[y * tilemapColumns + getXWrapAround(x)] || 0;
```

也就是行优先（row-major）的一维数组：`index = y * 2160 + x`。

### tileset：瓦片图集

| 属性 | 值 |
|---|---|
| 文件 | `src/game/images/worldTileset.png` |
| 尺寸 | `2048 × 496` px |
| 单格 | `16 × 16` px |
| 布局 | `128` 列 × `31` 行 |

- **列（x 轴）= 瓦片索引**：tilemap 里的索引 `0–127` 正好对应图集的 128 列。
- **行（y 轴）= 时间段变体**：31 行是同一地形在不同时刻（白天 / 黄昏 / 夜晚 / 黎明）的配色。

### 一个重要细节：16px 源，32px 运行时

游戏内常量 `TILE_SIZE = 32`，但源 PNG 的瓦片是 **16px**。原因在 `src/assets.ts`：所有
`gameImages`（含 `worldTileset`）加载时会被 **2× 放大**（`loadImage(value, true)`），并关闭平滑：

```ts
const scale = upscale ? 2 : 1;
canvas.width = img.width * scale;
context.imageSmoothingEnabled = false;
context.drawImage(img, 0, 0, canvas.width, canvas.height);
```

所以游戏里操作的 tileset canvas 是 `4096 × 992`、每格 32px；而磁盘上的 PNG 是 `2048 × 496`、
每格 16px。**离线读取源 PNG 时要按 16px 算。**

## 运行时渲染

### 取瓦片 → 画瓦片

核心绘制循环在 `src/map.ts` 的 `drawImage()`：对可见范围内每个格子，从图集里按
`(瓦片索引, 时间段)` 取出对应小块，画到目标 canvas：

```ts
context.drawImage(
  tileset,
  tile * tileSize,           // 源 x：索引选列
  tilesetOffset * tileSize,  // 源 y：时间段选行
  tileSize, tileSize,        // 源 16×16（运行时 32×32）
  xOffset * tileSize,        // 目标 x
  yOffset * tileSize,        // 目标 y
  tileSize, tileSize,
);
```

### 时间段（tilesetOffset）

`getTilesetOffset(time)` 把一天内的分钟数（`0–1439`）映射到图集的某一行，实现昼夜配色与
平滑过渡：

- `08:00–16:00`：行 0 起（白天），16:00 前逐步变化。
- `16:00–20:00`：行 6 起（黄昏）。
- `20:00–04:00`：行 16 起（夜晚）。
- `04:00–08:00`：行 22 起（黎明）。

导出 PNG 时默认用 `row 0`（白天）。

### 横向环绕，纵向不环绕

世界在东西方向是首尾相接的（绕过太平洋），由 `getXWrapAround()` 处理
（`src/game/world/sharedUtils.ts`）：

```ts
export const getXWrapAround = (x) => {
  if (x < 0) return x + WORLD_MAP_COLUMNS;
  if (x >= WORLD_MAP_COLUMNS) return x - WORLD_MAP_COLUMNS;
  return x;
};
```

纵向（南北极）不环绕，`outOfBoundsAt()` 对 `y < 0` 或 `y + 1 >= 1080` 判为越界。

### 海陆判定（碰撞）

世界场景里，瓦片索引 **`>= 50` 视为陆地/不可通行**，`0–49` 视为可航行海面。玩家船队占
`2 × 2` 格，靠岸碰撞会检查四个角的格子（`src/map.ts` 的 `collisionAt()`）：

```ts
offsetsToCheck.push({ x: 0, y: 0 }, { x: 1, y: 0 });
return offsetsToCheck.some((offset) => {
  const tile = tiles(applyPositionDelta(position, offset));
  return tile >= 50;
});
```

F4 世界地图缩略图也用同一个 `tile >= 50` 阈值，把每格画成绿色（陆地）或蓝色（海面）
（`src/interface/world/WorldMap.tsx` 的 `drawBaseMap()`）。

### 滚动优化：缓存 + 只重绘新条带

`map.draw()` 不是每帧重画整屏。它按 `tilesetOffset` 缓存了一块离屏 canvas，记住上次绘制
的相机位置：

- 相机没动：直接返回缓存。
- 移动很大（超过一屏）：整屏重绘。
- 小幅移动：把已有画面用 `drawImage` 平移复用，只对**新进入视野的那一条**重新画瓦片。

加上 `drawCamera()` 里按子格小数偏移和 `PercentNextMove` 插值，得到平滑的滚动效果。

### 坐标系

- 原点 `(0, 0)` 在左上角；x 向东增大，y 向南增大。
- 玩家起始时间 `START_TIME_PASSED = 480`（即 08:00），起始日期 `1522-05-17`，出生在
  Lisbon 附近海域。

## 相关但独立的数据层

- `src/data/assets/windsCurrent.wasm`：风向与洋流数据，按“海域”组织，**不属于** tilemap，
  在 `src/game/world/windCurrent.ts` 中单独读取，用于计算航速。
- `src/data/portData.ts`：130 个港口的坐标与属性，港口位置叠加在世界坐标系之上，但不写进
  tilemap。

换句话说，tilemap 只负责“海陆地形长什么样”，风/流/港口是平行的数据层。

## 坐标系与经纬度换算

游戏里同时存在三套坐标，理解它们之间的换算对调试和导出都很重要。

### 1. 世界格坐标（world tile）

游戏内部最权威的坐标系，也是 `state.fleets[1].position`、港口 `position`、tilemap 索引用的坐标。

- 原点 `(0, 0)` 在左上角，x 向东、y 向南。
- `x ∈ [0, 2160)`，**横向环绕**（`getXWrapAround`）。
- `y ∈ [0, 1080)`，纵向不环绕。

### 2. 缩略图坐标（minimap）

F4 世界地图把世界线性缩放到一张小图。`drawBaseMap()` 内部画布是 `MAP_WIDTH × MAP_HEIGHT`
（`720 × 360`），但用 CSS 显示成 `1080 × 540`。换算见 `toMapPosition()`：

```ts
const toMapPosition = ({ x, y }) => ({
  x: Math.floor((x / WORLD_MAP_COLUMNS) * MAP_WIDTH),
  y: Math.floor((y / WORLD_MAP_ROWS) * MAP_HEIGHT),
});
```

**反向：缩略图点击 → 世界格坐标。** 用点击点相对显示尺寸的比例还原（不要用内部 720×360，
要用 `getBoundingClientRect()` 拿实际显示尺寸）：

```ts
const rect = canvas.getBoundingClientRect();
const x = Math.floor(((clientX - rect.left) / rect.width) * WORLD_MAP_COLUMNS);
const y = Math.floor(((clientY - rect.top) / rect.height) * WORLD_MAP_ROWS);
```

### 3. 地球经纬度（lat/lng）

世界地图近似**等距圆柱投影**，所以经纬度和世界格坐标近似线性关系。换算实现在
[src/game/world/geo.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/geo.ts)：

```
x = (895 + lng * 6) mod 2160     // 经度，6 = 2160 / 360 格每度
y = 631 - lat * 7.06             // 纬度，y 向南为正
```

常量来历：

- `PX_PER_LNG = 2160 / 360 = 6`：经度跨满 360° 正好绕地图一圈，是精确值。
- `LNG_ORIGIN_X = 895`：经度 0° 对应的 x，由 Lisbon 等港口反推。
- `PX_PER_LAT = 7.06`、`LAT_ORIGIN_Y = 631`：纬度方向用几个已知港口**线性拟合**得到。注意
  `1080 / 7.06 ≈ 153°`，说明地图纵向并未覆盖完整的极区。

这是**近似**换算，用已知港口校验的误差（格）：

| 港口 | 计算 (x,y) | 实际 (x,y) | 误差 |
|---|---|---|---|
| Lisbon | 840,358 | 840,358 | 0 / 0 |
| Istanbul | 1069,342 | 1072,344 | 3 / 2 |
| Nagasaki | 1674,400 | 1676,402 | 2 / 2 |
| London | 894,267 | 900,262 | 6 / 5 |
| Calicut | 1350,552 | 1348,552 | 2 / 0 |

误差在个位数格内，足够“跳到大体位置”这类用途。要更精确可以用更多港口重新拟合，或对纬度
改用非线性映射。

这三套坐标的互转，正是“调试传送”功能的基础，详见
[DEBUG_TELEPORT.md](/home/laozhu/project/uncharted-waters-2/DEBUG_TELEPORT.md)。

## 导出完整世界地图 PNG

脚本 [scripts/exportWorldMap.js](/home/laozhu/project/uncharted-waters-2/scripts/exportWorldMap.js)
在 Node 里离线复刻上面的合成逻辑：读 `worldTilemap.wasm` 拿到每格索引，用 `pngjs` 解码
`worldTileset.png`，对每个瓦片取 `16 × 16` 源块（默认时间段行 0）做最近邻缩放，写入输出缓冲，
最后编码成 PNG。

### 为什么需要缩放

全分辨率（16px/格）= `2160·16 × 1080·16 = 34560 × 17280` ≈ 6 亿像素，RGBA 缓冲约 2.4 GB，
单张 PNG 编码不现实（也超出多数 canvas 库的尺寸上限）。因此脚本用 `--tile` 控制每格输出多少
像素，默认 4px：

| `--tile` | 输出尺寸 | 大致内存 | 说明 |
|---|---|---|---|
| 1 | `2160 × 1080` | 小 | 概览缩略图 |
| 4（默认） | `8640 × 4320` | ~150 MB | 清晰可读 |
| 8 | `17280 × 8640` | ~600 MB | 更清晰，需较大堆内存 |
| 16 | `34560 × 17280` | ~2.4 GB | 原始瓦片细节全分辨率，可能内存不足 |

### 用法

```bash
npm run export-map                              # 默认 4px/格 -> 8640×4320
node scripts/exportWorldMap.js --tile=8         # 更清晰
node scripts/exportWorldMap.js --row=16         # 夜晚配色（行 0–30）
node scripts/exportWorldMap.js --out=map.png    # 指定输出路径
```

- `--tile`：每格输出像素（1–16）。源瓦片是 16px，故 16 为原始分辨率。
- `--row`：tileset 时间段行（0–30），0 为白天。
- `--out`：输出路径，默认 `world-map.png`（已在 `.gitignore` 中忽略）。

### 采样与忠实度

脚本用最近邻采样（nearest-neighbour），不做插值平滑，以忠实保留像素美术风格；与游戏
`imageSmoothingEnabled = false` 的取向一致。源 RGBA（含 alpha）原样拷贝。

## 想进一步扩展

- 叠加港口标记：读 `src/data/portData.ts` 的坐标，按相同比例在导出图上画点。
- 叠加经纬度网格：用 `geo.ts` 的换算在导出图上画经纬线（海域划分可参考 `windCurrent.ts`）。
- 导出动画/分时段图：循环 `--row 0–30` 输出多张图，拼成昼夜变化。

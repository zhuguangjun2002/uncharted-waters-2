# 调试传送（Debug Teleport）

一个**仅供测试**的功能：把玩家船队瞬间移动到指定位置。支持四种输入方式，集成在 F4 世界地图
面板里，且只在开发构建可见。

记录日期：2026-05-29

## 目标与场景

测试时经常需要快速到达世界各处，逐格航行太慢。需求是“瞬移到某个位置”，位置可以用四种方式
指定：

1. **地球经纬度**（lat/lng）。
2. **原始地图坐标**（world tile 的 x, y）。
3. **系统内的港口**（普通港或补给港）。
4. **鼠标点击地图**上的大体位置。

定位是“去**大体**位置”——不要求精确，要求快、稳、好用。

## 设计思路

### 核心抽象：四种输入 → 一个坐标 → 一个动作

四种输入方式看似不同，但**终点都是一个世界格坐标 `{x, y}`**。所以不为每种方式单独写一套
移动逻辑，而是分三层：

```
输入层（4 种）  →  归一化为 {x, y}  →  teleport 重建场景
   经纬度 ─┐
   x,y  ──┤
   港口 ──┤──►  geo.ts / 港口坐标 / 点击反算  ──►  teleportToSea / teleportToPort
   点地图 ┘
```

这样新增输入方式只要再补一个“→ {x,y}”的转换，复用同一个传送动作。

### 复用读档的“运行时换位置”套路

航海时玩家的实时坐标存在 `worldPlayer` 闭包里，直接改 `state.fleets[1].position` 不会立刻
生效——必须让 world 场景用新位置重建。这个“原地改 `state` + 清空场景对象触发重建 + 重新
初始化界面”的套路，存档系统的 `loadFromSlot()` 已经验证过（见
[ARCHITECTURE.md 的存档系统](/home/laozhu/project/uncharted-waters-2/ARCHITECTURE.md#存档系统)），
传送直接沿用。

### 落点防陆地

经纬度可能落在内陆，点击也可能点到陆地。为契合“大体位置”，传送前用 `nearestSeaPosition()`
把目标吸附到最近的可航行海格，避免把船放到陆地上卡住。

### UI 放在 F4，门控为开发可见

F4 世界地图面板已经有缩略图、港口列表、`toMapPosition` 坐标换算，复用它代码最少也最连贯。
整个传送区用 `DEBUG` 开关包起来，生产构建（`npm run build`）里 `DEBUG === false`，面板不渲染，
玩家接触不到。

## 实现

### 坐标换算：`src/game/world/geo.ts`

`latLngToWorld(lat, lng)` 与 `worldToLatLng({x, y})`，等距圆柱投影的近似线性换算。常量来历、
精度（误差个位数格）、以及缩略图点击反算的公式，详见
[WORLDMAP.md 的坐标系章节](/home/laozhu/project/uncharted-waters-2/WORLDMAP.md#坐标系与经纬度换算)。

### 落点吸附：`src/state/selectors.ts` 的 `nearestSeaPosition()`

若目标格可航行就原样返回；否则以目标为中心**螺旋向外**逐圈搜索，返回最近的
`!map.collisionAt` 海格（最多搜 60 圈）。

### 传送动作：`src/state/actionsWorld.ts`

```ts
const rebuildScene = () => {
  state.world = undefined; // 清空，让 game loop 下一帧重建
  state.port = undefined;
};

teleportToSea(position)              // x,y / 经纬度 / 点击 / 港口（不靠港）
teleportToPort(portId, dockHere)     // 港口：靠港 or 落到港口附近海域
```

`teleportToSea` 流程：`nearestSeaPosition` 吸附 → 写 `position`、`portId = null` → 取消自动导航
→ `rebuildScene()` → `Input.reset()` → `updateGeneral()` / `updateWorldStatus()` /
`updateProvisions()` 刷新界面。

`teleportToPort` 在 `dockHere` 时直接设 `portId` 并重建为 port 场景；由于 F4 地图只在 world
loop 运行时才会自动隐藏，这里额外调一次 `updateInterface.worldMap({ visible: false })` 手动
关掉它。

### UI：`src/interface/world/WorldMap.tsx`

`DEBUG` 为真时，在 F4 面板插入“调试传送”区：

- **当前坐标回显**：x,y + 约经纬度（`worldToLatLng`）。
- **点击地图传送**：勾选后给 canvas 加 `onClick`，用 `getBoundingClientRect` 反算世界坐标后
  传送；光标变十字。
- **x,y 输入**：解析 `840,358`，回车或按钮触发。
- **纬度,经度 输入**：解析 `38.7,-9.1` → `latLngToWorld` → 传送。
- **传送到选中港口**：复用面板已有的港口选择器；“直接靠港”勾选项决定进港还是落到港口附近海域。

### 门控：`src/constants.ts`

```ts
export const DEBUG = process.env.NODE_ENV !== 'production';
```

webpack 按 `--mode` 注入 `process.env.NODE_ENV`，生产构建里整段被求值为 `false`。

## 涉及文件一览

| 文件 | 作用 |
|---|---|
| `src/game/world/geo.ts` | 经纬度 ↔ 世界格坐标换算（新增）。 |
| `src/state/selectors.ts` | `nearestSeaPosition()` 落点防陆地（新增函数）。 |
| `src/state/actionsWorld.ts` | `teleportToSea()` / `teleportToPort()`（新增）。 |
| `src/interface/world/WorldMap.tsx` | F4 面板的“调试传送”区（DEBUG 门控）。 |
| `src/constants.ts` | `DEBUG` 开关、`WORLD_MAP_ROWS`。 |

## 当前限制与可扩展

- 经纬度换算是近似线性拟合，误差个位数格；要更准可用更多港口重拟合或改非线性纬度映射。
- 落点吸附只看碰撞，不判断目标是否与当前海域连通（可能吸附到一小片封闭水域）。
- 仅传送玩家船队，不处理 NPC。
- 可扩展：保存/跳转“书签坐标”、经纬度网格叠加、把传送做成独立调试面板。

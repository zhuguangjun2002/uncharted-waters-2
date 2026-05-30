# 架构说明

本文档解释 `README.md` 中提到的游戏架构，帮助开发者理解代码如何运行、各目录负责什么，以及新增功能时应该改哪里。

## 总览

这个项目可以理解成两套系统一起工作：

- **game**：负责 Canvas 绘制、角色移动、地图滚动、world/port 场景更新。
- **interface**：负责 React GUI，例如左右信息栏、building 界面、dialog、provisions、indicators、world map。

两套系统共享同一个全局 **State**。`game loop` 持续读取 State 和 Input，然后更新 Canvas；React interface 只在需要时通过 `updateInterface` 被动刷新。

```text
Assets.load()
  -> Input.setup()
  -> renderInterface()
  -> 初始化 State 派生信息
  -> requestAnimationFrame(loop)

loop:
  如果在 port:
    创建或复用 port scene
    如果没有进入 building:
      port.update()
      port.draw()

  如果在 world:
    创建或复用 world scene
    world.update()
    world.draw()

  requestAnimationFrame(loop)
```

核心入口在 [src/app.ts](/home/laozhu/project/uncharted-waters-2/src/app.ts)。

## 目录职责

### `src/app.ts`

应用启动入口，负责把各模块串起来：

- 等待 `Assets.load()` 加载图片和 WASM data。
- 调用 `Input.setup()` 注册键盘事件。
- 调用 `renderInterface()` 挂载 React interface。
- 根据 `state.portId` 决定当前运行 `world` 还是 `port`。
- 用 `requestAnimationFrame()` 驱动主循环。

### `src/game/`

Canvas 游戏本体。这里的代码更接近传统游戏开发，主要是 imperative 风格。

- `src/game/world/`：world map、fleet、wind/current、ship speed、world NPC，以及
  `geo.ts`（经纬度 ↔ 世界格坐标换算，见 [WORLDMAP.md](/home/laozhu/project/uncharted-waters-2/WORLDMAP.md#坐标系与经纬度换算)）。
- `src/game/port/`：port map、port player、port NPC、building 入口检测。
- `src/game/images/`：Canvas 使用的 sprite 和 tileset 资源声明。

`world` 和 `port` 都暴露类似结构：

```ts
{
  update: () => void;
  draw: () => void;
  characters: () => characters;
}
```

`update()` 负责推进状态，例如时间、移动、NPC 行为；`draw()` 负责把当前状态画到 canvas。

### `src/interface/`

React GUI。这里负责玩家看到的界面层，但不直接驱动游戏世界。

常见职责包括：

- 左右侧 UI：`Left.tsx`、`Right.tsx`
- 主 canvas 容器：`Camera.tsx`
- 港口建筑界面：`interface/port/`
- world 状态显示：`interface/world/`
- 通用 UI：`interface/common/`
- 音乐和音效：`interface/sound/`

注意：`Camera.tsx` 只是把 `<canvas id="camera" />` 放进 React 布局。它被 `React.memo` 固定住，不依赖 React rerender。真正的绘制发生在 `src/game/world/world.ts` 和 `src/game/port/port.ts`。

### `src/state/`

共享状态和修改状态的 actions。

- `state.ts`：全局 State 初始值。游戏启动时始终从默认值开始（不再自动读档），读档改为玩家通过存档面板手动选择。
- `actionsWorld.ts`：world 相关动作，例如 `dock()`、`setSail()`、`worldTimeTick()`、`updateWorldStatus()`，以及调试用的 `teleportToSea()` / `teleportToPort()`。
- `actionsPort.ts`：port/building 相关动作，例如 `enterBuilding()`、`exitBuilding()`、`buyUsedShip()`、`supplyShip()`。
- `selectors.ts`、`selectorsFleet.ts`：从 State 计算派生信息（如 `positionAdjacentToPort()`、`nearestSeaPosition()`）。
- `updateInterface.ts`：game/actions 通知 React 刷新的桥接对象。
- `save.ts`：存档/读档系统，详见下文 [存档系统](#存档系统)。
- `uiState.ts`：React interface 与 game loop 之间的桥接标志（目前只有 `saveMenuOpen`，用于在存档面板打开时暂停世界更新）。

### `src/data/`

游戏数据和二进制资源：

- port、building、ship、character、item、sailor 等静态数据。
- `data/assets/*.wasm` 保存 world tilemap、port tilemaps、winds/current 等二进制数据。

港口数据的字段、ID、坐标和完整清单见 [PORTS.md](/home/laozhu/project/uncharted-waters-2/PORTS.md)。

### `src/assets.ts`

统一加载资源：

- game images 会被放大并关闭 image smoothing，保持 pixel art 风格。
- interface images 按原尺寸加载。
- WASM/binary data 通过 `fetch()` 加载为 `Uint8Array`。
- 提供 `Assets.images()`、`Assets.data()`、`Assets.buildings()` 等访问方法。

## State、Input、Actions、Interface 的关系

项目没有使用 Redux。实际数据流是：

```text
Input
  -> game.update()
  -> actions 修改 state
  -> updateInterface 调用 React setState
  -> interface rerender

state
  -> game.draw()
  -> canvas 更新画面
```

### 为什么不用 Redux？

这个项目的核心不是普通 web app，而是一个持续运行的 game loop。

普通 React/Redux 应用通常是「数据变化 -> UI rerender」。但游戏每秒需要稳定绘制很多帧，如果把角色位置、地图滚动、动画插值都放进 Redux/React 更新链路，会增加开销，也不利于保持 60 fps。

因此当前设计是：

- 高频画面更新交给 Canvas 和 game loop。
- 低频 GUI 更新交给 React。
- 共享的游戏进度和经济数据放在 State。
- 需要同步到 React 的状态，通过 `updateInterface` 手动通知。

## updateInterface 是什么？

`updateInterface` 是 game/actions 调用 React 的桥。

文件 [src/state/updateInterface.ts](/home/laozhu/project/uncharted-waters-2/src/state/updateInterface.ts) 只声明了方法形状。真正的方法实现是在 [src/interface/Interface.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/Interface.tsx) 里绑定的：

```ts
updateInterface.general = (general) => {
  setPortId(general.portId);
  setBuildingId(general.buildingId);
  setTimePassed(general.timePassed);
  setGold(general.gold);
};
```

这意味着 actions 可以这样更新 GUI：

```ts
state.gold += amount;
updateGeneral();
```

而 `updateGeneral()` 内部会调用 `updateInterface.general(...)`，最终触发 React `setState`。

这个设计的好处是 game code 不需要直接 import React component；坏处是它是一个手动维护的桥，新加 UI 状态时需要同时修改 `updateInterface.ts` 和 `Interface.tsx`。

## World 和 Port 如何切换？

当前场景由 `state.portId` 判断：

- `state.portId === null`：玩家在 world map 航行。
- `state.portId !== null`：玩家在某个 port 内。
- `state.buildingId !== null`：玩家进入了 port 中的 building。

### 从 world 进入 port

`dock(position)` 会：

- 检查当前位置旁边是否有 port。
- 创建 `state.port = createPort(portId)`。
- 设置 `state.portId = portId`。
- 重置 Input。
- 调用 `updateGeneral()` 刷新 React GUI。
- 重置 `dayAtSea`。

### 从 port 回到 world

`setSail()` 会：

- 设置 `state.portId = null`。
- 清空 `state.buildingId`。
- 更新 wind/current/provisions 等 world GUI。
- 重置 Input。
- 调用 `updateGeneral()`。

## Game Loop 如何处理移动？

`world.update()` 和 `port.update()` 都会先调用 `PercentNextMove.update()`。

`PercentNextMove` 用 `performance.now()` 判断距离上次真实移动是否已经过了约 67ms：

- 没到移动时间：返回一个 0 到 1 之间的插值比例，`draw()` 用它让画面更平滑。
- 到了移动时间：返回 0，`update()` 才真正推进角色位置、时间、NPC 行为。

也就是说，游戏不是每一帧都改变逻辑位置，但每一帧都会绘制。这样可以让逻辑节奏稳定，同时画面仍然顺滑。

## Canvas 和 React 如何共存？

React 负责页面结构：

```text
Left UI | Center canvas/building/world map | Right UI
```

中心区域里有两种主要内容：

- `Camera`：显示 `<canvas id="camera" width="1280" height="800" />`。
- `Building`：当 `buildingId !== null` 时显示建筑 GUI，并隐藏 canvas。

Canvas 的 DOM 节点由 React 创建，但绘制上下文由 game scene 获取：

```ts
const canvas = document.getElementById('camera') as HTMLCanvasElement;
const context = canvas.getContext('2d', { alpha: false })!;
```

这样做让 Canvas 能嵌入 React 布局，同时避免 Canvas 绘制依赖 React rerender。

## F4 世界地图如何实现？

记录日期：2026-05-28

海上航行时按 `F4` 会显示世界地图覆盖层。这个功能由
`zhuguangjun2002 <zhuguangjun2002@163.com>` 在提交
`b9b529f`（`feat: add F4 world map`）中加入。

### 触发流程

- [src/input.ts](/home/laozhu/project/uncharted-waters-2/src/input.ts) 监听
  `keydown`，当按键是 `F4` 且不是重复触发时，设置 `pressedF4 = true`。
- [src/game/world/worldCharacters.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/worldCharacters.ts)
  在 world scene 的 `update()` 中读取 `Input.getPressedF4()`，切换
  `worldMapVisible`。
- 同一个 `update()` 会通过 `updateInterface.worldMap({ visible, position })`
  把显示状态和玩家当前 world position 传给 React。
- [src/interface/Interface.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/Interface.tsx)
  根据 `worldMap.visible` 渲染
  [src/interface/world/WorldMap.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/world/WorldMap.tsx)。

### 地图数据来源

世界地图小图不是从网上下载的图片，也不是外部地图服务。它使用的是项目本地游戏
数据：

- `src/data/assets/worldTilemap.wasm`：世界地图 tile 数据。
- `src/data/assets/dataAssets.ts`：把 `worldTilemap.wasm` 注册为 data asset。
- `src/assets.ts`：启动时通过 `fetch()` 把 binary data 加载为 `Uint8Array`。

海上实际航行地图也使用同一份 `worldTilemap`。在
[src/map.ts](/home/laozhu/project/uncharted-waters-2/src/map.ts) 中，world map
场景会设置：

```ts
tilemapColumns = WORLD_MAP_COLUMNS; // 2160
tilemapRows = 1080;
tilemap = Assets.data('worldTilemap');
tileset = Assets.images('worldTileset');
```

因此 F4 小图和实际航海地图是同源的，只是显示方式不同。

### 缩略图计算

F4 小图的 canvas 逻辑尺寸是 `360 x 180`，实际 world tilemap 尺寸是
`2160 x 1080`。二者正好都是 `2:1`，并且缩放比例是 `6:1`。

`WorldMap.tsx` 会为小图中的每个像素计算它对应的大地图 tile：

```ts
const worldX = Math.floor((x / MAP_WIDTH) * WORLD_MAP_COLUMNS);
const worldY = Math.floor((y / MAP_HEIGHT) * WORLD_MAP_ROWS);
const tile = worldTilemap[worldY * WORLD_MAP_COLUMNS + worldX] || 0;
```

然后用每个 tile 的**真实颜色**给小图上色：启动时从 `worldTileset` 采样每个 tile 值在白天行
（`row 0`）的平均色，建一张 128 项的调色板（`buildTilePalette()`，结果缓存），小图每个像素直接用
`palette[tile]` 上色。

这样小图就是世界地图的低保真缩略：冰盖白、沙漠土黄、森林绿、海洋蓝，全部和实际 tile 一致，
不再靠 tile 值范围去猜”海/陆/冰”。如果 tileset 采样失败（如 canvas 被跨域污染），退回最朴素的
`tile >= 50` 绿 / `tile < 50` 蓝。早期曾按 tile 值范围硬判冰盖，把温带大陆误染成白色，详见下文
Bug 记录“F4 小图把温带大陆画成冰盖”。

> 关于 tileset 布局：`worldTileset.png` 源图是 16px tile、128 列 × 31 行（行=时段变体）；
> `gameImages` 加载时 `upscale=2`，所以运行时 canvas 是 32px tile（4096 × 992），这也正是
> `map.ts` 里 `tileSize = 32` 的由来。`tile 0` 是深蓝海面，`tile 73` 是深绿森林（**不是**冰），
> `tile 81` 才是白色冰盖，`tile 89` 是土黄沙漠。

### 当前位置计算

玩家在真实 world map 中的位置也是按比例换算到小图上的：

```ts
const markerX = Math.floor((x / WORLD_MAP_COLUMNS) * MAP_WIDTH);
const markerY = Math.floor((y / WORLD_MAP_ROWS) * MAP_HEIGHT);
```

然后在小图上画一个红黄小方块作为船队当前位置标记。

### 当前限制

当前实现是基础版：

- 只有海陆双色图，不显示港口、地名、国界、洋流或经纬度。
- 按 `F4` 直接开关世界地图，没有实现原作的 `Navigation` 菜单层级。
- 小图只显示当前位置，不显示航线、目标港或发现状态。
- 如果浏览器、系统或笔记本键盘拦截功能键，可能需要先点击游戏画面获得焦点，或按
  `Fn + F4`。

### Bug 记录：F4 小图把温带大陆画成冰盖

记录日期：2026-05-30

问题现象：

- 起因是从 19. Alexandria 用”超远航线”深度搜索导航到 118. Nome（`x=2062, y=156`，靠近北极），
  想在 F4 小图上看清北极冰盖和海路，但小图只有海陆双色（`tile >= 50` 一律绿色），冰盖和普通陆地混成一片。
- 第一版修复**按 tile 值范围硬判冰盖**：把 tile `73`/`74`/`75`/`81` 画成白色。理由是这些值在温带带
  （`y` 约 `430–680`）不出现，看上去”只在高纬度”。
- 结果适得其反：玩家截图显示**澳大利亚、南部非洲、南美南部整片变成白色冰天雪地**，明显不对。

根因：

- 第一版只看了 `worldTilemap.wasm` 的 tile 值在**纬度上的分布**，没看这些 tile 在 `worldTileset` 里**真正
  长什么样**。tile 73 在南北两侧的温带陆地（西伯利亚、加拿大、澳南、南非、南美南部）也大量出现，按”高纬度
  =冰”一刀切就把这些温带大陆误染成白。
- 直接采样 tileset 才看清：白天行里 `tile 73 = rgb(7,91,65)` 深绿森林、`tile 65 = rgb(14,95,62)` 绿、
  `tile 89 = rgb(234,201,141)` 土黄沙漠、而**只有 `tile 81 = rgb(231,222,213)` 是白色冰盖**。也就是说
  73 根本不是冰，是普通森林/陆地。

修复（不再猜，直接用 tile 的真实颜色）：

- 启动时从 `worldTileset` 采样每个 tile 值在白天行（`row 0`）的平均色，建一张 128 项调色板
  （`buildTilePalette()`，缓存一次）。
- `drawBaseMap()` 每个像素改用 `palette[tile]` 上色，小图变成世界地图的低保真缩略：冰盖白、沙漠土黄、
  森林绿、海洋蓝，全部与实际 tile 一致。采样失败（canvas 跨域污染等）时退回 `tile >= 50` 绿 / `< 50` 蓝。
- tileset 布局坑：源图 16px tile，但 `gameImages` 以 `upscale=2` 加载，运行时 canvas 是 32px tile
  （4096 × 992，128 列 × 31 行），采样用的就是这个 canvas。

教训：判断地形要看 **tile 在 tileset 里的实际像素**，不能只凭 tile 值在地图上的分布去猜语义。

验证：

- 用调色板离线渲染 720 × 360 缩略图核对：大陆为绿、撒哈拉/阿拉伯/澳洲中部/戈壁为土黄、南极为白、
  北极仅最顶端一圈薄冰，澳大利亚不再是白色。
- `npm run build`、`npm test`（84 项全过）、`npm run lint` 均通过。

### Bug 记录：F4 小图顶部（北极/加拿大北部）被裁掉

记录日期：2026-05-30

问题现象：

- 对比脚本导出的 `world-map.png`（全尺寸、正确）后发现：F4 小图里**加拿大北部、北极整片被截断没有了**，
  顶端像被一条线切掉。自动航行期间尤其明显。

定位：

- 先怀疑是渲染/降采样问题，于是把 `drawBaseMap()` 的逻辑离线复刻成 720 × 360 缩略图——结果**北部完整、
  毫无截断**，和 `world-map.png` 一致。说明**渲染没问题，地图数据也没问题**，是**显示布局把顶部裁掉了**。
- 根因在 F4 浮层的布局：外层 `flex items-center`（垂直居中）。整块面板很高 = 540px 的地图 canvas + 下方
  一大堆控件（港口列表、状态栏、深度搜索面板，自动航行时还多一块进度面板）。当面板比视口还高时，垂直居中
  会把**面板顶部（也就是地图最上方的北极/加拿大北部）顶到视口上沿之外**，于是被裁掉。自动航行时面板最高，
  裁得最狠——正好对应”自动航行期间北极看不到”。
- `world-map.png` 不受影响，因为它是独立文件、用看图工具全图查看，不受浮层高度限制。

修复（布局，不是渲染）：

- 外层浮层改为 `flex items-start justify-center overflow-y-auto ... p-4`：面板**顶端对齐**且可滚动。地图在
  最上方，北极始终第一眼可见；面板过高时下方控件滚动，而不是把顶部裁掉。
- canvas 加 `aspect-[2/1] h-auto w-[1080px] max-w-[92vw]`：保持 2:1 比例的同时按视口收缩，窄屏也能放下整图。

教训：地图”缺了一块”先别急着改渲染——先离线复刻渲染逻辑核对。这次渲染是对的，错在**浮层用居中布局把超高
内容的顶部裁掉**。

验证：

- 离线复刻 `drawBaseMap()` 渲染确认北部完整（排除渲染/数据问题）。
- `npm run build`、`npm test`（84 项全过）、`npm run lint` 均通过。

## 存档系统

记录日期：2026-05-29

按 `F3` 打开存档面板，可在 10 个存档位中保存、读取、删除记录，或重新开始游戏。
每个存档位显示游戏内日期和位置（港口名，或 `At Sea`），方便区分。

### 存储格式

存档写入 `localStorage` 的 `saveSlots` 键，是一个长度为 10 的数组，每个元素是
`SaveSlot | null`：

```ts
interface SaveSlot {
  meta: { savedAt: number; timePassed: number; portId: string | null };
  data: PersistedState; // State 中可序列化的字段
}
```

`PersistedState` 只挑选 State 中可序列化的字段（`portId`、`timePassed`、`fleets`、
`gold`、`quests`、`items`、`mates` 等）。运行时场景对象（`world`、`port`）和派生字段
（`wind`、`current`、`playerFleet`、`seaArea`）不保存，读档时重建或重算。

`autoNavigation` **会**保存（含整条 `path` 和 `waypointIndex`），这样进行中的航行——
尤其是”超远航线”那种计算代价很高的深度搜索路线——读档后能继续，而不是凭空消失。
保存时会把每帧重建的 `debug` 字段置空（保持存档精简）；读档时同样把 `debug` 复位为 `null`。
旧存档没有该字段时回退为默认值（`getDefaultAutoNavigation()`）。详见下文 Bug 记录
“读档/刷新后自动导航航线消失”。

### 读档（运行时切换）

`loadFromSlot()` 直接**原地修改**全局 `state` 单例（因为整个代码库都按引用导入它），
然后把 `state.world`/`state.port` 清空，让 game loop 在下一帧重建对应场景，并调用
`updateGeneral()`、`setDockedFleetPositions()` 等重新初始化界面。

游戏启动时**不再自动读档**：`state.ts` 始终从默认值开始，存档面板会在开机时自动弹出，
让玩家选择读档或直接开始新游戏。

### 海上存档与位置同步

航海时玩家的实时坐标原本只存在 `worldPlayer` 闭包里，只有靠岸 `dock()` 时才写回 state。
为了让海上存档也能记录准确位置，`worldCharacters.update()` 每帧把
`player.position()` 同步回 `state.fleets[1].position`。

### 面板与 game loop 的协作

存档面板是 React 组件（[src/interface/common/SaveMenu.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/common/SaveMenu.tsx)），
由 React 拥有显隐状态。面板打开时会把 `uiState.saveMenuOpen` 置为 `true`，
[src/app.ts](/home/laozhu/project/uncharted-waters-2/src/app.ts) 的 game loop 读到该标志后
暂停 world/port 更新（避免船在面板后面继续漂移），面板关闭时再 `Input.reset()` 清掉残留按键。

破坏性操作（覆盖、读档、删除、重新开始）使用游戏内风格的确认弹窗
[src/interface/common/ConfirmDialog.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/common/ConfirmDialog.tsx)，
而不是浏览器原生 `window.confirm`。

### 当前限制

- 存档保存在 `localStorage`，仅限单一浏览器，未同步到 server。
- NPC 舰队位置不在存档范围内。

### Bug 记录：读档/刷新后自动导航航线消失

记录日期：2026-05-30

问题现象：

- 用”超远航线”深度搜索规划了一条很长的航线（如 19. Alexandria → 118. Nome），开始自动导航。
- 中途存档、刷新页面、再读档后，F4 小图上的航线和导航点全都没了，必须重新跑一遍（很慢的）深度搜索。

根因：

- `PersistedState` 原本**不含** `autoNavigation`，注释说它”读档时重建或重算”。
- 但 `loadFromSlot()` 实际上只是把 `state.autoNavigation` 复位成 `getDefaultAutoNavigation()`，
  **既没重建也没重算**——于是进行中的航线直接丢失。
- 普通预览策略也许还能重算，但深度搜索路线计算代价很高、且常规预览本来就会失败，重算并不现实。
- 另外游戏启动时不自动读档，所以单纯刷新浏览器=完全重置；只有”存档→读档”这条路径才会保留船位
  （`fleets`），却偏偏把航线丢了。

修复（让航线随存档一起持久化）：

- 把 `autoNavigation` 加进 `PersistedState`。
- `saveToSlot()` 保存 `{ ...state.autoNavigation, debug: null }`——`debug` 是每帧重建的诊断信息，
  置空以保持存档精简、避免存进过期数据。
- `loadFromSlot()` 改为 `state.autoNavigation = data.autoNavigation ? { ...data.autoNavigation, debug: null } : getDefaultAutoNavigation()`：
  读档后航线、`waypointIndex`、目标港、策略全部恢复，船从存档时的海上坐标继续按原航线航行；旧存档没有该
  字段时回退默认值（向后兼容）。

说明（仍是已知限制）：游戏启动不自动读档，所以**不存档**直接刷新浏览器仍会清空一切（含航线）——这属于
”没有自动存档”这个既有设计，不在本次修复范围。本次只保证”存档→读档”能续航。

验证：

- 新增 `src/state/save.test.ts`：存档→清空→读档后 `autoNavigation`（含 `path`/`waypointIndex`/策略）
  完整恢复；`debug` 被置空；旧存档（无该字段）回退默认值。3 项均通过。
- `npm test`（84 项全过）、`npm run lint`、`npm run build` 均通过。

## 调试传送

记录日期：2026-05-29

仅供测试：在 F4 世界地图面板里把玩家瞬移到指定位置，支持经纬度、世界格 x/y、港口、点击地图
四种输入。整套功能用 `DEBUG`（`src/constants.ts`）门控，生产构建里不渲染。

四种输入最终都归一为一个世界格坐标，交给 `actionsWorld.ts` 的 `teleportToSea()` /
`teleportToPort()`，复用与读档相同的“原地改 state + 清空场景对象触发重建”套路。落点会经
`nearestSeaPosition()` 吸附到最近可航行海格，避免落在陆地。

完整的规划、思路、设计与实现见
[DEBUG_TELEPORT.md](/home/laozhu/project/uncharted-waters-2/DEBUG_TELEPORT.md)；坐标换算细节见
[WORLDMAP.md](/home/laozhu/project/uncharted-waters-2/WORLDMAP.md#坐标系与经纬度换算)。

## 自动导航现状

记录日期：2026-05-28

详细设计、A\* 和 waypoint 解释、`8 x 8` / `4 x 4` 策略、bug 记录和后续测试记录见
[AUTO_NAVIGATION.md](/home/laozhu/project/uncharted-waters-2/AUTO_NAVIGATION.md)。后续自动导航问题优先维护该文档。

当前已实现自动导航 MVP：玩家可以在 F4 世界地图选择目标港，系统规划海上路径，船队按
waypoint 自动航行，到达目标港附近后停止。详细行为以
[AUTO_NAVIGATION.md](/home/laozhu/project/uncharted-waters-2/AUTO_NAVIGATION.md) 为准。

### 当前已有行为：保持航向

海上航行时，玩家按方向键后，`worldCharacters.update()` 会读取
`Input.getDirection({ includeOrdinal: true })`，并调用 `player.setHeading(direction)`。

如果玩家松开方向键，代码不会主动清空 heading。因此船会继续沿最后一次输入方向航行：

```ts
const direction = Input.getDirection({ includeOrdinal: true });

if (direction) {
  player.setHeading(direction);
}

player.updateSpeed();

const heading = player.heading();

if (heading) {
  player.move(heading, collision);
}
```

这更接近“保持当前航向”的基础航行行为，不是自动导航到目标港。

### `destination` 不是航线终点

[src/game/world/worldPlayer.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/worldPlayer.ts)
中有 `destination` 字段，但它只表示下一次移动计算得到的短距离目标点：

- `move()` 根据当前 heading、船速、风向、桨船/帆船差异和碰撞计算下一小段位置。
- `update()` 把当前位置推进到这个短距离 `destination`。
- `position(percentNextMove)` 用它做绘制插值。

因此这个 `destination` 不是玩家选择的目的港，也不是跨地图航线。

### NPC 也没有寻路

[src/game/world/worldNpc.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/worldNpc.ts)
目前是随机方向移动或静止。`randomDirection()` 只是提高继续沿当前方向移动的概率，并不
会朝某个港口或目标坐标寻路。

README 的“后续考虑”里提到过“为 NPC fleets 增加 pathfinding”，说明原作者考虑过寻路，
但目前还没有实现。

### 后续可扩展的自动导航状态和入口

如果要继续接近原作风格，仍可继续扩展这些状态和入口：

- 自动导航开关。
- 目标港或目标世界坐标。
- 当前航线路径或下一段航向。
- 目标选择 UI。
- 自动导航过程中的停止/取消逻辑。
- 到达目标港附近后的提示或自动靠港逻辑。

### 实现切入点

比较合适的实现方向：

- 在 State 中新增类似 `autoNavigation` 的状态，保存目标港、目标坐标、当前路径和启用状态。
- 在 `worldCharacters.update()` 中，如果自动导航启用，就由自动导航逻辑计算 heading；否则继续读取玩家方向输入。
- 复用 `map.collisionAt()` 判断海陆障碍。
- 复用 `portData.ts` 的港口坐标作为目的地数据来源。
- 接近目标港时复用已有 `dock(player.position())`，或先显示到达提示再由玩家手动靠港。
- 如果要在 F4 世界地图中展示航线，可以扩展 `WorldMap`，把目标点和路径按同样比例画到小图上。

### MVP 实现计划

第一版自动导航先做最小闭环：

- 玩家在 F4 世界地图中选择目标港。
- 系统规划一条到目标港附近的海上路径。
- 船队自动沿路径航行。
- 到达目标港附近后停止自动导航，并保留现有按 `E` 靠港行为。
- 玩家手动按方向键时取消自动导航，把控制权还给玩家。

暂不做这些扩展：

- 多目标贸易路线。
- 自动补给。
- 自动进入港口建筑。
- 根据风向/洋流动态优化航线。
- NPC 舰队寻路。

### 建议实现步骤

1. 新增自动导航状态

   在 State 中新增类似结构：

   ```ts
   autoNavigation: {
     enabled: boolean;
     targetPortId: string | null;
     targetPosition: Position | null;
     path: Position[];
     waypointIndex: number;
   }
   ```

   需要注意旧存档兼容：读取 `localStorage` 旧存档时，如果没有 `autoNavigation`，应使用默认值。

2. 实现寻路

   世界地图是 `2160 x 1080`，逐 tile A\* 搜索成本较高。第一版可以使用粗网格：

   - 每 `6 x 6` 或 `8 x 8` 个 world tile 合成一个路径节点。
   - 节点可航行性通过 `worldTilemap` 或 `map.collisionAt()` 判断。
   - x 方向必须支持环绕，避免跨太平洋航线绕远路。
   - 输出路径时再把粗网格节点换算回 world tile 坐标。

3. 接入航行控制

   在 `worldCharacters.update()` 中调整 heading 来源：

   - 如果玩家按了方向键，取消自动导航并使用玩家输入。
   - 如果自动导航启用，自动导航逻辑根据当前 waypoint 计算 `n/e/s/w/ne/se/sw/nw`。
   - 如果没有自动导航，保留当前“保持航向”行为。

4. 接入 F4 世界地图

   扩展 `WorldMap`：

   - 显示目标港选择入口。
   - 显示当前目标港。
   - 显示取消自动导航入口。
   - 在小图上画目标点和路径。

5. 到达处理

   当玩家位置接近目标港坐标时：

   - 停止自动导航。
   - 将 heading 清空，让船停下。
   - 第一版不自动进港，沿用当前按 `E` 靠港。

6. 测试重点

   - 从地图东西两侧之间导航时使用 x 方向环绕。
   - 规划出的路径不穿过陆地。
   - 到达目标港附近后自动导航停止。
   - 手动方向输入会取消自动导航。
   - 旧存档没有 `autoNavigation` 字段时仍能启动。

### Bug 记录：Lisbon 到 Barcelona 无法规划航线

记录日期：2026-05-28

问题现象：

- 玩家从 Lisbon 附近出海。
- 打开 F4 世界地图。
- 选择 `4. Barcelona`。
- 点击“自动导航”。
- 界面提示“无法规划到 Barcelona 的海上航线”。

原因：

- 第一版自动导航使用 `12 x 12` world tile 的粗网格做 A\* 寻路。
- Lisbon 到 Barcelona 需要经过近岸和狭窄海域，尤其是直布罗陀/西地中海入口附近。
- `12 x 12` 粗网格节点中心点容易落在陆地或近岸碰撞格上，把实际可通行海路误判为堵塞。
- 因此 A\* 搜索不到从 Lisbon 附近海面到 Barcelona 附近海面的连通路径。

修复方法：

- 将自动导航默认寻路网格从 `12 x 12` 调整为 `4 x 4`。
- 更细的网格能表示近岸和海峡里的可通行水道，Barcelona 这类目标港可以正常规划。
- 相关常量在
  [src/game/world/autoNavigation.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.ts)
  中的 `DEFAULT_GRID_SIZE`。

验证：

- `npm run lint`
- `npm test -- --runInBand src/game/world/autoNavigation.test.ts`

### Bug 记录：Lisbon 到 Hormuz 在非洲近岸卡住

记录日期：2026-05-28

问题现象：

- 玩家从 Lisbon 附近出海。
- 打开 F4 世界地图。
- 选择 Hormuz 并启动自动导航。
- 船队航行到非洲西岸附近时贴住陆地，无法继续沿航线前进。

原因：

- 第一版自动导航在 `4 x 4` 粗网格上规划长途路径，长途航线会过于贴近海岸。
- `worldPlayer.move()` 实际移动时会使用船体碰撞和局部避障，船可能无法精确抵达贴近海岸的
  waypoint。
- 自动导航原先直接按 waypoint 方向选择航向，常常选择斜向或单一轴向继续贴岸推进。
- 在非洲西岸等复杂海岸线附近，如果当前主航向被陆地挡住，船会连续多步不动，但自动导航
  仍持续朝同一个方向修正，最终卡住。

修复方法：

- 长途默认寻路网格调整为 `8 x 8`，减少长途航线贴岸程度。
- 保留 `4 x 4` 作为 fallback：如果粗网格找不到路径，再尝试细网格。
- waypoint 到达半径扩大到 `DEFAULT_GRID_SIZE * 4`，但最终目标点使用较小的
  `REACHED_TARGET_DISTANCE`，避免过早判定到达导致离港太远。
- 自动导航状态新增 `lastPosition`、`stagnantMoves` 和 `useAlternateAxis`。
- `getAutoNavigationHeading()` 会检测连续停滞。如果多次位置几乎不变，会临时改用另一轴向，
  例如主方向向南被海岸挡住时，改向西离岸。
- 自动导航航向改为单轴优先，不再直接使用斜向追 waypoint，降低近岸船体碰撞卡死概率。
- 相关常量在
  [src/game/world/autoNavigation.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.ts)
  中的 `DEFAULT_GRID_SIZE`、`FINE_GRID_SIZE`、`REACHED_WAYPOINT_DISTANCE`、
  `REACHED_TARGET_DISTANCE` 和 `STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS`。

验证：

- 增加 `getAutoNavigationHeading()` 的 near-waypoint 和 alternate-axis 单元测试。
- 增加 Lisbon -> Hormuz 的完整仿真测试：使用真实 `worldTilemap.wasm`、真实
  `calculateDestination()` 和自动导航逻辑运行。如果连续 30 步位置几乎不变，测试失败。
- `npm run lint`
- `npm test -- --runInBand`

## 新增功能应该改哪里？

### 新增一个 port building 行为

通常会涉及：

- `src/data/buildingData.ts`：建筑数据。
- `src/building.ts`：building 创建和入口逻辑。
- `src/interface/port/`：新增或修改 React building UI。
- `src/state/actionsPort.ts`：新增会改变 State 的动作。
- `src/state/updateInterface.ts` 和 `Interface.tsx`：如果需要新增 GUI 状态同步。

### 新增 world 航行规则

通常会涉及：

- `src/game/world/`：movement、ship speed、wind/current、NPC fleet 行为。
- `src/state/actionsWorld.ts`：改变 world 状态或刷新 world GUI。
- `src/state/selectors.ts`：新增派生计算。
- 对应 `*.test.ts`：规则和计算逻辑应补测试。

### 新增一种可购买物品或船只

通常会涉及：

- `src/data/itemData.ts` 或 `src/data/shipData.ts`。
- `src/interface/port/` 中对应商店或 shipyard UI。
- `src/state/actionsPort.ts` 中购买、出售、库存或金钱逻辑。
- `src/state/selectorsFleet.ts` 或相关 selectors。

## 当前架构的优点和注意点

优点：

- Canvas 高频绘制和 React GUI 分离，性能路径清晰。
- `state/actions/selectors` 让核心游戏数据集中管理。
- `world` 和 `port` scene 结构类似，便于扩展。
- Assets 统一加载，游戏启动时资源准备过程明确。

注意点：

- `state` 是可变全局对象，修改后要记得调用对应 `updateInterface` 方法刷新 GUI。
- `updateInterface` 是手动桥接，新字段需要两边一起维护。
- `Camera` 不应该依赖 React rerender，Canvas 绘制逻辑应留在 `src/game/`。
- 高频状态不要轻易放进 React state，例如角色逐帧位置、地图滚动、动画插值。
- 修改规则、状态或工具函数时，应补充 Jest 测试。

## 阅读源码建议

建议按这个顺序阅读：

1. [src/app.ts](/home/laozhu/project/uncharted-waters-2/src/app.ts)：了解启动流程和主循环。
2. [src/state/state.ts](/home/laozhu/project/uncharted-waters-2/src/state/state.ts)：了解全局 State 保存什么。
3. [src/interface/Interface.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/Interface.tsx)：了解 React GUI 如何挂载和更新。
4. [src/game/world/world.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/world.ts)：了解 world scene 的 update/draw。
5. [src/game/port/port.ts](/home/laozhu/project/uncharted-waters-2/src/game/port/port.ts)：了解 port scene 的 update/draw。
6. [src/state/actionsWorld.ts](/home/laozhu/project/uncharted-waters-2/src/state/actionsWorld.ts) 和 [src/state/actionsPort.ts](/home/laozhu/project/uncharted-waters-2/src/state/actionsPort.ts)：了解玩家操作如何改变游戏状态。

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

- `src/game/world/`：world map、fleet、wind/current、ship speed、world NPC。
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

- `state.ts`：全局 State 初始值，也会读取 `localStorage` 中的 saved state。
- `actionsWorld.ts`：world 相关动作，例如 `dock()`、`setSail()`、`worldTimeTick()`、`updateWorldStatus()`。
- `actionsPort.ts`：port/building 相关动作，例如 `enterBuilding()`、`exitBuilding()`、`buyUsedShip()`、`supplyShip()`。
- `selectors.ts`、`selectorsFleet.ts`：从 State 计算派生信息。
- `updateInterface.ts`：game/actions 通知 React 刷新的桥接对象。

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

然后用很简单的规则把 tile 转成颜色：

- `tile >= 50`：认为是陆地，画绿色。
- `tile < 50`：认为是海洋，画蓝色。

也就是说，这张小图不是把 `worldTileset.png` 的实际画面缩小，而是对
`worldTilemap.wasm` 做采样，生成一张低保真的海陆分布图。

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

## 自动导航现状

记录日期：2026-05-28

当前代码没有实现原作那种“选择目的地后自动航行到目标港”的自动导航，也没有完整预留
玩家自动导航接口。

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

### 缺失的自动导航状态

如果要实现原作风格的自动导航，目前还缺这些状态和入口：

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

- 第一版自动导航使用 `12 x 12` world tile 的粗网格做 A* 寻路。
- Lisbon 到 Barcelona 需要经过近岸和狭窄海域，尤其是直布罗陀/西地中海入口附近。
- `12 x 12` 粗网格节点中心点容易落在陆地或近岸碰撞格上，把实际可通行海路误判为堵塞。
- 因此 A* 搜索不到从 Lisbon 附近海面到 Barcelona 附近海面的连通路径。

修复方法：

- 将自动导航默认寻路网格从 `12 x 12` 调整为 `4 x 4`。
- 更细的网格能表示近岸和海峡里的可通行水道，Barcelona 这类目标港可以正常规划。
- 相关常量在
  [src/game/world/autoNavigation.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.ts)
  中的 `DEFAULT_GRID_SIZE`。

验证：

- `npm run lint`
- `npm test -- --runInBand src/game/world/autoNavigation.test.ts`

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

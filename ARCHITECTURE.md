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

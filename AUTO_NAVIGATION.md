# 自动导航设计与问题记录

记录日期：2026-05-28

本文档集中记录自动导航功能的设计、实现、术语、当前限制、测试方法和 bug 修复记录。

## 当前功能范围

当前自动导航是第一版 MVP：

- 玩家在 F4 世界地图中选择目标港。
- 玩家可以选择自动导航策略，并在 F4 世界地图上预览该策略生成的导航点。
- 系统规划一条到目标港附近的海上路径。
- 船队自动沿路径航行。
- 到达目标港附近后停止自动导航。
- 第一版不自动进港，仍沿用当前按 `E` 靠港。
- 玩家手动按方向键时取消自动导航，把控制权还给玩家。

暂不做：

- 多目标贸易路线。
- 自动补给。
- 自动进入港口建筑。
- 根据风向/洋流动态优化航线。
- NPC 舰队寻路。

## 相关代码

- [src/game/world/autoNavigation.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.ts)：寻路、waypoint、航向计算、卡住检测。
- [src/game/world/autoNavigation.test.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.test.ts)：自动导航单元测试和 Lisbon -> Hormuz 仿真测试。
- [src/game/world/worldCharacters.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/worldCharacters.ts)：海上 update loop 中接入自动导航 heading。
- [src/state/actionsWorld.ts](/home/laozhu/project/uncharted-waters-2/src/state/actionsWorld.ts)：启动、取消、更新自动导航。
- [src/state/state.ts](/home/laozhu/project/uncharted-waters-2/src/state/state.ts)：`autoNavigation` 状态。
- [src/interface/world/WorldMap.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/world/WorldMap.tsx)：F4 世界地图中的目标港选择、开始/取消按钮、路径显示和状态反馈。
- [src/interface/world/AutoNavigationDebugOverlay.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/world/AutoNavigationDebugOverlay.tsx)：海上航行画面的自动导航诊断浮层，用于显示当前 waypoint、距离、航向、A\* 目标和卡住原因。
- [src/data/portData.ts](/home/laozhu/project/uncharted-waters-2/src/data/portData.ts)：目标港坐标来源。

## 自动导航状态

自动导航状态保存在全局 State 中：

```ts
autoNavigation: {
  enabled: boolean;
  targetPortId: string | null;
  targetPosition: Position | null;
  strategyId: AutoNavigationStrategyId;
  path: Position[];
  waypointIndex: number;
  lastPosition: Position | null;
  stagnantMoves: number;
  useAlternateAxis: boolean;
  debug: AutoNavigationDebug | null;
}
```

字段含义：

- `enabled`：自动导航是否启用。
- `targetPortId`：目标港 ID。
- `targetPosition`：目标港附近的可停靠海面坐标，不是港口陆地坐标。
- `strategyId`：启动自动导航时使用的路径策略。
- `path`：寻路算法生成的一串 waypoint。
- `waypointIndex`：当前正在追踪的 waypoint 下标。
- `lastPosition`：上一轮自动导航检查时的船队位置。
- `stagnantMoves`：连续几次位置几乎没有变化。
- `useAlternateAxis`：卡住时是否临时改用另一轴向航行。
- `debug`：当前自动导航诊断快照。F4 世界地图和海上诊断浮层都会读取它，显示当前追踪的 waypoint、距离、判定半径、航向、海况、局部 A\* 目标和失败/切轴原因。

## A\* 是什么？

A\* 是一种常见寻路算法。它会在地图格子里找一条从起点到终点的路线，并尽量少走冤枉路。

它每次评估：

```text
已经走了多远 + 离目标还大概多远
```

然后优先探索“看起来更接近目标”的方向。

在本项目中：

- 海面格子可以走。
- 陆地格子不能走。
- 离目标更近的格子优先考虑。
- x 方向支持环绕，例如太平洋左右边界可以连起来。

## waypoint 是什么？

waypoint 是自动导航路径上的中转点。

自动导航不会让船一次性直接追 Hormuz。它会先规划一串中间点：

```text
当前位置 -> waypoint 1 -> waypoint 2 -> waypoint 3 -> 目标港附近
```

船队每次只追当前 waypoint。靠近当前 waypoint 后，`waypointIndex` 前进，船再追下一个 waypoint。

## 为什么不用每个 tile 直接寻路？

世界地图尺寸是 `2160 x 1080` 个 tile。如果直接在每个 tile 上做 A\*，节点数量太大：

```text
2160 * 1080 = 2,332,800 个 tile
```

这对浏览器运行时开销太高，也会让测试和调试变慢。

因此当前实现使用粗网格：把多个 world tile 合成一个寻路节点。

## `8 x 8` 和 `4 x 4` 是什么意思？

`8 x 8` 表示每 8 个 world tile 合成一个寻路格子。

世界地图是 `2160 x 1080`：

```text
2160 / 8 = 270 列
1080 / 8 = 135 行
```

自动导航不是在 `2160 x 1080` 个 tile 上找路，而是在 `270 x 135` 个大格子上找路。

每个大格子的中心点会换算回 world tile 坐标，作为 waypoint。例如：

```ts
worldX = gridX * 8 + 4;
worldY = gridY * 8 + 4;
```

`4 x 4` 同理，只是更精细：

```text
2160 / 4 = 540 列
1080 / 4 = 270 行
```

## 为什么长途默认用 `8 x 8`？

长途路线如果用太细的网格，例如 `4 x 4`，A\* 会倾向于找“最短路线”，容易贴着海岸走。

但游戏里的船有体积，移动时还会做碰撞和局部避障。看起来是海面的近岸 waypoint，实际航行时可能过于贴岸，船会卡住。

`8 x 8` 更粗，路线更概略，通常会离岸更远，长途航线更稳定。

## 为什么保留 `4 x 4` fallback？

`8 x 8` 太粗时，某些狭窄海峡会被误判为过不去。

例如 Lisbon 到 Barcelona 需要经过直布罗陀附近。如果网格太粗，海峡可能被陆地盖住，A\* 会认为没有路。

所以当前逻辑是：

```text
先用 8 x 8 给整条路线寻路
  成功 -> 使用这条 8 x 8 路线
  失败 -> 改用 4 x 4 给整条路线重新寻路
```

## 当前是否交叉使用 `8 x 8` 和 `4 x 4`？

不会。

当前实现是：**要么整条路线使用 `8 x 8`，要么整条路线使用 `4 x 4`。**

也就是说：

```text
尝试 8 x 8 全程路线
  成功 -> 使用 8 x 8 全程路线
  失败 -> 使用 4 x 4 重新规划全程路线
```

当前没有做这种“分段混合精度寻路”：

```text
Lisbon 附近/直布罗陀：4 x 4
大西洋/印度洋远海：8 x 8 或 12 x 12
红海/波斯湾近岸：4 x 4
```

分段混合精度更理想，但实现复杂度更高。当前版本为了简单可靠，先采用“粗网格优先，失败才整体 fallback 到细网格”。

## 当前可选导航策略

记录日期：2026-05-28

F4 世界地图现在可以选择不同自动导航策略，并在点击“预览航线”后一次计算和显示三种策略的导航点。

当前策略配置在
[src/game/world/autoNavigation.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.ts)
的 `AUTO_NAVIGATION_STRATEGIES` 中：

- `稳健航线`：默认策略。先用 `8 x 8` 规划整条路线；如果失败，再用 `4 x 4` 重新规划整条路线。
- `细致航线`：直接使用 `4 x 4` 规划整条路线。它更容易通过近岸和海峡，但长途路线可能更贴岸。
- `远海航线`：先用 `12 x 12` 规划整条路线；如果失败，再退回 `8 x 8` 和 `4 x 4`。它适合观察更粗、更远离海岸的长途路线，但可能过不了狭窄海峡。
- `超远航线`：异步深度搜索。F4 界面**始终显示**”深度搜索”按钮（早期只在三种常规预览全部失败时才出现；但粗网格预览“成功”并不代表贪心跟随能走通——例如 `稳健航线` 从 Nome 到 Santa Barbara 会卡在太平洋岛链的内凹海湾，需要随时能切到超远航线，详见下文 Bug 记录）。点击后在后台分块运行 A\*（每 3000 个节点暂停一次，更新状态栏节点计数和脉冲进度条，界面保持响应）。它让昂贵的 tile 级搜索只在窄水道附近局部展开，长途段始终走 `4 x 4` 粗网格：① 先用 `4 x 4`（带海岸惩罚）从起点向目标做长途搜索，目标是开阔水域则直接到达。② 否则两端落在**不同的粗网格连通块**——一端是主海域、另一端是粗网格无法连入的窄水道港口（如 `98. Changan`，无论它是起点还是终点）；此时从两端各做一次粗网格泛滥，**节点更多的那次就是主海域**，它记下离被困港口最近的可达格子，即外海一侧的**水道口**。③ 用 **tile 级（`1 x 1`，关闭海岸惩罚、带节点上限）**搜索穿过被困港口与水道口之间的短水道，再拼接到长途航段上（被困的是起点时，长途段反向拼接）。进度跨阶段累计。关键在于半个地球的长途段**永不**在 tile 级展开，避免 Lisbon -> Changan 这种探索约 40 万节点后失败的情况。路线找到后以绿色显示，点击”自动导航”直接使用此路径出发，不再重算。详见下文 Bug 记录“Lisbon 到 Changan”“Changan 到 Jamaica”。

这些策略目前仍然是”整条路线使用同一种网格精度”。即使 `远海航线` 最后 fallback 到
`8 x 8` 或 `4 x 4`，也是整条路线重新规划，不是分段混合。

F4 地图显示规则：

- 蓝色路线：`稳健航线` 预览路线。
- 橙色路线：`细致航线` 预览路线。
- 紫色路线：`远海航线` 预览路线。
- 绿色路线：`超远航线` 深度搜索路线。
- 黄色路线：当前正在执行的自动导航路线。
- 切换港口时不会立刻重新寻路，避免长途路线计算导致界面卡住。
- 点击“预览航线”时才计算三种预览路线，界面会先显示“计算中”。
- 切换策略只决定“自动导航”实际使用哪条路线，不会重新计算路线。
- 点击“自动导航”时，会使用当前选中策略对应的已预览路线启动实际航行。
- A\* 搜索有最大搜索节点上限。F4 预览会按直线距离使用不同预算：近距离目标使用较高预算，避免 Lisbon -> Barcelona 这类正常近岸路线被误判失败；远距离或复杂目标使用较低预算，某条策略超过上限后会返回“无路线”，避免 F4 界面长时间停在“计算中”。注意 `98. Changan` 之类位于极窄水道尽头的港口，预览（粗网格）会返回“无路线”，但这并非真的没有海路——需要用“深度搜索”：它在目标附近用 tile 级搜索接驳窄水道，详见 Bug 记录“Lisbon 到 Changan 深度搜索探索约 40 万节点后失败”。
- 三种策略预览会共享相同网格精度的计算结果，避免 `8 x 8`、`4 x 4` 在同一次预览中重复计算。
- F4 预览使用轻量寻路，不计算昂贵的海岸惩罚，只用于比较路线和确认大致连通性；实际启动自动导航时仍会使用完整路径和航行逻辑。
- 预览和实际寻路都开启**线段通海护栏**（`useSegmentClearance`，端点 48px 内豁免），相邻两个网格之间的连线必须全程是海，避免粗网格“跳过”巴拿马地峡这类窄实心陆地；超远目标因此可能在远海预览返回“无路线”，应改用“深度搜索”。详见 Bug 记录“远海预览穿过巴拿马地峡 + 小地图横跨北美的横线”。
- 小地图绘制路线时会处理东西**接缝环绕**：当相邻两点 map-x 跳变超过半张图宽（说明这段是跨太平洋接缝的短跳），会拆成两段分别从左右两边出画，而不是横贯整图画一条直线。
- 自动导航运行中会显示完成百分比、已通过导航点数、剩余导航点数、连续停滞次数和当前坐标。
- 自动导航运行中还会显示诊断信息：当前 waypoint 坐标、距离、判定半径、当前航向、当前位置/目标点的海况、局部 A\* 绕行目标和新增航点数。F4 地图会用粉色框标记当前 waypoint，用橙色框标记局部 A\* 目标。
- 关闭 F4 回到航行画面后，如果发生停滞、局部 A\* 插入或近岸切轴，画面左上会显示自动导航诊断浮层，并在 waypoint 位于当前视野内时标出 `WP N`。

进度目前按 waypoint 推进计算：

```text
完成百分比 = 已经跳过的 waypoint 数 / 总 waypoint 数
```

因此如果船卡在某个区域，“已通过导航点”会长时间不变，同时“连续停滞”数字会升高。如果触发
`useAlternateAxis`，F4 面板会显示“脱困中”。

## 航向如何从 waypoint 计算？

`getAutoNavigationHeading()` 会读取当前位置和当前 waypoint，然后调用 `getDirectionToPosition()` 算出下一步 heading。

当前策略会区分开阔海面和近岸/海峡：

- 如果当前位置周围 `DIAGONAL_OPEN_SEA_RADIUS` 范围内都是海面，且 x/y 两轴都需要移动，会直接使用斜向 heading，例如 `ne`、`se`、`sw`、`nw`。
- 如果靠近海岸、海峡或障碍，自动导航会回到单轴优先：x 方向差距更大时走 `e`/`w`，y 方向差距更大时走 `n`/`s`。
- 如果某一轴已经接近目标，则只走另一轴。
- 触发 `useAlternateAxis` 脱困时，仍会临时使用另一轴向，帮助船从近岸碰撞中离开。

这样做是为了避免开阔海面长时间“横向一步、纵向一步”的抖动，同时保留近岸单轴航行对船体碰撞更稳定的优点。

## 如何判断卡住？

自动导航会记录上一轮位置：

```ts
lastPosition;
```

如果连续多次位置几乎没有变化，就累计：

```ts
stagnantMoves;
```

超过阈值后，设置：

```ts
useAlternateAxis = true;
```

这表示临时改用另一轴向。例如主方向向南被海岸挡住时，尝试向西离岸。船通过当前 waypoint 后，`useAlternateAxis` 会重置。

## 到达判定

当前有三类到达距离：

- 普通 waypoint：`REACHED_WAYPOINT_DISTANCE`（普通策略 = 32px）
- 超远航线开阔海域 waypoint：`DEEP_ROUTE_OPEN_SEA_REACHED_WAYPOINT_DISTANCE`（= 64px）
- 超远航线近岸 waypoint：`DEEP_ROUTE_COASTAL_REACHED_WAYPOINT_DISTANCE`（= 12px）
- 超远航线危险近岸 waypoint：`DEEP_ROUTE_HAZARDOUS_COAST_REACHED_WAYPOINT_DISTANCE`（= 4px）
- 最终目标点：`REACHED_TARGET_DISTANCE`（= 8px）

普通 waypoint 到达半径较大，避免船为了精确命中贴岸 waypoint 而卡住。超远航线的 waypoint 间距只有 4px，开阔海域使用 64px 前视距离，减少远洋段逐点追踪的抖动和耗时；近岸会收紧到 12px，危险近岸进一步收紧到 4px，避免在 Cape Town、马来西亚群岛这类急弯/窄水道处过早跳过关键绕行点。最终目标点到达半径较小，避免离目标港太远就结束自动导航。

## Bug 记录：Lisbon 到 Barcelona 无法规划航线

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

- 增加 `4 x 4` fallback。
- 粗网格找不到路径时，用细网格重新规划整条路线。
- 更细的网格能表示近岸和海峡里的可通行水道，Barcelona 这类目标港可以正常规划。

验证：

- `npm run lint`
- `npm test -- --runInBand src/game/world/autoNavigation.test.ts`

## Bug 记录：Lisbon 到 Hormuz 在非洲近岸卡住

记录日期：2026-05-28

问题现象：

- 玩家从 Lisbon 附近出海。
- 打开 F4 世界地图。
- 选择 Hormuz 并启动自动导航。
- 船队航行到非洲西岸附近时贴住陆地，无法继续沿航线前进。

原因：

- 第一版自动导航在 `4 x 4` 粗网格上规划长途路径，长途航线会过于贴近海岸。
- `worldPlayer.move()` 实际移动时会使用船体碰撞和局部避障，船可能无法精确抵达贴近海岸的 waypoint。
- 自动导航原先直接按 waypoint 方向选择航向，常常选择斜向或单一轴向继续贴岸推进。
- 在非洲西岸等复杂海岸线附近，如果当前主航向被陆地挡住，船会连续多步不动，但自动导航仍持续朝同一个方向修正，最终卡住。

修复方法：

- 长途默认寻路网格调整为 `8 x 8`，减少长途航线贴岸程度。
- 保留 `4 x 4` 作为 fallback：如果粗网格找不到路径，再尝试细网格。
- waypoint 到达半径扩大到 `DEFAULT_GRID_SIZE * 4`，但最终目标点使用较小的 `REACHED_TARGET_DISTANCE`，避免过早判定到达导致离港太远。
- 自动导航状态新增 `lastPosition`、`stagnantMoves` 和 `useAlternateAxis`。
- `getAutoNavigationHeading()` 会检测连续停滞。如果多次位置几乎不变，会临时改用另一轴向，例如主方向向南被海岸挡住时，改向西离岸。
- 自动导航航向改为单轴优先，不再直接使用斜向追 waypoint，降低近岸船体碰撞卡死概率。

验证：

- 增加 `getAutoNavigationHeading()` 的 near-waypoint 和 alternate-axis 单元测试。
- 增加 Lisbon -> Hormuz 的完整仿真测试：使用真实 `worldTilemap.wasm`、真实 `calculateDestination()` 和自动导航逻辑运行。如果连续 30 步位置几乎不变，测试失败。
- `npm run lint`
- `npm test -- --runInBand`

## Bug 记录：Mombasa 等远洋目标三策略都失败

记录日期：2026-05-28

问题现象：

- 玩家从 Lisbon 附近出海。
- 打开 F4 世界地图。
- 选择 `70. Mombasa`。
- 点击"预览航线"。
- 界面提示"三种算法都无法规划到 Mombasa 的海上航线"。

根因：

- Mombasa 在东非海岸，位置 `(1134, 670)`，参考 [src/data/portData.ts](/home/laozhu/project/uncharted-waters-2/src/data/portData.ts) 第 3693 行。
- 从 Lisbon `(840, 358)` 到 Mombasa 的直线距离（带 x 环绕）约为 `√(294² + 312²) ≈ 428` 个 world tile。
- `src/interface/world/WorldMap.tsx` 第 25–77 行的 `getPreviewSearchBudget` 按直线距离划分预算：

  ```text
  distance ≤ 160  → 3000 节点（近）
  distance ≤ 260  → 1200 节点（中）
  distance >  260 →  400 节点（远）
  ```

  Mombasa 落在"远"档，预算只有 400 节点。

- 但实际海路必须绕好望角（非洲最南端 y ≈ 920）：

  ```text
  Lisbon → 大西洋向南 ~560 格 → 绕好望角 → 东非海岸向北 ~250 格 → Mombasa
  ```

  实际航线长度 ≥ 1200 个 world tile。在 `8×8` 网格上至少需要 ~150 步，`4×4` 至少 ~300 步。

- A\* 启发式一开始会偏向"直线方向"（东），被非洲大陆反复挡回，节点预算在突破到南半球之前就被耗光，搜索返回 `[]`。
- `createAutoNavigationPaths`（`src/game/world/autoNavigation.ts` 第 482 行）在三条策略之间共享 `pathsByGridSize` 缓存：

  ```ts
  const pathsByGridSize = new Map<number, Position[]>();
  ```

  `8×8` 失败一次，所有用到 8×8 的策略都直接拿到空数组；`4×4`、`12×12` 同理。结果三种策略全部失败，UI 显示"三种算法都无法规划"。

为什么之前没暴露：

- `Lisbon → Barcelona` 直线距离 ≈ 170，落在"近 3000 节点"档，预算充裕。
- `Lisbon → Hormuz` 的仿真测试使用 `createAutoNavigationPath`（单数），`maxSearchedNodes` 默认 `Number.POSITIVE_INFINITY`，绕过了预览预算限制。F4 预览那条线其实也容易撞同样的上限，只是没人专门测试。
- Mombasa 因为方向更"反"（启发式被陆地反复欺骗）而最先暴露。

修复总结：

- TODO 3（A\* 改二叉堆）+ TODO 2（按 gridSize 分配预览预算）组合解决。
- 生产预算 400 下 balanced 和 offshore 都能找到路线，total ~34ms。
- detailed（4×4）就算多给 multiplier 也找不到，长途不适合 4×4；UI 上紫色和蓝色两条线已经够用。
- TODO 1（统一提高远档预算）和 TODO 4（长途降级单策略）经实测不必再做，详见下面 TODO 列表。

回归测试：`autoNavigation.test.ts` 中 `Lisbon to Mombasa preview at production budget finds offshore and balanced routes` 固定预算 400，断言
balanced/offshore 有路线、detailed 无路线，防止 multiplier 配比未来被改坏。

## Bug 记录：远海航线 Mombasa 在东非海岸卡住

记录日期：2026-05-28

问题现象：

- F4 中选 70.Mombasa，点击"预览航线"，选"远海航线"，点击"自动导航"。
- 船绕过好望角后，在东非海岸 (1002, 850) 附近卡住，"连续停滞"反复 0–5 之间震荡，永远到不了 Mombasa。

根因：

- `WorldMap.tsx` 的 `handleStartAutoNavigation` 把 `selectedPath`（预览路径）直接传给
  `startAutoNavigation`，`actionsWorld.ts` 看到 `plannedPath.length > 0` 就跳过重新规划。
- 但 `createAutoNavigationPaths`（预览）为了 UI 响应速度，默认 `useCoastPenalty = false`，
  路径只看连通性、不看离岸距离。
- 远海航线（12×12）网格本身就比较粗，每个 waypoint 间隔 12 tile，加上没有 coast penalty
  推远海岸，waypoint 中心很容易落在 < 4 tile 离岸的位置。
- 船体碰撞 + 单轴航行让这种 waypoint 实际不可达：船朝它走会撞海岸，`useAlternateAxis`
  侧向脱困之后又回到主轴，反复在同一海湾里震荡。
- sim test `Lisbon to Mombasa with balanced/offshore preview path does not get stuck`
  在改成预览路径直接跑模拟时复现：40000 步内不能到达。

修复：

- 预览继续保持快速近似（`createAutoNavigationPaths` 默认 `useCoastPenalty = false`，
  multiplier 仍为 12×12→5、8×8→8、4×4→2），让 F4 三色对比 < 100ms。
- `WorldMap.tsx`：点击"自动导航"时不再透传 `selectedPath`，而是触发
  `startAutoNavigation` 走 fallback 分支调用
  `createAutoNavigationPath`（单数，`useCoastPenalty = true`，`maxSearchedNodes = Infinity`），
  按所选策略的 gridSize 链表重新规划一条避开海岸的安全路径。
- UI 上：点击后先显示"正在为 X 规划安全航线（避开海岸），请稍候..."，规划完成后
  状态切到"自动导航已开始"。F4 底部新增一行小字说明"预览为近似路线，实际黄色航线
  可能与预览略有差异"。
- 回归测试改为 `test.each(['balanced', 'offshore'])`，用
  `createAutoNavigationPath(start, target, strategyId)`（与实际启动用的函数一致）
  生成路径并跑仿真，确认 balanced 和 offshore 两种策略都能到达 Mombasa。

为什么不把 coast penalty 也加到预览：

- 实测开 coast penalty 后预览耗时从 34ms 涨到 18.7s，F4 会卡住，不可接受。
- coast penalty 函数最坏要扫描 16 半径方圆共 ~1088 次 `isSea`，缓存命中前每个新格子都很贵。
- 把 coast penalty 推迟到"自动导航"点击时再算，只算一条线（选定策略），可以接受 1–3 秒等待。

验证：

- `npm run lint`
- `npm test -- --runInBand src/game/world/autoNavigation.test.ts`
  - balanced actual-nav: ~10s（含仿真）
  - offshore actual-nav: ~5s（含仿真）

## Bug 记录：Lisbon 到 Macao 三种算法全部失败

记录日期：2026-05-29

问题现象：

- 玩家从 Lisbon 附近出海。
- 打开 F4 世界地图。
- 选择 `96. Macao`。
- 点击"预览航线"。
- 界面提示"三种算法都无法规划到 Macao 的海上航线"。

根因：

两层原因叠加导致三种算法全部失败：

**原因一：预览节点预算不足。**

Lisbon `(840, 358)` 到 Macao `(1700, 530)` 水平直线距离约 860 tile，远超 `MEDIUM_PREVIEW_DISTANCE = 260`，落入远档 `FAR_PREVIEW_MAX_SEARCHED_GRID_NODES = 400`。实际海路须绕非洲好望角或穿印度洋，航线长度在 4×4 网格上至少需要 ~500 步，在 8×8 网格上也需要 ~250 步。A\* 在节点用完前无法到达，返回 `[]`。

**原因二：马六甲海峡在粗网格下完全封堵。**

Lisbon 到 Macao 必须经过马六甲海峡（宽度约 20–40 tile）。在 `12 x 12` 粗网格下，海峡格子的中心点极大概率落在陆地或近岸碰撞格上，A\* 认为该方向没有海路。即使给够节点预算，offshore 策略也无法找到经马六甲的路线——它只能绕澳大利亚，这条替代路线需要额外探索数万个节点。

**原因三：海岸惩罚放大代价差距。**

实际导航（`createAutoNavigationPath`，无节点上限，`useCoastPenalty = true`）也会遇到类似问题：马六甲海峡内每个格子的海岸惩罚高达 +20，使 A\* 的启发式估计严重低估真实路径代价。算法被迫探索大量"看起来便宜但实际被陆地围住"的节点，在找到马六甲路径之前可能已经耗光浏览器单帧预算或陷入长时间卡顿。

为什么 Mombasa 能找到但 Macao 不能：

- Mombasa 方向从 Lisbon 向南绕好望角，没有明显窄海峡，`8 x 8` 和 `12 x 12` 在 3000 节点内都能找到路线。
- Macao 需要穿越马六甲或绕澳大利亚，任意一条路线的实际搜索量都大幅超过远档预算，且粗网格封堵马六甲使备选路线更长。

修复方法：

新增 `超远航线` 策略和配套的异步分块 A\*：

- `findDeepRoutePath()`（`autoNavigation.ts`）：使用 `4 x 4` 精细网格、**不计算海岸惩罚**，以每次 3000 节点为一个 chunk，在 `setTimeout(fn, 0)` 上分块执行，界面全程不卡。
  - 4×4 网格确保马六甲海峡有可通行的格子。
  - 去掉海岸惩罚后 A\* 启发式紧贴实际代价，节点探索效率大幅提升。
  - 4×4 全图最多约 145,800 个格子，在最差情况下分约 49 个 chunk 完成，总耗时通常在数秒内。
- `DeepRouteHandle`：返回 `{ promise, abort }`，支持用户中途取消。
- `WorldMap.tsx`：
  - 三种常规策略预览全部失败时，自动出现绿色"深度搜索"按钮。
  - 搜索过程中状态栏实时更新"已探索 X 个节点"，下方显示绿色脉冲进度条和说明文字。
  - 搜索完成后路线以绿色 `#4ade80` 显示在地图上，并提示"点击自动导航出发"。
  - `handleStartAutoNavigation` 检测到深度路线就绪时，将 `deepRoutePath` 直接作为 `plannedPath` 传给 `startAutoNavigation`，跳过重算。

验证：

- 构建无报错：`npm run build`（3 warnings 为已有包体积问题，与本改动无关）。
- 全部 16 个自动导航测试通过：`npm test -- --testPathPattern=autoNavigation`。

## Bug 记录：开阔海面斜向自动导航抖动

记录日期：2026-05-28

问题现象：

- 自动导航需要持续斜向移动时，例如右上、右下、左上、左下。
- 船队没有保持斜向 heading，而是在横轴和纵轴之间切换。
- 视觉上表现为船身/航向抖动，尤其在开阔海面更明显。

根因：

- 之前为了解决近岸斜向切角导致的船体碰撞卡住问题，`getDirectionToPosition()` 默认使用单轴优先。
- 这个策略对近岸更稳，但在没有障碍的海面会把自然的斜线航行拆成横向和纵向移动。
- `useAlternateAxis` 原本是脱困逻辑，但单轴优先变成了所有斜向导航的默认行为，影响了开阔海面的手感。

修复：

- 新增 `DIAGONAL_OPEN_SEA_RADIUS`，只有当前位置周围一定范围都判定为海面时才允许自动导航使用斜向 heading。
- 开阔海面 x/y 两轴都需要移动时，`getDirectionToPosition()` 返回 `ne`、`se`、`sw` 或 `nw`。
- 靠近海岸、海峡或障碍时，仍保持单轴优先，降低近岸船体碰撞卡住概率。
- 通过 waypoint 时重置 `stagnantMoves` 和 `useAlternateAxis`，避免脱困状态影响后续正常航向。

验证：

- 更新 `getDirectionToPosition()` 单元测试，覆盖四个斜向 heading。
- 保留 alternate-axis 单元测试，确认脱困时仍使用单轴。
- 运行真实 world tilemap 仿真，确认 Lisbon -> Hormuz、Lisbon -> Mombasa balanced/offshore 仍能到达。
- `npm test -- --runTestsByPath src/game/world/autoNavigation.test.ts`
- `npm run lint`

## Bug 记录：超远航线在马六甲、好望角反复卡住

记录日期：2026-05-29

### 问题现象

从 Lisbon 出发使用超远航线导航到 Macao，途中在两个地点反复卡住：

1. **马六甲海峡**（约 x=1486, y=615）：船贴着马来半岛东岸，`useAlternateAxis=true`，连续停滞达数百次。
2. **好望角以北**（约 x=1002, y=850）：船卡在南非西岸凹形海湾，停滞计数在 0–12 之间反复振荡，永远触发不了逃脱阈值。

### 根因一：useAlternateAxis 次轴方向垂直于海峡

马六甲海峡极窄（~20–40px），waypoint 间距 4px。当船卡住时，次轴方向（主方向的垂直轴）恰好指向马来半岛或苏门答腊，船完全动弹不了。`stagnantMoves` 持续累积至数百次，`useAlternateAxis` 无法提供帮助。

早期修复曾把超远航线的 waypoint 到达半径从 32px 提升到 64px。后续 Lisbon -> Macao 回归暴露出统一 64px 会在 Cape Town 等近岸急弯过早跳点，因此当前实现已改为按海况动态判定：开阔海域 64px、近岸 12px、危险近岸 4px。这样既保留远洋段的前视能力，也避免近岸关键绕行点被提前跳过。

### 根因二：微小振荡导致阈值无法触发

好望角区域：`useAlternateAxis` 在 `stagnantMoves = 12` 时触发，次轴让船移动了一小步（≥ 0.001px），`stagnantMoves` 重置为 0，然后再次累积到 12，如此循环。计数器永远无法到达旧阈值 60，绕路逻辑永远不触发。

修复：把超远航线的绕路触发阈值 `DEEP_ROUTE_STAGNANT_SKIP_THRESHOLD` 降到与 `STAGNANT_MOVES_BEFORE_ALTERNATE_AXIS` 相同（= 12），在第一次"卡 12 帧"时就尝试绕路。

### 根因三：绕路目标基于 waypoint 数量而非物理距离，导致路径级联损毁

早期绕路逻辑：`detourTargetIdx = waypointIndex + 60`。由于路径已被之前的绕路操作缩短（307 → 278 个 waypoint），在 Cape Town 卡住时 `265 + 60 = 325 > 277`，目标被 clamp 成最后一个 waypoint（Macao）。A* 从 Cape Town 到 Macao（数千像素）在 1000 节点内必然失败，触发 fallback skip 12 → `waypointIndex = 277` = 最终目标。整段非洲→印度洋路线全部丢失，船在好望角附近只剩 1 个 waypoint 指向 Macao，卡死在南非海岸。

修复：目标选取改为**基于物理距离**（`DEEP_ROUTE_DETOUR_MIN_DISTANCE = 100px`），而非 waypoint 数量。沿路径向前走，找到第一个与当前位置距离 ≥ 100px 的 waypoint 作为绕路目标，且上限严格限定为 `path.length - 2`（绝不以最终目的地为目标）。fallback skip 从 12 降至 4，防止误跳到路径末尾。A* 节点预算从 1000 提升至 2000，确保 Cape Town 这类绕角场景能在预算内找到路径。

### 绕路算法最终流程

```
卡住（stagnantMoves = 12，deep 策略）
  ↓
沿路径向前扫描，找首个物理距离 ≥ 100px 的 waypoint（上限 path.length-2）
  ↓
找到有效目标？
  是 → findSeaPath(当前位置, 目标, 4px 格, 5000 节点，关闭海岸惩罚，开启线段通海检查)
    → 成功：把绕路段插入路径替换堵死段，返回 newPath
    → 失败：fallback skip 4 个 waypoint
  否 → skip 4 个 waypoint
stagnantMoves = 0, useAlternateAxis = false
```

`newPath` 由 `actionsWorld.ts` 的 `updateAutoNavigation` 应用到状态。普通策略（balanced/detailed/offshore）不受任何影响，Hormuz/Mombasa 回归测试全部通过。

## Bug 记录：Lisbon 到 Macao 在 Cape Town 和马来西亚近岸卡住

记录日期：2026-05-29

问题现象：

- 从 Lisbon 使用超远航线自动导航到 Macao。
- 船通过 Cape Town 北侧小角前，会在南非西岸附近贴岸来回顶住。
- Cape Town 修复后，船继续航行到马来西亚/马六甲附近，又被岛屿和半岛边缘挡住。诊断浮层可见当前 `WP` 编号不断增加，但船仍在岸边推不出去。

根因：

1. **超远航线统一 64px 到达半径过大。**
   64px 前视距离适合开阔海面，但在 Cape Town 这种急弯近岸处会提前跳过一串绕角 waypoint，直接追向隔着陆地的后续点。局部 A\* 插入绕行后，也会被同样的大半径继续跳过。

2. **局部 A\* 只判断网格中心点是否为海。**
   马来西亚附近有很薄的岛屿/陆地带。两个 waypoint 中心点都可能是海，但它们之间的线段实际穿过陆地，船体移动时会撞岸。

3. **局部 A\* 允许斜向切角。**
   规划器允许从一个海格斜向进入另一个海格，即使横向/纵向相邻格是陆地。实际 `worldPlayer.move()` 的船体碰撞不会允许这种“贴角穿过去”的移动，第一步就会停住。

4. **近岸主轴被挡时切轴太慢。**
   船到达某些危险近岸点时，朝 waypoint 的主轴方向被陆地挡住；向另一轴退半格就能继续，但旧逻辑要等多次停滞后才进入 `useAlternateAxis`。

修复：

- 超远航线 waypoint 到达半径按海况动态选择：
  - 开阔海域：64px。
  - 近岸：12px。
  - 危险近岸：4px。
- `findSeaPath()` 增加 `useSegmentClearance` 选项。开启后，相邻网格中心点之间的整条线都必须保持通海，否则该边不可走。
- A\* 邻居扩展禁止斜向切角：斜向移动时，横向和纵向两个相邻格也必须可通海。
- 超远航线的局部脱困 A\* 改为 `4 x 4` 精细网格、5000 节点、关闭海岸惩罚、开启线段通海检查。它只负责脱困，优先保证“能走”，不再在局部绕行里为了离岸距离扩大搜索量。
- `getAutoNavigationHeading()` 在 deep 策略下增加近岸可移动性检查：如果当前主航向实际无法移动，而另一轴可以移动，会立即返回“近岸切轴”，不用等待停滞计数累积。
- 自动导航状态新增 `debug`，F4 世界地图和航行画面诊断浮层可以显示当前 waypoint、判定半径、航向、海况、A\* 目标和切轴/失败原因。

验证：

- 新增 Cape Town 近岸半径测试：确认危险近岸 waypoint 判定半径收紧到 4px。
- 新增马来西亚局部回归：从截图坐标 `1498,586` 到 A\* 目标 `1572,516`，确认绕行路径不会斜向切角或穿过薄陆地带，并能通过局部岛屿。
- `npm test -- --runInBand src/game/world/autoNavigation.test.ts`
- `npm run lint`
- `npm run build`

## Bug 记录：Lushun 到 Changan 三策略和深度搜索全部失败

记录日期：2026-05-29

问题现象：

- 从 107. Lushun 到 98. Changan，实际有可航行水道（玩家能逐格开过去）。
- 但三种预览算法（`8 x 8` / `4 x 4` / `12 x 12`）全部失败，深度搜索（`4 x 4`）也失败。

根因：

- Changan 位于一条**仅约 1 tile 宽的蜿蜒水道**尽头。
- 所有寻路网格都用**网格中心点**代表整个网格单元，且 `isWorldSea` 要求 `2 x 2` 全是海 tile。
  水道太窄，所有 `≥ 2` 的网格的中心点都落在陆地上，于是目标格在 `8 x 8` / `4 x 4` 网格上都
  与外海**断开**。深度搜索写死 `4 x 4`，自然也断开。
- 连通性实测（Lushun 邻海 → Changan 邻海）：tile 级（`gs=1`）连通；`gs=2/4/8` 用中心点判定
  全部断开。`gs=1` 的 A\* 解这条航线只探索约 364 个节点。

> 注意：本条记录的”分层兜底”修复（先 `4 x 4` 全程、失败后 tile 级全程）在长途场景下有缺陷，已被下文
> Bug 记录“Lisbon 到 Changan”的**两阶段**方案取代——tile 级不再从起点重跑整条航线，只在目标附近的水道口
> 接驳。这里保留原始记录作为来龙去脉。

修复：

- 深度搜索改为分层：先 `4 x 4`（原行为，适合超远航线），失败后**兜底 tile 级（`gs=1`）搜索**，
  带节点上限 `DEEP_ROUTE_TILE_MAX_NODES = 300000` 优雅失败。
- 把分块 A\* 抽成可复用的 `createChunkedSeaSearch(start, target, gridSize, onProgress, maxNodes, useCoastPenalty)`，
  `findDeepRoutePath()` 按层级依次调用，进度跨层累计。
- **tile 级关闭海岸惩罚**：在 1-tile 水道里近岸惩罚毫无意义，且 `maxSearchedNodes` 只限制
  出队（closed）节点、不限制 open heap；海岸惩罚会让 A\* 为了离岸在整片外海扩散，open heap
  膨胀导致内存溢出。关掉后启发式直奔目标，open set 很小。
- tile 级落点都是真实海格、尊重 `2 x 2` 船体，不会出现“航点落在陆地”。

注意（已知局限）：tile 级路径航点密集（间隔 1 格），由深度搜索的航点跟随逻辑（近岸小到达
半径）消化；窄水道急弯处仍可能短暂触发停滞/局部 A\* 脱困，但能恢复。

验证：

- 新增 `narrow-channel ports (Lushun -> Changan)` 测试：粗网格（`8`/`4`）返回空；tile 级
  （`gs=1`，关海岸惩罚）找到航线且终点为目标；`findDeepRoutePath()` 端到端从 `4 x 4` 失败
  兜底到 tile 级并找到航线。
- `npm test`
- `npm run lint`
- `npm run build`

## Bug 记录：Lisbon 到 Stockholm 在窄湾处导航点落在“陆地”、船卡住

记录日期：2026-05-30

问题现象：

- 从 1. Lisbon 到 38. Stockholm，三种常规预览航线全部失败，改用“深度搜索”（超远航线）。
- 深度搜索共探索约 105,000 个节点后找到航线（`4 x 4` 失败，兜底到 tile 级）。
- 船航行到 Stockholm 附近群岛的一个窄湾时卡住。诊断浮层显示当前在追第 210/266 个导航点
  `WP 210 @ (980, 232)`，船在 `(977, 229)`，距离约 4.2px、判定半径 4.0px，“连续停滞 0”
  却一直在 `(976, 229)`–`(977, 229)` 之间来回，无法前进。
- 玩家观察到 `WP 210` 的方框看起来“落在陆地上”。

根因：

- 该 `WP 210` 其实是真海格：`isWorldSea((980, 232))` 为 `true`（tile 级落点尊重 `2 x 2`
  船体）。方框看起来在岸上，是因为它处在一条仅 1–2 格宽的弯曲水道里，紧贴海岸线。
- 真正的问题是**航点跳过逻辑在近岸凹形岸线处会“抄近道穿过陆地”**：
  - tile 级深度路线航点间隔 1 格，非常密集。
  - 在窄湾入口附近（船需要先向**西**走到 `x=976` 这条唯一的纵向水道，再向南、再向东），
    多个沿水道的关键航点（如 `(976, 230)`、`(976, 231)`、`(976, 232)`）会同时落在
    船当前位置的到达半径（近岸 12px / 危险近岸 4px）以内。
  - 旧的“在到达半径内就推进 `waypointIndex`”逻辑把这些穿水道的航点**一次性全跳过**，
    直接去追水道另一侧、隔着陆地的 `(980, 232)`。
  - 朝 `(980, 232)` 的航向是东南，但东向（`(978, 229)` 是陆地）和南向（`(977, 230)` 是陆地）
    都被挡住；船真正需要的是先向**西**离开（远离目标）进入水道，而贪心的航点航向永远
    不会选择背离目标的方向。结果船在水道口反复抖动。
  - 因为是 1px 级别的微抖（位移 ≥ 0.001px），“连续停滞”计数被反复清零，永远到不了
    `DEEP_ROUTE_STAGNANT_SKIP_THRESHOLD = 12`，**局部 A\* 脱困也无法触发**。

修复方法：

- 新增 `isSegmentSea(from, to, isSea)`：对两点连线采样，若任一采样点不是海则返回 `false`。
- `getAutoNavigationHeading()` 推进 `waypointIndex` 的循环中，对**超远航线**增加“线段通海”
  护栏：只有当“船到**下一个**航点”的直线全程通海时，才允许跳过当前已到达的航点；否则
  停止跳过，逐点把水道走完，不再抄近道穿陆地。
- 为避免船恰好压在某个航点上（落在航向死区 `DIRECTION_DEAD_ZONE`）时因护栏停步，
  当船基本贴在当前航点上（距离 ≤ `DIRECTION_DEAD_ZONE * √2`）时无条件推进，确保不会
  卡在死区里。
- 护栏只对 `strategyId === 'deep'` 生效，普通策略（balanced/detailed/offshore）行为不变。

效果（仿真）：

- 修复前：船从 `(970, 215)` 沿真实 tile 路线航行，会卡在 `(977, 229)` 一带反复抖动，
  到不了 Stockholm（与玩家现象一致）。
- 修复后：船顺着 `x=976` 水道下行、在底部转向东，绕过窄湾，最终到达 Stockholm 邻近海域。

验证：

- 新增 `deep route threads the narrow Stockholm channel without getting stuck` 仿真测试：
  用 `findSeaPath`（tile 级、关海岸惩罚）生成窄湾航线，跑真实 `calculateDestination` 仿真，
  断言不卡住且能到达目标邻近海域。已确认该测试在去掉护栏时失败、加上护栏后通过。
- `npm run lint`
- `npm test -- --runInBand src/game/world/autoNavigation.test.ts`（22 项全部通过）
- `npm run build`

## Bug 记录：Lisbon 到 Changan 深度搜索探索约 40 万节点后失败

记录日期：2026-05-30

问题现象：

- 从 1. Lisbon 到 98. Changan 使用”超远航线”深度搜索。
- 状态栏节点计数涨到约 **40 万**后，进度条消失、提示”深度搜索失败”，没有找到任何航线。
- 相比之下，距离很近的 107. Lushun 到 98. Changan 深度搜索是能成功的（见上一条 Bug 记录）。

根因：

旧版 `findDeepRoutePath()` 把搜索写成**两个分层（tier），都从起点搜到终点**：

1. **tier 1：`4 x 4` 精细网格、无节点上限。** Changan 位于一条仅约 1 tile 宽的水道尽头，`4 x 4`
   网格的中心点全落在陆地上（`isWorldSea` 要求 `2 x 2` 全为海），目标格在粗网格上与外海**断开**，
   永远到不了。于是这一层会把整片可达外海全部探索一遍（约 14.5 万个 `4 x 4` 格子）后耗尽 open
   heap，返回空。
2. **tier 2：`1 x 1` tile 级、上限 `DEEP_ROUTE_TILE_MAX_NODES = 300000`。** 它**重新从 Lisbon
   到 Changan 整条航线**在 tile 级展开。但 Lisbon `(840, 358)` 到 Changan `(1560, 388)` 的实际海路要
   绕非洲好望角、横跨印度洋，长达上千 tile；A\* 的启发式还会把搜索往东（地中海、欧亚陆地）这条死路里拽。
   30 万个 tile 根本覆盖不了这个跨度，于是在 Lisbon 周边耗尽预算、优雅失败。

两层相加 ≈ 14.5 万（tier 1）+ 30 万（tier 2）≈ **用户看到的约 40 万节点，然后失败**。

核心错误：tile 级**只应该用于目标附近的窄水道接驳段**（所以距离近的 Lushun -> Changan 能成），
但旧实现却让它从起点重跑了整条跨半球航线。

关键观察（来自上一条 Bug 记录的实测）：Changan 邻海在 `4 x 4` 网格上是一块**与外海断开的孤立连通块**，
所以”水道口”必须是一个**从起点可达**的格子，不能只是”该格子是海”。我最初尝试的”从目标向外做 tile
级 Dijkstra、停在第一个粗网格是海的格子”就踩了这个坑——它停在了 Changan 自己那块断开的内湾，长途段
依然连不过去。

修复（改为两阶段，让 tile 级只在目标附近局部展开）：

1. **长途粗网格搜索（`4 x 4`，起点 → 目标）。** 给 `createChunkedSeaSearch()` 增加
   `returnClosestOnExhaust` 选项，并把它的 resolve 结果从 `Position[]` 改为
   `{ path, reachedTarget }`：
   - 目标是开阔水域 → 直接到达，`reachedTarget = true`，普通港口行为完全不变。
   - 目标在窄水道后面无法到达 → 搜索泛滥整片**可达**外海，过程中按启发式距离记录**离目标最近的已出队
     格子** `closestKey`。耗尽 open heap 时返回到这个最近格子的路径，`reachedTarget = false`。因为是从
     起点泛滥得到的，这个”最近可达格子”必然**与起点连通**，且正好落在外海一侧的**水道口**。
2. **窄水道接驳搜索（`1 x 1` tile 级，水道口 → 目标，上限 30 万、关海岸惩罚）。** 只负责穿过目标附近
   那条短水道。这段距离远小于旧 tier 2 的整条跨球航线，30 万节点上限绰绰有余；若目标真的无路可走则优雅失败。
3. **拼接**：`haulPath`（长途段）末尾正好是水道口，tile 级搜索的返回值已剔除自己的起点（水道口），二者直接
   `[...haulPath, ...channelPath]` 拼接，无重复点。

这样长途段始终走 `4 x 4`，只有目标前最后一段窄水道走 tile 级。删掉了旧的”整条 tile 级兜底”分层逻辑。

为什么用”离目标最近的可达格子”而不是”从目标向外找海格”：前者保证了与起点的连通性（关键），后者会停在
Changan 那块断开内湾导致长途段连不过去。启发式距离（octile 距离）是一个足够好的代理，能把交接点选在真实的
海上进近口。

> 补充：本条只处理了**目标**是被困港口的情形（隐含假设起点在主海域）。当**起点**才是被困港口时（如
> Changan -> Jamaica），从起点泛滥根本出不来，上述逻辑会失败。已由下文 Bug 记录“Changan 到 Jamaica”推广为
> 对称处理（从两端泛滥、取主海域那端做长途）。

验证：

- 新增 `deep route reaches Changan from half a world away (Lisbon)` 测试：从 1. Lisbon 邻海到
  98. Changan 邻海跑 `findDeepRoutePath()`，断言找到非空航线且终点正好是目标。约 2 秒完成（旧实现是探索约
  40 万节点后失败）。
- 保留 `narrow-channel ports (Lushun -> Changan)` 全部测试：粗网格仍返回空、tile 级仍能找到水道、
  `findDeepRoutePath()` 端到端仍能到达 Changan（114 个航点，终点正好是目标）。
- `autoNavigation.test.ts` 全部 23 项通过（含 Cape Town、Stockholm 窄水道、Lisbon -> Hormuz/Mombasa
  等既有仿真）。
- `npx tsc --noEmit`（仅剩两处与本改动无关的既有 `columns` 未使用告警）。
- `npm run lint`（`autoNavigation.ts` 无问题）。

## Bug 记录：Changan 到 Jamaica 起点被困窄水道、深度搜索失败

记录日期：2026-05-30

问题现象：

- 从 98. Changan 到 51. Jamaica 使用”超远航线”深度搜索失败，找不到任何航线。
- 反过来的 Lisbon -> Changan（上一条 Bug 记录）已经能成功，所以问题出在”Changan 作为**起点**”这个方向。

根因：

上一条 Bug 记录的”水道口”方案有个隐含假设：**起点在主海域**，从起点泛滥能淹没整片外海、顺带把被困
**目标**的水道口纳进来。但 Changan -> Jamaica 把被困港口放到了**起点**：

- 连通性实测（`4 x 4` 粗网格）：`Lisbon <-> Jamaica` 连通（同属主海域，路径约 108 步）；
  `Changan <-> Lisbon`、`Changan <-> Jamaica` 全部为空。即 **Changan 的粗网格格子和主海域不连通**，
  它自成一个被 1-tile 水道封住的小连通块。
- 于是从 Changan（起点）做 `4 x 4` 泛滥根本出不了它那个小块，更谈不上找到通往 Jamaica 的”离目标最近可达
  格子”——长途段直接失败。
- 而且 `Changan -> Jamaica` 即使在 **tile 级**也无解（实测 60 万节点内找不到）：两港横跨半个地球、A\*
  启发式还会被 x 环绕拽向被陆地封死的太平洋方向。tile 级全程搜索同样不可行。

修复（把”水道口接驳”从单向推广为**对称**，让长途段始终落在主海域那一端）：

1. **正向长途粗搜索**：`4 x 4` 从起点到目标。到达 → 直接返回（普通港口、双方都在主海域，单次泛滥即可）。
2. **两端都泛滥、比较连通块大小**：正向没到达，说明两端在不同粗网格连通块。再做一次**反向**泛滥（目标 →
   起点），给 `createChunkedSeaSearch()` 的结果新增 `searchedNodes`（出队节点数）。**节点更多的那次泛滥就是
   主海域**（主海域连通块远大于被水道封住的小块）。两次泛滥各自记录的”离对端最近可达格子”就是被困港口的水道口。
3. **tile 级接驳 + 拼接**：
   - 若起点在主海域（目标被困）：沿用上一条方案，tile 级从”水道口 → 目标”接驳，`[...haul, ...channel]`。
   - 若目标在主海域（**起点**被困）：tile 级从”起点 → 水道口”穿出水道，再把反向长途段（目标泛滥得到的
     `目标 → 水道口`）用 `reverseCoarsePath()` 翻转成 `水道口 → 目标`，拼成
     `[...channel(起点→水道口), ...reversed(水道口→目标)]`，终点正好是目标。

要点：

- **用连通块大小区分主海域和被困小块**，而不是猜哪端是窄水道港口——更稳，也天然处理”被困的是起点还是终点”。
- 长途段永远走 `4 x 4`，tile 级只在某一端的短水道里展开。
- 普通港口（双方主海域）只跑一次正向泛滥，行为和性能都不变。
- 已知局限：若**两端都是**被水道封死的港口（各自小连通块、主海域是第三块），当前实现不处理，会优雅返回空。
  现实中两端同时是极窄水道港口的航线极少。

验证：

- 新增 `deep route departs Changan for a far open-water port (Jamaica)` 测试：从 98. Changan 邻海到
  51. Jamaica 邻海跑 `findDeepRoutePath()`，断言非空且终点正好是 Jamaica（498 个航点，约 2 秒）。
- 手测四条航线全部 OK 且终点精确：`Changan -> Jamaica`（498）、`Lisbon -> Changan`（488）、
  `Lushun -> Changan`（114）、`Lisbon -> Jamaica`（109，普通港口仅 3000 节点）。
- `autoNavigation.test.ts` 全部 24 项通过。
- `npx tsc --noEmit`（仅剩两处与本改动无关的既有 `columns` 未使用告警）。
- `npm run lint`（`autoNavigation.ts` 无问题）。

## Bug 记录：远海预览穿过巴拿马地峡 + 小地图横跨北美的横线

记录日期：2026-05-30

问题现象：

- 从 1. Lisbon 到 118. Nome 点击“预览航线”，`远海航线`（紫色，`12 x 12` 起步）返回一条
  “可用”路线，但小地图上这条线**直接穿过巴拿马地峡**（实际不通航）。
- 同一张小地图上还有**一条横贯北美的水平直线**，从地图左缘一直拉到右侧 Nome 附近。

根因：

- **穿巴拿马**：巴拿马地峡在地图数据里本就是约 50px 宽的实心陆地，但粗网格寻路只检查每个
  网格**格心**是否为海。地峡两侧的海格格心都是海，A\* 就在它们之间连边，一步步斜穿地峡。
  实测 Lisbon → Nome 的远海预览有 5 段中途穿陆，巴拿马是其一。`findSeaPath` 早已有
  `useSegmentClearance`（线段通海护栏，见“Stockholm 窄湾”记录），但只在深度搜索的局部 A\*
  绕行里启用，预览和常规寻路都没开。
- **横线**：世界地图东西无缝环绕（`getXWrapAround`）。这条远海路线在太平洋处从地图右缘绕到
  左缘，相邻两个航点的 map-x 一个接近右缘、一个接近左缘。`WorldMap.tsx` 的 `drawPath` 直接
  对相邻两点 `lineTo`，于是这条“跨接缝”的短跳被画成横贯整图的直线。

修复方法：

- **穿巴拿马**：给 `findSeaPath` 的线段净空检查加上**端点豁免**后，在预览
  （`createAutoNavigationPaths`）和实际寻路（`createAutoNavigationPath`）里启用
  `useSegmentClearance: true`：相邻两个海格之间的连线必须全程是海才连边，堵死地峡跳跃。
  港口附近的格心进出港时难免略压到岸，所以距起点/终点
  `SEGMENT_CLEARANCE_ENDPOINT_EXEMPT_RADIUS = 48px` 以内的航段豁免该检查，避免误杀正常的
  近岸进港；而真正的地峡永远远离两端，仍会被拦下。Lisbon → Nome 这类超远目标的远海预览因此
  正确返回“无路线”（交给“深度搜索”——它在 `4 x 4` 下本就绕开巴拿马）。
- **横线**：`drawPath` 改为检测相邻两点 map-x 差是否超过半张图宽；若是，按真实环绕量拆成
  **两段、分别从左右两边出画**，而不是横穿整图。

效果与验证：

- 8 条地中海/大西洋航线（Istanbul、Alexandria、Marseille、London、Naples、Ceuta、Candia、
  Mombasa）路径**完全不变**、零中途穿陆；Lisbon → Nome 远海预览不再给出穿巴拿马的线。
- 新增回归测试 `Lisbon to Nome preview never hops across the Panama isthmus`：断言三种预览
  策略返回的路径都没有“远离两端的中途穿陆”航段。已确认去掉护栏时该测试失败、加上后通过。
- `autoNavigation.test.ts` 全部 25 项通过。
- `npx tsc --noEmit`（仅剩两处与本改动无关的既有 `columns` 未使用告警）。
- `npm run lint`（三个改动文件均无问题）。

## Bug 记录：稳健航线 Nome 到 Santa Barbara 卡在太平洋岛链的内凹海湾

记录日期：2026-05-30

问题现象：

- 用 `稳健航线`（balanced）从 118. Nome 到 123. Santa Barbara，预览能给出一条 52 个航点的
  路线，但实际自动导航把船开到一个小岛西北角的内凹海湾后卡死，诊断显示“单轴脱困·连续停滞”，
  船在 `(2054, 246)` 一带反复抖动到不了下一个航点。

根因：

- 预览/实跑的路线本身是好的：沿岛链**南侧**的开阔水域（y=268 一线）东行，全程通海、零穿陆。
- 问题在**跟随逻辑**，而非路线。balanced/offshore 的航点间隔 8px、到达半径却是 32px
  (`REACHED_WAYPOINT_DISTANCE`)。船从北边下行到转弯处时，一帧之内就把贴着岛南岸的一簇航点
  （wp14–18）全判为“已到达”，转而去追更东边的航点，于是航向指向东南、斜切进岛屿，被推进
  内凹海湾。海湾东、南都是陆地，只有西边是开口，而贪心航向永远不会选择“背离目标向西脱离”，
  于是卡死（与早期 Stockholm 窄湾、Cape Town 急弯同类，但那些已由**超远航线**的局部 A\*
  绕行解决）。

为什么不强行让 balanced/offshore 也变“稳”：

- 试过把超远航线的三件法宝（近岸收紧到达半径、线段通海跳点护栏、卡住时局部 A\* 绕行）
  推广到所有策略，结论是**对粗网格策略行不通**：
  - 近岸收紧到达半径（4px）配 8px 粗航点，会让船在非洲海岸这种长岸段贴不准航点而失速，
    仿真要么超时、要么因为每帧的海岸惩罚扫描产生海量分配而 OOM（Mombasa、Hormuz）。
  - 局部 A\* 绕行对粗策略会在长航线上反复触发、每次拼接一段新 A\* 航段使 `path` 无界增长，
    同样 OOM（Hormuz）。
  - 线段通海护栏单独上虽不 OOM，但救不了已经进湾的船（150,000 步仿真后仍停在 `(2052, 247)`），
    还会让未铺 tilemap 的纯单元测试（`isWorldSea` 返回 false）误判全是陆地而卡住。
- 真正能稳穿岛链的是**超远航线**：它的 tile 级密集航点 + 局部 A\* 绕行本就是为这种场景设计的。
  实测 `findDeepRoutePath(Nome, Santa Barbara)` 能找到路线并跑完仿真到港。

修复方法：

- 不改粗策略的跟随逻辑（避免上面的 OOM/失速回归）。
- **F4 始终显示“深度搜索”按钮**（原来只在三种预览全部失败时才出现）：粗预览“成功”不代表
  贪心跟随能走通，像 Nome → Santa Barbara 这种穿岛链的长航线需要随时能切到超远航线。
- 顺手把热点函数 `isWorldSea` 里每次调用都新建的 `offsets` 数组提到模块级常量
  `SHIP_TILE_OFFSETS`（海岸惩罚环形扫描每帧调用它上千次），减少分配。

验证：

- 新增回归测试 `deep route from Nome to Santa Barbara threads the island chain`：
  `findDeepRoutePath` 找到路线、终点精确为目标港，并用真实仿真跑到“arrived”不卡住。
- 既有单元测试 `advances past near waypoints...` 仍通过（确认粗策略跟随逻辑未被改动）。
- `autoNavigation.test.ts` 全部 26 项通过。
- `npx tsc --noEmit`（仅剩两处与本改动无关的既有 `columns` 未使用告警）。
- `npm run lint`（三个改动文件均无问题）。

## 测试建议

每次修改自动导航后至少运行：

```bash
npm test -- --runInBand src/game/world/autoNavigation.test.ts
```

涉及状态、UI 或航行循环时运行：

```bash
npm run lint
npm test -- --runInBand
```

发布或提交前建议运行：

```bash
npm run build
```

## 后续可改进方向

- 分段混合精度寻路：海峡/近岸用 `4 x 4`，远海用 `8 x 8` 或更粗网格。
- 让路径代价考虑风向和洋流，避免逆风慢航。
- 在 F4 世界地图上显示更明显的航线和当前 waypoint。
- 到达目标港附近后显示提示，或者提供自动靠港选项。
- 为长途航线加入补给风险评估。
- 超远航线目前不计算海岸惩罚，实际航行时贴岸 waypoint 仍有卡住风险；可考虑在找到路径后做一次后处理，把过于贴岸的 waypoint 向外推。
- 超远航线可考虑改用双向 A\*（Bidirectional A\*），从起点和终点同时向中间扩展，理论上可把节点数从 O(b^d) 降至 O(b^(d/2))，进一步缩短搜索时间。

### Mombasa 远洋目标 bug 的待试 TODO

四个方向都计划尝试，逐个验证后比较效果再决定保留哪个组合。涉及文件主要是
[src/interface/world/WorldMap.tsx](/home/laozhu/project/uncharted-waters-2/src/interface/world/WorldMap.tsx)
和
[src/game/world/autoNavigation.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.ts)。

- [~] **TODO 1：提高"远"档预算并按方向加成。**（已关闭，不需要）
  原计划把 `FAR_PREVIEW_MAX_SEARCHED_GRID_NODES`（`WorldMap.tsx:29`）从 400 提到 2000–3000。
  TODO 2 完成后，远档基础预算 400 × 各 gridSize multiplier 已能覆盖 Mombasa；
  再统一抬高反而会让那些在粗网格上找不到海路的目标多耗节点，得不偿失。
  （注：当时把 Changan 当作“内陆无海路”的例子其实不准确——Changan 有海路，只是水道太窄
  粗网格表示不了，已由深度搜索的 tile 级兜底解决，见 Bug 记录“Lushun 到 Changan”。）

- [x] **TODO 2：给 `offshore`（12×12）单独保留较高预算。**
      在 `createAutoNavigationPaths`（`autoNavigation.ts`）新增
      `getPreviewGridBudgetMultiplier`：
      `gridSize ≥ 12 → 5×`、`gridSize ≥ 8 → 8×`、其余（4×4）`2×`。
      `maxSearchedNodes === Infinity` 时不乘，保持真实启动用的无预算搜索不变。

      Mombasa bench 在生产预算 400 下重测：

      | budget | balanced (8×8) | detailed (4×4) | offshore (12×12) | 总耗时 |
      |--------|----------------|----------------|------------------|--------|
      |   400  | ✅ 96            | ❌              | ✅ 65              | 34ms   |
      |  1000  | ✅ 96            | ❌              | ✅ 65              | 25ms   |
      |  3000  | ✅ 96            | ❌              | ✅ 65              | 47ms   |
      | 10000  | ✅ 96            | ✅ 189           | ✅ 65              | 59ms   |

      结论：

      - 生产预算 400 下 balanced 和 offshore 都能找到 Mombasa 路线，UI 完全可用（34ms）。
      - detailed 在 400 × 2 = 800 节点下还是失败 —— 4×4 需要至少 ~20000 节点才能绕非洲，长途用 detailed 仍不现实。
      - 三种策略的 multiplier 配比是按 TODO 3 的 bench 数据反推得出的：12×12 在 ~2000 就够、8×8 需要 ~3000、4×4 只给最小保留。
      - 风险（12×12 假阳性穿越海峡）暂未观察到，因为 fallback 链让稳健/细致策略覆盖了 8×8 / 4×4 的精细判断；后续如果出现近岸路线异常，再回头调整 multiplier。

- [x] **TODO 3：把 A\* `openSet` 改成二叉堆。**
      `findSeaPath`（`autoNavigation.ts`）原本每轮 `openSet.sort()` O(n log n)，
      加上 `openSet.some(...)` O(n) 防重，是真正吃预算的瓶颈。
      已改成 binary heap + lazy deletion：
      `createOpenHeap()` 闭包内 `push` / `pop` 都是 O(log n)，
      relax 时直接 push 新 entry，pop 时若已在 `closedSet` 则跳过。
      `(fScore, sequence)` 作为复合排序键，与原 stable-sort 行为一致，
      Lisbon → Hormuz 仿真和 Barcelona / Changan preview 测试全部通过。

      Mombasa bench（[src/game/world/autoNavigationBench.test.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigationBench.test.ts)）实测：

      | budget | balanced (8×8 → 4×4) | detailed (4×4) | offshore (12×12 → 8×8 → 4×4) | 总耗时 |
      |--------|----------------------|----------------|-------------------------------|--------|
      |   400  | 失败                  | 失败            | 失败                           | 14ms   |
      |  1000  | 失败                  | 失败            | 失败                           | 19ms   |
      |  2000  | 失败                  | 失败            | ✅ 65 个 waypoint              | 23ms   |
      |  3000  | ✅ 96 个 waypoint     | 失败            | ✅ 65 个 waypoint              | 34ms   |
      | 10000  | ✅ 96 个 waypoint     | 失败            | ✅ 65 个 waypoint              | 66ms   |

      结论：

      - 堆本身不解决 400 节点的 Mombasa，但把 10000 节点的耗时压到 66ms，让 TODO 1 / TODO 2 可行。
      - offshore（12×12）在 2000 节点就能成功 → TODO 2 方向被验证。
      - balanced（8×8）需要 ≥ 3000 节点 → TODO 1 远档建议至少 3000。
      - detailed（4×4）就算 10000 节点也找不到 → 长途不适合 4×4，detailed 仍会失败。

- [~] **TODO 4：长距离时降级到单策略全预算。**（已关闭，不需要）
  原计划：当直线距离 > 某阈值（例如 300）时，F4 预览只跑一条策略、`maxSearchedNodes = Infinity`。
  TODO 2 + TODO 3 完成后，Lisbon → Mombasa 预览三策略并行只用 34ms，UI 完全不卡，
  用户能看到完整三色对比，没必要再退化成单策略。

每条 TODO 完成后需要补充：

- 单元测试或仿真测试覆盖 Lisbon → Mombasa。
- 在本节下记录实测效果（成功/失败、用时、路线观感）。

最终状态：

- TODO 2、TODO 3 已落地，回归测试位于
  [src/game/world/autoNavigation.test.ts](/home/laozhu/project/uncharted-waters-2/src/game/world/autoNavigation.test.ts)
  的 `Lisbon to Mombasa preview at production budget finds offshore and balanced routes`。
- TODO 1、TODO 4 实测后判断不必再做，已标记关闭。

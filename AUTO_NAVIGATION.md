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

这些策略目前仍然是“整条路线使用同一种网格精度”。即使 `远海航线` 最后 fallback 到
`8 x 8` 或 `4 x 4`，也是整条路线重新规划，不是分段混合。

F4 地图显示规则：

- 蓝色路线：`稳健航线` 预览路线。
- 橙色路线：`细致航线` 预览路线。
- 紫色路线：`远海航线` 预览路线。
- 黄色路线：当前正在执行的自动导航路线。
- 切换港口时不会立刻重新寻路，避免长途路线计算导致界面卡住。
- 点击“预览航线”时才计算三种预览路线，界面会先显示“计算中”。
- 切换策略只决定“自动导航”实际使用哪条路线，不会重新计算路线。
- 点击“自动导航”时，会使用当前选中策略对应的已预览路线启动实际航行。
- A\* 搜索有最大搜索节点上限。F4 预览会按直线距离使用不同预算：近距离目标使用较高预算，避免 Lisbon -> Barcelona 这类正常近岸路线被误判失败；远距离或复杂目标使用较低预算，像 Hormuz 附近到 `98. Changan` 这类可能没有海路或需要穿越复杂内陆/近岸区域的目标，某条策略超过上限后会返回“无路线”，避免 F4 界面长时间停在“计算中”。
- 三种策略预览会共享相同网格精度的计算结果，避免 `8 x 8`、`4 x 4` 在同一次预览中重复计算。
- F4 预览使用轻量寻路，不计算昂贵的海岸惩罚，只用于比较路线和确认大致连通性；实际启动自动导航时仍会使用完整路径和航行逻辑。
- 自动导航运行中会显示完成百分比、已通过导航点数、剩余导航点数、连续停滞次数和当前坐标。

进度目前按 waypoint 推进计算：

```text
完成百分比 = 已经跳过的 waypoint 数 / 总 waypoint 数
```

因此如果船卡在某个区域，“已通过导航点”会长时间不变，同时“连续停滞”数字会升高。如果触发
`useAlternateAxis`，F4 面板会显示“脱困中”。

## 航向如何从 waypoint 计算？

`getAutoNavigationHeading()` 会读取当前位置和当前 waypoint，然后调用 `getDirectionToPosition()` 算出下一步 heading。

当前策略是单轴优先：

- 如果 x 方向差距更大，先走 `e` 或 `w`。
- 如果 y 方向差距更大，先走 `n` 或 `s`。
- 如果某一轴已经接近，再走另一轴。

自动导航不再直接使用斜向追 waypoint，因为近岸斜向移动更容易被船体碰撞卡住。

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

这表示临时改用另一轴向。例如主方向向南被海岸挡住时，尝试向西离岸。位置恢复移动后，`useAlternateAxis` 会重置。

## 到达判定

当前有两种到达距离：

- 普通 waypoint：`REACHED_WAYPOINT_DISTANCE`
- 最终目标点：`REACHED_TARGET_DISTANCE`

普通 waypoint 到达半径较大，避免船为了精确命中贴岸 waypoint 而卡住。

最终目标点到达半径较小，避免离目标港太远就结束自动导航。

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

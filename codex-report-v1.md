# 自动导航改进评估报告 v1

## 说明

本报告基于当前仓库代码独立审查生成，未参考 `deepseek-report-v1.md` 和 `claude-report-v1.md`。

审查范围主要包括：

- `src/game/world/autoNavigation.ts`：A* 寻路、深度搜索、waypoint 跟随、卡住恢复、调试快照。
- `src/interface/world/WorldMap.tsx`：F4 世界地图、航线预览、深度搜索和启动自动导航。
- `src/game/world/worldCharacters.ts`、`src/game/world/worldPlayer.ts`：海上循环、玩家移动、碰撞和速度接入。
- `src/map.ts`、`WORLDMAP.md`：世界地图碰撞规则和 tilemap 约束。
- `src/game/world/autoNavigation.test.ts`：现有导航回归测试。

## 当前实现概况

自动导航已经不是简单直线追踪。当前实现有三类常规策略和一个深度策略：

- `balanced`：8x8 粗网格失败后退回 4x4。
- `detailed`：直接 4x4。
- `offshore`：12x12 失败后退回 8x8、4x4。
- `deep`：分块深度搜索，遇到窄水道时局部使用 1x1 tile 级路径。

代码已经处理了几个关键难点：

- 世界横向环绕，A* 启发式和移动方向都考虑 wrap-around。
- 规划节点用 `isWorldSea()` 验证 2x2 船体占用，不只是中心点是否为海。
- A* 支持海岸惩罚、斜向切角限制和线段穿陆检测。
- 深度路线用 `setTimeout` 分块执行，避免长搜索完全阻塞 UI。
- 运行中有停滞检测、单轴脱困、深度路线局部 A* 绕行和调试浮层。
- 已有一批具体回归测试，例如 Lisbon -> Hormuz、Lisbon -> Mombasa、Nome -> Santa Barbara、Changan 窄水道、Stockholm channel、Panama isthmus 等。

整体看，当前实现已经跨过“能用”的阶段，主要问题不在于缺少 A*，而在于：导航系统把搜索、跟随、局部避障、调试、UI 预算和特殊场景补丁都堆在一个模块里，长期会越来越难维护；同时缺少全局批量验证，很容易修好一条航线又破坏另一条航线。

## 优先级 P0：建立批量航线审计工具

当前测试覆盖了一些高价值路线，但自动导航的失败通常不是单点 bug，而是某一类海峡、群岛、港口入口或粗网格连通性的问题。只靠手写案例会遗漏大量路线。

建议新增一个 headless 审计脚本，例如：

```bash
npm run audit:navigation
```

它至少应覆盖：

- 所有港口到所有港口，或先覆盖每个港口到若干代表港口。
- 每条规划路径的 waypoint 是否为可通行海面。
- 每两个 waypoint 之间是否存在穿陆线段。
- 对抽样路线运行真实 `getAutoNavigationHeading()` + `calculateDestination()` 仿真，确认不会持续停滞。
- 输出失败路线、失败 segment、坐标、策略、搜索节点数、停滞位置和当前 debug reason。

原因：`autoNavigation.test.ts` 已经有很多真实世界回归，但它仍是人工挑选案例。自动导航这种系统更适合用批量审计做“地图级健康检查”，再把典型失败收敛成单元测试。

## 优先级 P0：统一“规划可通行”和“真实移动可通行”的判定

当前规划用 `isWorldSea()` 判断 2x2 船体，真实移动通过 `map.collisionAt()` 和 `calculateDestination()` 做碰撞滑动。两套逻辑很接近，但不是同一个抽象：

- `isWorldSea()` 在 `autoNavigation.ts` 中直接读取 `worldTilemap`。
- `map.collisionAt()` 在 `src/map.ts` 中也以 tile >= 50 判断陆地，并处理 out-of-bounds。
- `worldPlayer.move()` 对斜向移动先横后纵，实际航迹不等于规划里的网格直线。

建议抽出统一的世界碰撞/船体通行模块，例如 `worldCollision.ts`：

- `isShipPositionNavigable(position)`：船体当前位置是否可停。
- `canMoveShip(from, heading, speed)`：给定真实移动规则后是否能移动。
- `isSegmentNavigable(from, to, options)`：验证一个 waypoint segment 是否真实可跟随。

这样 A*、路径审计、局部避障、测试仿真和地图 UI 都复用同一组规则，减少“规划认为能走，玩家实际撞岸”的分歧。

## 优先级 P0：降低预览路线与实际路线的不一致

F4 预览默认不计算海岸惩罚，而点击“自动导航”时非 deep 策略会重新调用 `startAutoNavigation()`，实际路线可能与玩家刚看到的彩色预览不同。界面已有文字说明，但这仍会造成两个问题：

- 玩家以为自己选择的是地图上的某条线，实际出发时路线可能变了。
- 预览通过不代表实际跟随能通过，实际重算失败也可能让用户困惑。

建议改成二选一：

- 预览就计算“实际可执行路线”，并缓存给启动逻辑复用。
- 或者明确区分“快速草图”和“出发前安全规划”，启动后立刻在 F4 上刷新黄色实际路线。

从工程角度，第一种更清晰：预览结果就是将要执行的路线。性能问题可通过 worker、缓存和分阶段预算解决，而不是让用户看到一条近似路线。

## 优先级 P1：把 `autoNavigation.ts` 拆成职责明确的模块

`src/game/world/autoNavigation.ts` 已经超过 1500 行，同时包含：

- 网格/坐标转换。
- heap 和 A*。
- 海岸惩罚。
- 深度搜索分块调度。
- waypoint 到达半径。
- 停滞检测和脱困。
- 局部 A* 绕行。
- debug snapshot。
- 多策略预览入口。

建议拆分为：

- `navigationGrid.ts`：grid/position/wrap-around/heuristic。
- `seaPathfinding.ts`：同步 A*、segment clearance、海岸惩罚。
- `deepRouteSearch.ts`：分块搜索、窄水道接驳、取消和进度。
- `autoNavigationFollower.ts`：waypoint 推进、heading 选择、停滞恢复。
- `navigationDebug.ts`：debug reason、快照结构和格式化。
- `autoNavigationStrategies.ts`：策略定义、预算、选择逻辑。

这不是为了“好看”，而是为了后续改动能控制风险。现在任何导航改动都容易影响全模块，测试失败时也难判断是搜索、跟随还是 UI 预算出了问题。

## 优先级 P1：把主线程深度搜索迁移到 Web Worker

深度搜索目前用 `setTimeout` 分块执行，已经比同步搜索好很多。但它仍在主线程上做大量 heap、Map、海岸扫描和 tile 访问。长路线或失败路线仍可能造成帧率下降。

建议：

- 把深度搜索搬到 Web Worker。
- 使用 `AbortController` 或等效协议统一取消。
- 进度返回更结构化的数据：阶段、grid size、searched nodes、open set size、是否正在 tile 级接驳。
- 主线程只负责展示进度和接收最终 path。

这会让 F4 地图、输入、动画和取消按钮更可靠，也能为批量审计复用同一套搜索核心。

## 优先级 P1：从“卡住后补救”升级为“提前避障”

当前跟随器主要是反应式策略：发现连续停滞后切轴，deep 路线再尝试局部 A* 绕行。这个机制能修补很多近岸问题，但玩家体验上仍可能看到船先撞岸、停顿，再恢复。

建议增加前瞻式 steering：

- 每帧对候选 heading 做短距离真实碰撞仿真。
- 不只比较到 waypoint 的方向，而是给 8 个方向打分：接近 waypoint、远离岸线、保持进度、少转向、顺风顺流。
- 如果当前 waypoint 的直线跟随不可行，提前插入局部绕行，而不是等 `stagnantMoves` 达阈值。
- 常规策略也应使用 `getCoastalSafeHeading()` 类似机制，不应只让 deep 策略享受近岸切轴。

这样可以减少“撞上再救”的情况，也能降低停滞阈值调参对体验的影响。

## 优先级 P1：改进路径质量指标，而不只是“找到路线”

当前策略主要根据网格尺寸、海岸惩罚和搜索预算决定路线。它能找到路，但不一定选出更适合玩家的路。

建议为每条候选路线计算并展示：

- 路线总长度。
- 相对直线距离的绕行系数。
- 预计航行天数。
- 预计食物/水消耗。
- 近岸危险段数量。
- 需要穿越的窄水道数量。
- 受风向/洋流影响后的估计速度。

`shipSpeed.ts` 和 `windCurrent.ts` 已经有速度、风和流相关逻辑。自动导航可以先不做完美动态规划，但至少应在 UI 上让玩家知道：这条路线短、那条路线安全、另一条可能更耗补给。

## 优先级 P1：为保存的自动导航路线增加版本和校验

当前保存会持久化 `autoNavigation.path`，并去掉 transient debug 字段。这对深度路线很实用，但有潜在问题：

- 地图数据更新后，旧 path 可能穿陆或不可达。
- 自动导航算法常量变化后，旧 waypoint 半径和跟随逻辑未必适配。
- 港口坐标调整后，旧目标位置可能不再合理。

建议保存：

- `routeVersion`。
- `mapAssetVersion` 或 worldTilemap hash。
- `algorithmVersion`。
- `createdAtPosition`、`createdForTargetPosition`。

加载时如果版本不匹配，应尝试从当前位置重算路线；若重算失败，再取消自动导航并给出提示。

## 优先级 P2：提升窄水道和港口入口的建模

现在 deep route 用 1x1 tile 搜索接驳 Changan 这类极窄水道，这是有效补丁。但长期看，港口入口和窄水道需要更显式的数据模型：

- 港口可设置一个或多个 `approachPoint`。
- 窄水道可预先标注为 corridor 或 gateway。
- 粗网格路径先到 gateway，再切换细网格。
- 港口附近的 endpoint exemption 不应固定用 48px，而应由港口入口几何决定。

这样可以减少 A* 在港口附近猜测，也能让 UI 显示“正在进入某水道/港口入口”。

## 优先级 P2：路径平滑应基于碰撞验证

当前 path 是网格中心点序列，deep 路线可能非常密，常规路线又可能较粗。建议增加碰撞安全的 path smoothing：

- 对连续 waypoint 尝试跳点。
- 只有 `isSegmentNavigable()` 通过时才删除中间点。
- 近岸、窄水道和危险海岸自动降低平滑强度。

收益：

- 远洋段 waypoint 更少，进度更稳定。
- 近岸段保留必要细节，不会过早跳点切陆。
- 保存文件更小，F4 渲染更轻。

## 优先级 P2：调试信息结构化沉淀

现在 debug overlay 已经有 waypoint、距离、半径、航向、海况、局部 A* 目标等信息。建议进一步变成可复现报告：

- 卡住时自动记录最近 N 帧位置、heading、waypointIndex、debug reason。
- 一键复制失败案例为测试 fixture。
- 审计脚本输出同样格式，方便把失败路线加入 Jest。

这样后续遇到“某地走不通”，不用手动抄坐标，可以直接生成回归测试。

## 优先级 P2：NPC 自动导航应复用同一套核心

README 里仍提到为 NPC fleets 增加 pathfinding。当前自动导航核心主要服务玩家，但未来 NPC 航线、贸易 AI、追击/逃跑也会需要路径。

建议在拆模块时把核心设计为无 UI、无全局 state 依赖：

- 输入：start、target、ship profile、route options、map provider。
- 输出：path、cost、diagnostics。
- 玩家 UI 和 NPC AI 只是不同调用者。

这能避免以后为 NPC 再写一套简化寻路，造成行为不一致。

## 建议实施顺序

1. 先做批量航线审计工具，建立当前失败基线。
2. 抽出统一世界碰撞/通行模块，让规划、跟随和测试共用。
3. 解决预览路线与实际路线不一致问题。
4. 拆分 `autoNavigation.ts`，保持行为不变，只做结构调整和测试保护。
5. 将 deep search 搬到 Web Worker。
6. 增加前瞻式 steering 和常规策略近岸安全 heading。
7. 增加路线质量指标、保存版本校验和港口入口建模。

## 结论

当前自动导航已经有不少实战修复，特别是深度搜索、局部 A*、动态 waypoint 半径和窄水道回归测试，说明方向是对的。下一阶段不应该继续只靠单条路线补丁推进，而应把工作重心转到系统化验证和职责拆分：

- 用批量审计发现问题。
- 用统一碰撞模型减少规划/移动分歧。
- 用 worker 和缓存解决性能。
- 用前瞻式避障减少卡住后补救。
- 用路线质量指标让玩家理解为什么选择某条航线。

这些改进完成后，自动导航会从“能处理很多特殊路线”升级为“可验证、可维护、可扩展”的导航系统。

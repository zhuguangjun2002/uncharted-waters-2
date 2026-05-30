# 自动导航改进分析报告（claude-report-v1）

> 本报告独立完成，未参考 `deepseek-report-v1.md`，供后续整合对照使用。
> 日期：2026-05-30 · 范围：`src/game/world/autoNavigation.ts` 及其调用链。

---

## 1. 系统现状梳理

自动导航当前由三层组成：

1. **路径规划层**（`autoNavigation.ts`）
   - `findSeaPath`：同步网格 A\*，支持 `4/8/12` 网格、海岸惩罚、对角通行性检查、分段海面检查（segment clearance）。
   - `createAutoNavigationPath` / `createAutoNavigationPaths`：按策略（`balanced` / `detailed` / `offshore`）组合不同网格大小，带 fallback。
   - `findDeepRoutePath` + `createChunkedSeaSearch`：分块（chunked）异步 A\*，用于超远航线，含 tile 级窄水道兜底与双向 flood 判定主洋。

2. **航行跟随层**（`getAutoNavigationHeading`）
   - 贪心地朝当前 waypoint 计算航向，含到达半径判定、停滞检测、单轴脱困、近岸切轴，以及（仅 `deep`）局部 A\* 绕行。

3. **接入层**
   - `actionsWorld.ts`：`startAutoNavigation` / `updateAutoNavigation` / `cancelAutoNavigation`。
   - `worldCharacters.ts`：每帧调用 `updateAutoNavigation(player.position())`，方向键输入会取消导航。
   - `WorldMap.tsx`（F4）：目标选择、三色预览、深度搜索、进度与诊断面板。

整体架构清晰、文档（`AUTO_NAVIGATION.md`）翔实，且有较完整的回归测试。下面按**优先级**列出可改进点。

---

## 2. 高优先级问题

### 2.1 非 deep 策略缺少"卡住后恢复"机制（鲁棒性最大短板）

`getAutoNavigationHeading` 中，**只有 `deep` 策略**在停滞时会触发局部 A\* 绕行重规划（`autoNavigation.ts:839-946`）。`balanced` / `detailed` / `offshore` 三种常规策略一旦在近岸/海峡被地形楔住，唯一的自救手段是 `useAlternateAxis` 单轴脱困（`:829-833`）和近岸切轴（`getCoastalSafeHeading`，且该函数也只在 deep 下被调用，见 `:1019-1030`）。

后果：

- 常规策略的跟随器若进入"贴着海岸来回振荡"的死局，**永远不会从当前实际位置重新规划全局路径**，只能一直抖动直到玩家手动取消。
- 这与文档里反复记录的"在某海岸卡住"类 bug 同源——补丁大多只加在 deep 路径上。

**建议**：

- 把"连续停滞超过阈值 → 从当前位置对剩余目标做一次有界 A\* 重规划"提升为所有策略共享的通用恢复逻辑，而不是 deep 专属。
- 至少让常规策略在停滞 N 次后调用一次 `getCoastalSafeHeading`（目前它被白白限制在 deep）。

---

### 2.2 实际启动时的 A\* 是**无预算同步**计算，可能冻结主线程

- `startAutoNavigation`（`actionsWorld.ts:46-63`）调用 `createAutoNavigationPath`，其 `maxSearchedNodes` 默认 `Number.POSITIVE_INFINITY`。
- `findSeaPath` 是**同步**的（非 chunked）。F4 里虽然用 `window.setTimeout(..., 50)` 包了一层（`WorldMap.tsx:657`），但那只是让 UI 先刷一帧"正在规划"，真正的 A\* 一旦开跑仍会**整段阻塞 JS 主线程**。
- 远距离 + `detailed`（仅 4×4）这种最坏组合，按文档自己的 bench，4×4 绕非洲需要 ~20000 节点甚至更多；无预算同步搜索在低端机上可能造成明显卡顿/掉帧。

**建议**：

- 让常规策略的"真实启动"复用 `createChunkedSeaSearch` 的分块异步框架（目前只有 deep 用），统一成"所有真实规划都分块、可取消、带进度"。
- 或至少给真实启动设一个合理的 `maxSearchedNodes` 上限并在超限时优雅降级/提示。

---

### 2.3 预览路线与实际航线规则不一致，UX 易误导

- 预览：`createAutoNavigationPaths` 默认 `useCoastPenalty = false`、节点数有界（`WorldMap.tsx:32-34` 的三档预算）。
- 实际：`createAutoNavigationPath` → `findSeaPath` 用 `useCoastPenalty = true`、节点数无界。

因此会出现：

- 预览能画出线、点"自动导航"后实际可能耗时更久、甚至因不同参数表现不同；
- UI 已经不得不挂一条免责说明（`WorldMap.tsx:965-968`"实际黄色航线可能与预览略有差异"）。

这本质是**两套不同的规划口径**，对玩家是认知负担。

**建议**：

- 预览直接复用与真实启动相同的参数（含海岸惩罚），只靠"节点预算/分块"区分快慢，使预览成为真实结果的忠实近似，去掉免责声明。
- 或者点"自动导航"时**直接复用已算好的预览路径**（deep 已经这么做了，见 `WorldMap.tsx:629-635` 传入 `deepRoutePath`），常规策略却丢弃预览重算（`:657-662`），存在重复计算。

---

### 2.4 路径代价完全不含风向/洋流，长途可能逆风慢航

`getShipSpeed`（`shipSpeed.ts`）显示航速强依赖风向（`tackingFactor`、`shipWindFactor`），逆风/侧逆风显著掉速。但 A\* 的代价只有几何距离 + 海岸惩罚，**与时间无关**。结果是规划出的"最短几何航线"未必是"最快到达航线"，长途尤其明显。

文档 `后续可改进方向` 也列了此项。考虑到风向按海区/季节相对稳定（`windCurrent.ts`），这是可落地的。

**建议**：把每段移动代价从"距离"改为"距离 / 预期航速"（用该 waypoint 所在海区的当季主导风估算），让 A\* 自然偏好顺风航段。

---

## 3. 中优先级问题

### 3.1 两套 A\* 实现严重重复，维护风险高

`findSeaPath`（`:349-563`）与 `createChunkedSeaSearch`（`:1137-1392`）几乎是同一套 A\*：邻居展开、对角通行性、海岸惩罚、`gScore`/`cameFrom`/`closedSet`/二叉堆全部各写一遍。同理 `getCoastPenalty`（`:280`，惩罚 20/8/3/1，半径 16）与 `getDeepGridCoastPenalty`（`:1197`，惩罚 `radius-dist+1`，半径 3）也是两套**口径不同**的海岸惩罚。

风险：改一处 bug/调一处参数容易漏掉另一处；文档里的历史 bug 多次因为"只改了一边"复发。

**建议**：抽出一个公共的"A\* 核心 + 可注入的代价/通行性/分块调度"模块，`findSeaPath` 与 chunked 版都基于它；海岸惩罚统一为单一函数 + 参数化半径/权重。

### 3.2 海岸惩罚是每格 O(radius²) 环扫，开销可观

`getCoastPenalty` 半径 16 时，单格最坏要扫 ~33×33≈1089 个点，每个点 `isSea` 又是 4 次 tilemap 查表。虽有 `coastPenaltyCache` 按格缓存，但首次填充与大网格仍偏重。

**建议**：用一次性预计算的"到最近陆地的距离场"（对整张 tilemap 做一遍多源 BFS / 距离变换）替代逐格环扫，规划期只查表。可显著降低长途规划成本，也为 2.4 的代价改造打基础。

### 3.3 跟随层每帧的全向扫描偏重

- `isOpenSeaForDiagonalHeading`（`:690`）每帧扫 `(2×6+1)²=169` 个 tile，无缓存，每次 `updateAutoNavigation` 都跑。
- deep 下 `getReachedDistance` 每帧对当前点和 waypoint 各算一次 `getCoastPenalty`（环扫，见 3.2）。

每帧（航行循环 `worldCharacters.ts:93`）都做这些扫描，低端设备上是潜在帧率热点。

**建议**：对"开阔海面"判定加按 tile 量化的小缓存，或同样改用 3.2 的距离场查表。

### 3.4 缺少策略自动升级

`startAutoNavigation` 只跑选定策略自身的网格 fallback 链。若 `balanced` 失败，玩家必须手动切到 `offshore`/`detailed`，再不行手动点"深度搜索"。对普通玩家不友好。

**建议**：真实启动失败时自动按 `balanced → offshore → detailed → deep` 升级（deep 异步），全程给出明确状态提示，减少手动试错。

### 3.5 路径未做平滑（string-pulling）

A\* 输出的 waypoint 是网格中心点，路线沿 8 方向锯齿前进；跟随器再逐帧重算航向。可在规划后做一次"视线连通"平滑（相邻可直线可达就合并 waypoint），得到更直、更少贴岸抖动的航线，也减小跟随层压力。`isSegmentSea`（`:568`）已经具备视线检测能力，可直接复用。

---

## 4. 低优先级 / 健壮性与体验

- **到达后无自动靠港**：`arrived` 后只是停船（`actionsWorld.ts:111-114`），玩家仍需手动按 E。文档已列为改进项；可加"到港自动靠岸"选项或提示。
- **`reconstructPath` 遇环静默返回空**（`:269-271`）：环=「无路径」会掩盖潜在 bug，建议至少在 DEBUG 下告警。
- **deep 主洋判定靠 `searchedNodes` 比大小**（`:1480-1482`）：用"连通分量大小"近似"哪端是主洋"，两个大海盆场景下可能误判；可作为已知近似记录或加更稳健判据。
- **`runCoarse` 实际用 `FINE_GRID_SIZE=4`**（`:1424-1433`）：命名为 coarse 实为细网格，易误读，建议重命名或加注释澄清。
- **大量魔法常数**（`:22-43`、`:1099-1105`）：调参分散、相互耦合，建议集中为带注释的配置对象，并说明彼此约束关系。
- **ETA / 补给风险未估算**：长途没有预计天数、补给是否够的提示（文档已列）。结合 2.4 的航速模型可顺带给出 ETA。

---

## 5. 测试覆盖缺口

- **风向/洋流未进入仿真**：`autoNavigation.test.ts` 的 `move` 用固定 `testSpeed=0.5`（`:171,197`），不模拟风对航速/航向偏移的影响，因此 2.4 类问题测不出来。
- **仿真碰撞模型 = 规划碰撞模型**：测试的 `collisionAt`（`:184-195`，4 offset、tile≥50）与 `isWorldSea` 同口径——这点与游戏世界态 `map.ts:302-307` **是一致的**（已核对，无 mismatch），但也意味着测试无法暴露"规划口径与真实口径若将来分叉"的风险；若后续给世界态加特殊地形/水深，需同步更新两处并补测。
- **缺常规策略卡死回归**：现有 deep 用例较多，但 2.1 指出的"常规策略贴岸振荡"缺少针对性仿真用例。建议补一个会让 `balanced` 跟随器楔住的场景，验证 2.1 的通用恢复逻辑。

---

## 6. 建议优先级汇总

| 优先级 | 项 | 价值 | 大致成本 |
|---|---|---|---|
| P0 | 2.1 常规策略通用"停滞重规划" | 直接消除一大类"卡住"投诉 | 中 |
| P0 | 2.2 真实启动改分块异步/限预算 | 消除潜在主线程冻结 | 中 |
| P0 | 2.3 统一预览与实际规划口径 | 去除 UX 误导 + 省一次重算 | 中 |
| P1 | 2.4 代价含风向（距离/航速） | 航线更真实、更快到达 | 中高 |
| P1 | 3.1 合并两套 A\* / 海岸惩罚 | 根治"只改一边"复发 bug | 中 |
| P1 | 3.2 海岸距离场预计算 | 规划与每帧扫描双双提速 | 中 |
| P2 | 3.4 策略自动升级 | 降低手动试错 | 低 |
| P2 | 3.5 路径平滑 | 航线更直、少抖动 | 低中 |
| P3 | 第 4、5 节各项 | 体验与可维护性打磨 | 低 |

---

## 7. 一句话结论

规划器（尤其 deep）的能力已经相当强，**当前最大的杠杆不在"更聪明的搜索"，而在三处工程化收口**：(1) 让"卡住后重规划"对所有策略生效；(2) 让真实启动像 deep 一样分块异步、不冻结；(3) 让预览与实际共用同一套规划口径。三者落地后，再投入风向代价与双向/JPS 等算法升级，收益最稳。

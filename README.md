# Uncharted Waters: New Horizons

![build status](https://github.com/JohanLi/uncharted-waters-2/actions/workflows/build.yml/badge.svg?branch=master)

[Uncharted Waters: New Horizons](https://en.wikipedia.org/wiki/Uncharted_Waters#Uncharted_Waters:_New_Horizons)
(大航海時代II) 是一款 1994 年发行的 open world RPG 和 simulation game，
背景设定在 Age of Exploration。作为我童年最喜欢的游戏，我正在使用 web
technologies 重制它。

这个项目并不打算接近完整重制。我是一名正在转向 consulting work 的 web
developer，这个 side project 可以让潜在雇主了解我的代码。

新手本地运行步骤见 [本地运行指南](LOCAL_DEVELOPMENT.md)。注意：本项目的
PNG、OGG 等资源通过 Git LFS 管理，本地运行前需要先安装 Git LFS 并执行
`git lfs pull`，否则页面可能一直停在“正在加载...”。

<p align="center">
  <img src="https://media.githubusercontent.com/media/JohanLi/uncharted-waters-2/readme-assets/uncharted-waters-2.png" alt="Uncharted Waters: New Horizons">
  原版游戏截图
</p>

## 功能

- 可以在 130 个 ports 中任意行走，并进入其中的 buildings。
- 可以在 world map 上航行，航速会纳入原版游戏中的全部影响因素。
- 按 `F3` 打开存档面板，提供 10 个存档位，支持保存、读取、删除和重新开始（保存在浏览器
  `localStorage`）。

可以在 [https://johan.li/uncharted-waters-2/](https://johan.li/uncharted-waters-2/)
游玩本项目。

#### Roadmap 下一步

- Markets
  - Trade goods，并考虑 price indices。
- Shipyards
  - 购买和 remodel used ships。
- Pubs
  - Recruit crew。

## 架构

更详细的开发说明见 [架构说明](ARCHITECTURE.md)。

游戏由两部分组成：
- **game** 本体，即一个 canvas element
- **interface**/GUI，由 React 处理

**game loop** 会读取 **State** 和 **Input**，并更新 canvas element。

在 gameplay 过程中，会调用 **actions** 更新 **State**。Actions 本身可以调用
**updateInterface**，后者封装了 React 的 `useState` hooks。

**Assets** 会确保 images 和 game data 在游戏开始前完成加载。

<p align="center">
  <img src="https://media.githubusercontent.com/media/JohanLi/uncharted-waters-2/readme-assets/architecture.png" alt="Architecture" width="560">
</p>

这两部分各自维护 local state，例如追踪当前 active menu item，或 NPCs 在 port
中的位置。Input 也可以在局部处理，尤其是 interface 相关输入。

#### Game loop

使用 `requestAnimationFrame()`。

State changes，例如读取 Input 并将其转换为 movement，并不会在每一帧都发生；
系统会先检查是否已经经过足够时间。不过每一帧都会对 movement 做 interpolation，
以获得更流畅的 graphics。

#### 为什么没有使用 state management library？

与大多数 web apps 不同，game code 是 imperative 的。它不需要响应变化，因为它会
持续 loop。虽然让 game 和 interface 共用一个 Redux store 看起来是更整洁的做法，
但如果要维持 60 fps，这种方式太慢。

单独的 interface 又太简单，不值得引入 Redux。

#### 后续考虑

- 存档现已落地（10 个存档位写入 `localStorage`），后续可考虑同步到 server，并把 NPC
  舰队位置纳入存档。
- 使用 service worker，让游戏可以 offline 游玩。
- 为 NPC fleets 增加 pathfinding。

# Repository Guidelines

## 项目结构与模块组织

本项目是基于 TypeScript、React 和 Webpack 的网页版 *Uncharted Waters: New Horizons* 重制项目。源码位于 `src/`。核心 Canvas 游戏逻辑在 `src/game/`，React 界面组件在 `src/interface/`，数据表和 WASM 资源在 `src/data/`，静态首页在 `src/homepage/`。单元测试与代码放在一起，命名为 `*.test.ts` 或 `*.test.tsx`；Cypress 端到端测试位于 `tests/e2e/`。

## 构建、测试与开发命令

- `npm start`：启动 Webpack 开发服务器。
- `npm run build`：清理 `build/` 并生成生产构建。
- `npm test`：使用 `@swc/jest` 和 `jsdom` 运行 Jest 单元测试。
- `npm run lint`：对 `src/**/*.ts` 和 `src/**/*.tsx` 运行 ESLint。
- `npm run prettier`：格式化 `src/` 和 `tests/`。
- `npm run cypress`：打开 Cypress 测试界面。
- `npm run test:e2e`：构建项目，在 `8080` 端口服务 `build/`，并用 Chrome 运行 Cypress。

## 编码风格与命名约定

使用 TypeScript 严格模式。遵循现有风格：两个空格缩进、单引号、尾随逗号，React 函数组件使用 `.tsx`。函数和变量使用描述性的 camelCase，组件和导出类型使用 PascalCase，文件名应贴近领域含义，例如 `worldPlayer.ts` 或 `HarborSupply.tsx`。ESLint 继承 Airbnb TypeScript 和 React 规则；格式化由 Prettier 负责。

## 语言规范

项目描述默认使用中文。新增贡献说明、开发总结、任务跟踪和交接记录应使用中文；已有英文内容如果需要保留上下文，可以不强行改写。

## 测试规范

规则、状态和工具函数变更应新增或更新对应的 Jest 测试。测试文件按被测模块命名，例如 `shipSpeed.test.ts` 或 `portUtils.test.ts`。浏览器流程使用 `tests/e2e/*.cy.ts` 中的 Cypress 规格覆盖，例如 harbor、lodge、pub、bank、shipyard 和 item shop 行为。提交前运行 `npm test`；修改 UI 流程或路由行为时运行 `npm run test:e2e`。

## 提交与 Pull Request 规范

近期提交采用简短的 conventional-style 格式，例如 `feat: Pub`、`fix: compile error`、`refactor: change .bin files to .wasm...` 和 `chore: PUBLIC_PATH`。提交信息保持祈使语气，并聚焦单一变更。Pull Request 应包含简洁的行为说明、已运行的测试、相关 issue 链接；涉及可见 UI 变化时附截图或录屏。

## 安全与配置提示

大型二进制资源通过 Git LFS hooks 管理。提交或推送前确认已安装 `git-lfs`。不要提交生成的 `build/` 输出、本地 Cypress 截图、凭据或机器相关配置。

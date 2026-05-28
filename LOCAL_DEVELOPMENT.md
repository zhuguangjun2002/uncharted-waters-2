# 本地运行指南

本文档面向刚开始接触前端项目的新手，目标是帮助你在自己的电脑上把游戏跑起来。

## 你需要准备什么

需要先安装：

- **Node.js**：建议使用 Node.js 18 LTS 或更新的 LTS 版本。
- **npm**：安装 Node.js 时通常会一起安装。
- **Git**：如果你需要从 GitHub clone 项目。

可以在终端中检查是否已经安装：

```bash
node -v
npm -v
git --version
```

如果能看到版本号，说明对应工具已经可用。

## 获取项目代码

如果你已经在项目目录里，可以跳过这一步。

如果还没有代码，可以用 Git clone：

```bash
git clone <项目仓库地址>
cd uncharted-waters-2
```

如果你是直接下载 zip 文件，也可以解压后在终端进入项目目录。项目目录里应该能看到 `package.json`、`README.md`、`src/` 等文件。

## 安装依赖

在项目根目录执行：

```bash
npm install
```

这一步会读取 `package.json` 和 `package-lock.json`，把 React、Webpack、TypeScript、Jest、Cypress 等依赖安装到 `node_modules/`。

第一次安装可能需要一些时间。如果网络较慢，等待即可。

## 启动开发服务器

安装完成后执行：

```bash
npm start
```

这个命令会启动 Webpack dev server。终端里通常会显示一个本地访问地址，例如：

```text
http://localhost:8080/
```

如果端口被占用，Webpack dev server 可能会提示使用另一个端口。以终端实际输出的地址为准。

## 在浏览器中打开游戏

打开浏览器，访问终端显示的地址，例如：

```text
http://localhost:8080/
```

页面会先显示“正在加载...”，资源加载完成后进入游戏界面。

## 如何停止程序

回到运行 `npm start` 的终端，按：

```text
Ctrl + C
```

如果终端询问是否终止，输入 `y` 并回车。

## 常用命令

### 启动本地开发环境

```bash
npm start
```

用于日常开发。修改 `src/` 中的代码后，浏览器通常会自动刷新或热更新。

### 运行单元测试

```bash
npm test
```

用于运行 Jest 测试。修改规则、状态、工具函数后建议运行。

### 检查代码风格

```bash
npm run lint
```

用于运行 ESLint，检查 TypeScript/React 代码是否符合项目规则。

### 格式化代码

```bash
npm run prettier
```

用于格式化 `src/` 和 `tests/`。

### 生成生产构建

```bash
npm run build
```

用于生成 `build/` 目录。这个目录是生产环境可部署的静态文件。

### 运行 E2E 测试

```bash
npm run test:e2e
```

用于构建项目、启动本地静态服务，并用 Cypress 跑浏览器端流程测试。新手日常运行项目不需要执行这个命令。

## 常见问题

### `npm install` 很慢或失败

常见原因是网络访问 npm registry 不稳定。可以稍后重试，或者确认当前网络能访问 npm。

### 提示 `npm: command not found`

说明 npm 没有安装或没有加入系统 PATH。先安装 Node.js LTS 版本，然后重新打开终端再试。

### 提示 `node: command not found`

说明 Node.js 没有安装或没有加入系统 PATH。安装 Node.js 后重新打开终端。

### `npm start` 后浏览器打不开

先看终端里实际输出的地址。不要固定认为一定是 `8080` 端口，如果端口冲突，dev server 可能会换端口。

也可以检查：

- `npm start` 是否还在运行。
- 终端有没有报错。
- 浏览器地址是否和终端输出一致。

### 页面一直停在“正在加载...”

可能是资源加载失败或代码运行时报错。可以打开浏览器 DevTools：

- Chrome/Edge：按 `F12`，或右键页面选择 Inspect。
- 查看 Console 是否有红色错误。
- 查看 Network 是否有资源加载失败。

### 修改代码后没有变化

可以尝试：

- 刷新浏览器。
- 停止 `npm start` 后重新运行。
- 确认修改的是 `src/` 下正在被引用的文件。

## 推荐的新手流程

第一次运行：

```bash
npm install
npm start
```

日常开发：

```bash
npm start
```

准备提交前：

```bash
npm test
npm run lint
```

如果只改了 Markdown 文档，通常不需要运行测试。

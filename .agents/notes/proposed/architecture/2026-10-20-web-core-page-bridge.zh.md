# Agent Note: Web Core 页面桥接

Status: proposed

[English](2026-10-20-web-core-page-bridge.md) | 中文

## Problem

Web 版(issue #21728)在浏览器的 Core Worker 里运行桌面端的主进程服务([数据库 Spec](2026-10-20-web-core-database.md)、[对话层 Spec](2026-10-20-web-core-ai.md))。桌面端界面只通过 Electron IPC 访问这些服务:preload 定义 `window.api` 和 `window.electron`,渲染进程的 `DataApiService`、`PreferenceService`、`CacheService`、`ipcApi` 封装和对话传输层都建立在它们之上。页面里没有 Electron,所以这些代码都跑不起来。Worker 目前运行的也是 Web 专用服务:只读的 `WebPreferenceService`、数据传不到页面的 `WebCacheService`,以及代替 DataApi IPC 通道的 `request` 命令。如果单独给 Web 写一个 `window.api`,就要复制 270 行的 preload,而且桌面端每改一次都会和它产生偏差。

## Proposal

通过 Worker 的 `postMessage` 模拟桌面端用到的那部分 Electron IPC,让原样的 preload 和渲染进程服务在页面里运行,由 Worker 里原样的主进程服务应答。所有改动都在 `packages/web-core` 里;`src/main`、`src/preload` 和 `src/renderer` 下没有文件被修改。

1. **Worker 侧的 `electron` 替身。** `ipcMain` 维护 `handle` 和 `on` 的注册表(同一通道注册第二个处理函数会抛错,和 Electron 一样)。页面是唯一的窗口:只有一个 `webContents`,它的 `send` 向页面发送一条广播消息;另外提供服务会用到的 `BrowserWindow` 查找方法。新增的 Worker 命令 `ipc-invoke` 和 `ipc-send` 负责执行已注册的处理函数。
2. **页面侧的 `electron` 替身。** `ipcRenderer.invoke` 和 `send` 变成上面两个命令,`on` / `once` / `off` 的监听器接收 Worker 的 `webContents.send`。页面连上 Worker 之前发出的调用会等待连接。`invoke` 失败时保留 Electron 的错误措辞。`contextBridge`、`shell.openExternal`(打开新标签页)和 `webUtils.getPathForFile`(返回 `''`,Electron 对不在磁盘上的文件也是这样)补齐了 preload 引用的其余接口。
3. **原样的桌面端 preload 在页面里运行**(`src/page/preload.ts`)。`@electron-toolkit/preload` 换成页面版的 `window.electron`(其中的 `ipcRenderer`,以及一个根据 User-Agent 得出平台的 `process`)。`process.contextIsolated` 被定义为 `false`,所以 preload 会直接给 `window.api` 赋值。
4. **Worker 运行桌面端服务,取代 Web 专用服务。** `CacheService`、`DataApiService` 和 `IpcApiService` 随 Worker 启动。`PreferenceService` 在账号打开时启动,之前先像桌面端首次启动那样写入默认设置行。以下模块被替换:
   - `BootConfigService`:默认值放在内存里。
   - `validateSender`:专用 Worker 只会收到自己页面发来的消息。
   - DataApi 处理函数表:话题、消息、服务商、模型和助手。
   - IpcApi 处理函数表:`ai.stream.*` 路由。其他路由一律答复 Web 版不提供该功能。
   - `ai.*` 处理函数引用的 Agent 入口模块。
   - `CacheService` 的持久化文件:改为保存在内存里。
   - `WindowManager`:只有页面这一个窗口。

   Worker 还会接收并丢弃 `App_LogToMain`,因为页面已经把日志写到了自己的控制台。它还给定时器提供 Node 风格的句柄,因为 `BaseService.registerInterval` 会调用 `unref()`。
5. **按导入方区分的别名。** `@logger`、`@data` 和 `electron` 在桌面端主进程和渲染进程里指向不同的模块。一次构建同时包含两侧的代码,所以由一个解析插件根据导入方的位置选择目标:`src/renderer`、`src/preload` 和 `packages/web-core/src/page` 使用渲染进程的目标,其余使用主进程的目标。`@renderer` 和 `@cherrystudio/ui` 解析到源码,和渲染进程的 tsconfig 一致。页面侧文件按渲染进程的 tsconfig 做类型检查。
6. **一个桥接测试页**(`harness/bridge.html`)加载 preload 和渲染进程服务。`e2e/bridge.spec.ts` 在 Chromium、WebKit 和 Firefox 中驱动它。

不在本 Spec 范围内:对话界面组件(执行流叠加层和 React hooks)、路由、登录、Agent、附件,以及 `ai.stream.*` 以外的 IpcApi 路由。

## Alternatives considered

- **基于 Core Worker 客户端单独写一个 Web 版 `window.api`。** 这会复制 preload,桌面端每加一个接口都要再实现一遍。模拟 IPC 则只需要一份 preload。
- **按服务做 RPC(例如 Comlink)。** 这是桌面端渲染进程没有使用的通信方式,渲染进程服务就需要 Web 版变体。
- **让 `BaseService.registerInterval` 改为调用 `handle.unref?.()`。** 这一行桌面端改动可以省掉 Node 风格的定时器句柄。是否采用交给维护者决定;Worker 里的兼容层不需要修改桌面端。
- **每次构建使用不同的别名集合。** 开发模式下 Vite 也会对 Worker 运行页面的插件,两侧会共用同一套解析。按导入方区分在开发和生产构建中结果一致。

## Acceptance criteria

- AC1 — 原样的桌面端 preload 在页面里运行。它的 `ipcRenderer.invoke` 能到达 Worker 的 `ipcMain` 处理函数:DataApi 请求和 IpcApi 路由都有应答。未注册的通道以 Electron 的 "No handler registered" 措辞失败。(verification: 打包产物)
- AC2 — 渲染进程的数据服务不经修改即可工作。DataApi 写入会通知页面。修改设置会通知到页面上订阅了该设置的监听器,刷新页面后设置仍在。共享缓存双向同步:从页面到 Worker,以及从 Worker 把流状态同步到页面。(verification: 打包产物)
- AC3 — 在 Chromium、WebKit 和 Firefox 中,渲染进程的对话传输层通过 `ai.stream.open` 发起一轮对话。页面通过渲染进程的 `ipcApi` 收到回复的文字片段,这一轮结束时话题流关闭,两条消息都以 `success` 写入数据库。(verification: 打包产物)
- AC4 — 现有的数据库和对话测试在三种浏览器中仍然通过。Worker 构建中没有 Node 内置模块、Electron 或原生模块的引用。`src/main`、`src/preload` 和 `src/renderer` 下没有文件被修改。(verification: 打包产物及变更范围报告)
- AC5 — 记录桥接页面 JavaScript 的 gzip 大小。(verification: 打包产物,结果记入 implemented 笔记)

## Risks

- **页面侧代码按目录划分。** 不在所列目录下的页面入口会把 `@logger`、`@data` 和 `electron` 解析成主进程模块。如果因此引入了 Electron 或 Node 模块,构建会失败;但如果引入的模块在浏览器里也能加载,就会悄悄打包进去。
- **Worker 里的 Node 风格定时器句柄。** 在 Worker 中 `setInterval` 返回带 `unref()` 的 `Number` 对象。用 `===` 比较定时器 id 的代码会出错;目前打包的代码里没有这种用法。
- **不提供的 IpcApi 路由和 Electron 接口。** 调用其他路由、`ipcRenderer.sendSync` 或其他 Electron 接口的渲染进程功能会在页面里失败。界面 Spec 必须把这些功能隐藏起来。
- **preload 必须留在 `sideEffects` 列表里。** `packages/web-core` 其余部分都声明为没有副作用;打包工具会悄悄丢掉没有列出的副作用导入,`window.api` 就会是 undefined。
- **页面体积。** 渲染进程的对话路径引用了 toast,所以 `@cherrystudio/ui` 和 i18n 会进入页面的打包产物。
- **刷新后共享缓存会丢失。** Worker 随页面一起重启,就像桌面端重启应用时主进程也会重启一样。

# Agent Note: Web Core 应用

Status: proposed

[English](2026-10-20-web-core-app.md) | 中文

## Problem

Web 版(issue #21728)是一个免安装的试用版:登录、对话、Agent 和一个简单的设置页。Core Worker 现在运行桌面端的主进程服务,原样的桌面端 preload 和渲染进程服务能从页面访问它们([页面桥接 Spec](2026-10-20-web-core-page-bridge.md))。但页面还没有界面。如果单独给 Web 写一套界面,就要重做输入框、消息列表、助手列表和设置页,而且桌面端每改一次都会和它产生偏差。另外,桌面端主窗口需要的比桥接目前提供的更多:完整的 DataApi 处理函数表、桌面端启动时写入的数据行,以及它启动时调用的 IpcApi 路由。

## Proposal

Web 页面就是原样的桌面端主窗口(`src/renderer/windows/main/entryPoint.tsx`),只是为浏览器构建。除了 `scripts/validation` 里的校验计划,所有改动都在 `packages/web-core` 里;`src/main`、`src/preload` 和 `src/renderer` 下没有文件被修改。

1. **和桌面端渲染进程共用一份构建配置。** `vite.app.config.ts` 加载 `electron.vite.config.ts`,复用其中渲染进程的 define、插件和别名。`@logger` 和 `@data` 仍然按导入方区分。Worker 的构建配置和测试页共用。
2. **页面入口**(`app/main.ts`)运行 preload,启动 Core Worker,把页面的 `prefers-color-scheme` 作为系统主题上报,打开账号,然后导入桌面端入口。在有登录之前,同一个浏览器的所有访问者都使用同一个 `local` 账号。
3. **Worker 提供完整的桌面端 DataApi 处理函数表。** 如果某个路由依赖 Web 版不提供的功能,调用时会以 `WebUnsupportedError` 失败。某个 seeder 引用的 v1 → v2 迁移模块被替换:Web 数据库从来没有 v1 数据。
4. **每次打开账号都运行桌面端的 seeder**,和桌面端 `DbService.onInit` 一样。在这之前先运行一个 Web 专用的 seeder,写入 Web 版默认值和桌面端不同的设置:侧边栏只提供对话。桌面端的 seeder 会跳过已有的行,所以用户之后的修改会被保留。
5. **主窗口启动时用到的 IpcApi 路由。** 除了 `ai.stream.*`,Worker 还提供:
   - `app.get_info`:应用版本和 `/web/<namespace>` 路径;
   - `system.get_native_theme` 和 `system.native_theme_updated`,数据由页面上报;
   - `window.get_init_data`:返回 `null`,和主窗口一样;
   - `backup.get_auto_sync_state`:返回没有待处理的通知;
   - 窗口尺寸、协议分发和截图相关路由:什么都不做。

   `application.getPath` 返回 `/web/` 下的绝对 POSIX 路径,因为有些服务会校验它保存的路径。

6. **在页面里替换的渲染进程模块。** 关闭 Sentry。设置菜单只保留服务商、默认模型、常规、外观和关于这几项。
7. **校验。** `packages/web-core`、`src/main` 或 `src/renderer` 下的改动也会构建 Web 应用,这样会搞坏浏览器构建的桌面端改动会在 CI 里失败。
8. **测试。** `e2e/app.spec.ts` 在 Chromium、WebKit 和 Firefox 中驱动构建好的应用。

不在本 Spec 范围内:登录和按用户区分的账号、Agent、试用用户的模型来源(网关和 CherryAI 默认值)、附件、首次引导的改动,以及部署(COOP/COEP 响应头、CDN)。

## Alternatives considered

- **单独写一套 Web 界面。** 这会复制对话和设置界面,并且和它们产生偏差。复用主窗口只需要一些路由替身和两个渲染进程模块的替换。
- **在 `src/shared` 和渲染进程里加一个 `web` 版本(edition)。** 在桌面端代码里按版本控制侧边栏、设置和其他入口,可以隐藏所有不提供的功能,而不只是侧边栏和设置里的。这需要改动其他团队负责的渲染进程代码,所以交给维护者决定。有了它之后,这里的模块替换就可以去掉。
- **把渲染进程的别名复制到 Web 配置里。** 桌面端每加一个别名都要再改一次。加载桌面端配置只需维护一份列表。
- **在页面里读取系统主题。** 这需要替换渲染进程的主题 hook。由 Worker 应答现有的 IpcApi 路由,渲染进程就不用改。

## Acceptance criteria

- AC1 — 在 Chromium、WebKit 和 Firefox 中,Web 应用启动时没有页面错误。侧边栏只显示对话,设置里正好是服务商、默认模型、常规、外观和关于这几项。(verification: 打包产物)
- AC2 — 通过桌面端输入框发送的消息,能从 OpenAI 兼容的接口流式收到回复。两条消息都以 `success` 写入数据库,刷新页面后仍然显示。(verification: 打包产物)
- AC3 — 现有的 Web Core 测试在三种浏览器中仍然通过。Worker 构建中没有 Node 内置模块、Electron 或原生模块的引用。`src/main`、`src/preload` 和 `src/renderer` 下没有文件被修改。(verification: 打包产物及变更范围报告)
- AC4 — 对于 `packages/web-core`、`src/main` 和 `src/renderer` 下的改动,校验计划会构建 Web 应用。(verification: 单元测试)
- AC5 — 记录首次访问需要下载的内容的 gzip 大小。(verification: 打包产物,结果记入 implemented 笔记)

## Risks

- **其他入口后面不提供的功能。** 目前只过滤了侧边栏和设置。启动台、全局搜索、"保存到笔记"之类的消息操作以及其他菜单,仍然可能打开会以 `WebUnsupportedError` 失败或调用 Electron 接口的功能。每一个都需要替身,或者上面提到的按版本控制。
- **桌面端的初始数据默认依赖 CherryAI 网关。** seeder 把 `cherryai::qwen` 设为默认模型,所以在试用版的模型来源确定之前,对话和话题自动命名都会失败("CherryAI client secret is not configured")。模型列表是替身,所以"同步模型"也会失败。
- **首次访问会显示引导页。** 其中连接 CherryIN 的流程还没有在浏览器里测试过。
- **每个浏览器只有一个账号。** 在有登录之前,使用同一个浏览器配置的所有人共用 `local` 账号。
- **构建依赖桌面端配置。** 必须在仓库根目录运行;如果某个渲染进程插件在构建时需要 Electron 或 Node,Web 构建就会失败。
- **平台由 User-Agent 推断。** 在 macOS 上,页面会像桌面端一样给窗口按钮留出空间。
- **下载体积。** 不算缓存,首次访问大约要下载 2.3 MB(gzip 后)的 JavaScript,分成约 480 个请求。
- **CI 时间。** 渲染进程和主进程的改动现在也会构建 Web 应用。

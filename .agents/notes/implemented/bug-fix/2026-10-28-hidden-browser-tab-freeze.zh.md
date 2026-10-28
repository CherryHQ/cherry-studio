# Agent Note: 隐藏的浏览器标签页持续全速运行

Status: implemented

[English](2026-10-28-hidden-browser-tab-freeze.md) | 中文

## 问题

在一台生产环境的 v2.1.8 上，一个用户没有在看的浏览器标签页（vercel.com）让它的渲染进程连续 27 小时占用 60-90% CPU，其中约 60% 时间花在垃圾回收上。Cherry Studio 全部进程合计约 82% CPU，几乎都来自这个标签页。

路由标签页通过 React `<Activity>` 隐藏，它会给整个标签页（包括其中的 `<webview>`）设置 `display: none`。Chromium 随后停止绘制该 guest，`requestAnimationFrame` 也随之停止；但 guest 仍以原尺寸报告 `document.visibilityState === 'visible'`，页面收不到 `visibilitychange`，Chromium 也从不对它施加后台标签页的定时器节流。在生产实例上实测，大多数隐藏的 guest 定时器每秒触发约 100 次，与可见页面相同。

每个处于活跃状态的浏览器标签页还各占一个渲染进程。打开 8 个标签页约占 2.1 GB。`TabLruManager` 只在活跃标签页超过 10 个时才会卸载。

## 决策

`WebviewBrowser`（独立浏览器标签页和打开的 HTML 产物都用它渲染）通过 `webview.set_visible` 向主进程报告 guest 的可见性。报告放在 effect 及其 cleanup 中发送，因为隐藏的 `<Activity>` 会执行 effect 的 cleanup，但不会执行 effect 本体。`WebviewService.setGuestVisible` 校验调用方窗口确实拥有该 guest 后，交给 `HiddenGuestFreezer` 处理。

guest 被隐藏时，`HiddenGuestFreezer` 启动一个 `HIDDEN_FREEZE_DELAY_MS`（5 分钟）计时器。计时器到期后，它挂上该 guest 的调试器并发送 `Page.setWebLifecycleState`（`state: 'frozen'`），这正是 Chrome 冻结后台标签页的机制。guest 重新显示时，它发送 `state: 'active'` 并断开调试器。冻结期间调试器保持挂载，因此恢复命令总是在同一会话上排在冻结命令之后。正在播放音频、打开了 DevTools、已挂有调试器，或正被 `--remote-debugging-port` 客户端（由 `RemoteDebuggingMonitor` 跟踪）调试的 guest 不会被冻结。隐藏期间被销毁的 guest 会丢弃其计时器。服务停止时会恢复所有已冻结的 guest。

## 备选方案

- 隐藏几分钟后卸载标签页：未采用，因为会丢失滚动位置、表单输入和单页应用状态等页面状态；`TabLruManager` 已经会卸载超出上限的标签页。
- 一隐藏就立即冻结：用户选择了延迟方案，这样短暂切走时不会打断页面正在做的事，例如流式输出回复。
- 让 guest 报告自己已隐藏：Electron 没有公开 API 能做到。`webContents` 的节流开关只在下一次可见性变化时生效；在 Electron 44 的测试程序中，对隐藏 guest 先 `setBackgroundThrottling(false)` 再 `true`，会让它以约每秒 66 帧持续渲染（[electron/electron#54311](https://github.com/electron/electron/issues/54311)）。
- 重新开启主窗口的 `backgroundThrottling`：未采用。它是为了让流式回复持续刷新而有意关闭的；而且在生产实例上切换它也没有改变隐藏 guest 的 CPU 占用。

## 影响

隐藏超过 5 分钟的浏览器标签页在重新显示前不再执行任何 JavaScript。它的定时器、网络回调和 worker 都会暂停，因此页面在此期间无法完成后台工作。在后台打开、从未显示过的标签页不会被冻结，因为它的 `<Activity>` 处于隐藏状态时 effect 从未执行。因播放音频而被跳过的 guest 会一直运行，直到下一次被隐藏。`AgentBrowserRuntimeHost` 中由 agent 驱动的 guest、小程序以及话题浏览器面板不在本次覆盖范围内。

## 验证

- Regression — `pnpm test:main src/main/services/webview/__tests__/HiddenGuestFreezer.test.ts`：只在完整延迟后冻结、延迟内重新显示则不冻结、恢复并释放调试器、跳过播放音频/打开 DevTools/已被外部挂载调试器/被远程调试端口客户端调试的 guest、丢弃已销毁的 guest、dispose 时恢复。
- Regression — `pnpm test:renderer src/renderer/components/__tests__/WebviewBrowser.test.tsx`（`reports its guest hidden while the tab Activity is hidden so main can freeze it`）：去掉 effect cleanup 中的报告后该测试失败。
- Regression — `pnpm test:main src/main/services/webview/__tests__/WebviewService.test.ts src/main/ipc/handlers/__tests__/webview.test.ts` 与 `pnpm test:renderer src/renderer/pages/browser/__tests__/BrowserPage.test.tsx`：现有 webview 契约测试仍然通过。
- Regression — 独立的开发实例，在浏览器标签页中打开 vercel.com：可见时每秒 61 帧、100 次定时器；隐藏不足 5 分钟时无帧、每秒 67 次定时器、CPU 5-7%；隐藏满 5 分钟后页面冻结，CPU 约 1.5%；重新显示后每秒 58 帧、100 次定时器，调试器已断开。

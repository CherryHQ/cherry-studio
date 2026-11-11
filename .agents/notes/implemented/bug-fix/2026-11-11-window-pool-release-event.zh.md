# Agent Note: 池化窗口回到窗口池时清理按窗口保存的状态

Status: implemented

[English](2026-11-11-window-pool-release-event.md) | 中文

## 问题

关闭一个可回收的池化窗口时，窗口只会被隐藏，同一个 `BrowserWindow`、窗口 id 和已挂载的渲染端都保留下来，留给下一次 `open()` 复用。`WindowManager` 此前只通知创建和销毁，因此在 `onWindowDestroyed` 中清理按窗口保存的状态的服务，会一直把已关闭的窗口当作仍在使用，直到窗口池销毁它，这可能要等上数分钟。

选区 Agent 窗口因此出现两个故障。在 macOS 上，于 200 ms 收起动画期间先按 Cmd+M 再按 Cmd+W，窗口会回到窗口池，随后动画的后续回调仍为它发布胶囊；点击该胶囊会显示一个窗口池仍视为空闲的窗口，它还可能被交给下一次 Agent 动作。另外，该窗口的输入框仍注册为截图目标，关闭窗口后在其他应用中触发全局截图时，截图会回退到这个"最近使用的聊天窗口"，投递进已隐藏的窗口。

## 决策

`WindowManager` 在 `releaseToPool()` 末尾、窗口已隐藏并进入空闲队列之后，触发 `onWindowReleasedToPool`（以及按类型过滤的 `onWindowReleasedToPoolByType`）。`close()` 和被拦截的原生关闭都会走到这里。回池时销毁窗口的情况（未启用回收、超出容量、全屏）只触发 `onWindowDestroyed`，因此同一次关闭不会同时触发两个事件；需要清理按窗口会话状态的服务应同时订阅两者。

`SelectionAgentWindowService` 在两个事件上都清理布局、可替换标记、摘要、收缩中与收起状态。收起动画的后续回调只有在它创建的收起记录仍然有效时，才隐藏窗口并发布胶囊；否则只恢复不透明度，因为窗口池在复用时不会重置不透明度。`ScreenshotChatService` 在两个事件上都清除该窗口的截图目标、"最近聚焦"标记和未完成的投递。

## 备选方案

在 `releaseToPool()` 的每个分支都触发回池事件，会让销毁型回池重复触发 `onWindowDestroyed`，也会模糊现有"真正销毁"的契约。在选区服务内拦截窗口的原生 `close` 或 `hide` 会漏掉 `wm.close()`（它从不发出原生 `close`），也无法区分收起造成的隐藏和关闭。像部分 Electron 窗口池库那样在回池时卸载渲染端内容，同样能释放渲染端注册的状态，但需要改动每个池化窗口的渲染端，而已发现的故障在主进程即可修复。只在重新打开窗口时重置状态为时已晚：两个故障都发生在窗口空闲于池中期间。

## 影响

为可回收窗口池保存按窗口状态的服务现在有了回池信号；WindowManager 的使用指南、API 参考和 README 反模式表都写明了需同时订阅两个事件的规则。渲染端保持不变：回池的窗口在下次打开前仍保持内容挂载，选区 Agent 窗口每次新会话都会重新挂载。原生收起动画无法取消，因此在 200 ms 内对同一窗口依次收起、关闭、重新打开时，该动画仍会作用于被复用的窗口。`DirectoryTreeManager` 和 `FileEditService` 仍只在销毁时释放；选区 Agent 输入框可能创建笔记目录树，它会存活到窗口被复用或窗口池回收为止。关闭回池的 Agent 窗口中未完成的 MCP 请求仍会等到超时，选区 Agent 窗口的笔记已记录这一点。

## 验证

- Regression — `src/main/core/window/__tests__/WindowManager.test.ts`：`close()` 和被拦截的原生关闭都会触发回池事件，重复关闭只触发一次，超出容量的回池只触发 `onWindowDestroyed`；其中三项在没有新事件时失败。
- Regression — `src/main/services/selection/__tests__/SelectionAgentWindowService.test.ts`：在收起动画期间回池的窗口不会发布胶囊，不会被再次隐藏，且最终完全不透明；在旧版服务上失败。
- Regression — `src/main/services/__tests__/ScreenshotChatService.test.ts`：最后使用的聊天窗口回池后，不带来源窗口的截图走普通截图流程，而不是投递给它；在旧版服务上失败。

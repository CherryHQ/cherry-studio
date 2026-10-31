# Agent Note: Agent 浏览器面板的恢复与页面重置

Status: implemented

[English](2026-10-31-agent-browser-pane-recovery.md) | 中文

## 问题

Agent 浏览器面板（停靠右侧栏中的 `AgentBrowserView`）由一个 `AgentBrowserRuntimeService` 持有的 `<webview>` guest 渲染。改动前这个 guest 只有一次生命：面板首次挂载时创建，之后只有 Agent 的导航目标变化时才被替换。面板里没有任何控件能替换它，而面板自己的错误面只处理 `did-fail-load`，渲染进程死亡或卡死时根本不会收到这个事件。

因此有两种情况在界面上无法恢复。guest 崩溃后面板一片空白，而该 Agent 会话后续每一次浏览器工具调用都会被 `BrowserGuestRegistry` 路由到已死的 `WebContents`。guest 的渲染进程停止响应时，面板停在同一帧画面上，地址栏、前进后退、重新加载全部打向一个不再应答的渲染进程。Issue #23244 记录的用户现象是只能重启应用，而重启会一并丢掉会话的对话状态（v2.1.8，macOS arm64）。

## 决定

`AgentBrowserRuntimeService.recover(sessionId)` 原地替换当前 guest。它快照当前这个 guest 已提交的位置（该 guest 尚未提交过时，退化为它自己的入口 `sourceUrl`），保留 `sessionId`、`securityProfile`、owners、面板锚点与 overlay 状态，清除 `failed`，置 `loading: true`，并把 `guestRevision` 自增一次。`AgentBrowserRuntimeHost` 以 `resource.guest` 与 `guestRevision` 作为 `<webview>` 的 key，因此这次自增会卸载已死元素、在同一 URL 与同一分区上挂载新元素；移除元素会立刻销毁原生 `WebContents`（实测同一 tick 内完成），所以替换后不会残留旧目标。替换尚未落地（`guest === null`）时再次调用 `recover` 是空操作。

三个入口会调用它：

- `BrowserOverlays` 展示面板的恢复提示。`WebviewHost` 用两个彼此独立的回调暴露 guest 自身的生命周期事件——渲染进程死亡的 `onRenderProcessGone`、文档加载失败的 `onDidFailLoad`——只有前者会进入恢复状态：`AgentBrowserRuntimeHost` 把它转成 `reportGuestHealth(…, 'render-process-gone')`，运行时据此锁定 `recoveryReason` 并显示提示。首次文档加载失败则走面板既有的错误面、只置 `failed`，从不触碰 `recoveryReason`，两种状况因此可区分。该提示只作告知：它自己不会替换 guest，因为替换会丢掉表单输入之类的页面状态。
- `SessionBrowserView` 在面板工具栏中、与共享的头部动作相邻处新增 `Reset page` 控件。只要有 guest 就可用——不以 `ready` 为前提，因为它存在的理由正是永远变不成 ready 的页面——仅在替换的空隙中禁用。这是唯一能救卡死页面的控件，原因见下方实测。
- 主进程通过 `browser.guest.ensure_requested` 载荷中 `kind: 'health'` 的形式上报 agent guest 的原生健康状态（仅当上报的 `webContentsId` 正是当前 guest 时才被接受），`unresponsive`/`responsive` 走的正是这条链路。`GuestSession` 把 `render-process-gone` 视为终态：作废标注文档、停止观察、中止进行中的 attach、拒绝挂起命令并取消两个 mutex，于是渲染进程死亡时正在等待的浏览器工具调用会失败而不是挂住。`BrowserSessionService.acquire` 拒绝已销毁或已崩溃的 guest，已死的 guest 无法再被绑回会话。

`unresponsive`/`responsive` 链路有实际投递与单元测试，但没有任何行为依赖它：在 Electron 44.9.3 上实测，一个被刻意阻塞的面板 guest 即使窗口可见且获得焦点，132 秒内也从未发出 `unresponsive`。因此面板不声称能识别卡死；由用户判断，`Reset page` 执行与崩溃恢复相同的替换。

## 考虑过的替代方案

- 收到 `render-process-gone` 就自动替换：否决。它会在用户没有要求的情况下静默丢弃页面状态（输入中的表单、滚动位置、单页应用状态），而面板本来就有手动入口。
- 用 `unresponsive` 加看门狗自动替换：否决理由是做不到，而不只是有风险。该事件对面板 guest 根本不投递（两次实测，12 秒与 132 秒窗口）；看门狗只能从 CDP 超时去猜，而 CDP 超时分不清「页面慢」与「页面死」。
- 崩溃后对幸存的 `WebContents` 执行 reload：否决。`reload()` 能救崩掉的渲染进程，但救不了卡死的渲染进程——目标不会应答——因此它放过了用户报的那个症状，还掩盖了两种状态的差别。
- 只复用现有的 `did-fail-load` 错误面：否决。死掉的渲染进程发出的是 `render-process-gone` 而不是 `did-fail-load`；面板已经空白，错误面却仍认为页面正常。
- 重置时销毁并重建整个面板/运行时：否决，范围过大。替换 guest 已经保留了会话、owners、overlays 与提交时的 URL，恢复不会碰到对话状态。

## 后果

guest 死亡后，面板保留用户的页面与恢复提示，该会话的每一次浏览器工具调用都会以 `debugger_unavailable` 快速失败，而不是去等一个渲染进程不会再创建的 guest——`BrowserGuestRegistry` 把「已崩溃的绑定」与「还没有 guest」分开记录，两种情形因此可区分。在面板里装上一个新的 guest（打开 HTML artifact、切换 security profile）时，它按健康页面起步、且不带上一个 guest 的恢复状态：崩溃锁定与提示属于死掉的那个 guest，换上不同 guest 时被清除，而单纯卸载（没有 guest）时保留。复用同一个 `WebContents` 的消费者（managed MCP 标签页自己的工具栏重载与导航）仍保有恢复路径：`GuestSession` 在该 guest 的下一次文档加载时重新武装，于是重载后的页面重新接受工具调用，而不是在会话剩余时间里一直拒绝；这次重新武装同时把 `will-download` 监听装回去——只装一次，不是每次恢复多加一个——因此重载之后的下载仍会被上报。恢复总是落回当前 guest 已提交的位置；若它在提交之前就崩掉，则落回该 guest 自己的入口 URL：进行中的导航会丢失，而在首次提交前崩溃的 HTML artifact 恢复到 artifact 本身，而不是被它替换掉的那个页面。恢复时正在执行的 agent 动作会失败，需要模型重试。健康页面上 `Reset page` 同样可用，此时它会丢弃页面状态——它是重置，不是撤销。卡死只能人工判断：面板不显示「无响应」状态，因为平台不上报它。

## 验证

- AC1 — `node node_modules/vitest/vitest.mjs run --project renderer src/renderer/components/__tests__/WebviewHost.test.tsx src/renderer/components/__tests__/AgentBrowserRuntimeHost.test.tsx src/renderer/components/__tests__/WebviewNavigation.test.tsx src/renderer/hooks/agent/__tests__/useAgentBrowserGuest.test.ts src/renderer/pages/agents/components/AgentRightPane/__tests__/AgentBrowserView.test.tsx`：54 通过；断言了崩溃提示、恢复动作可用，重置控件完成替换（新 revision、新原生 id、URL 不变），装上新的 guest 后崩溃提示消失、卸载时提示保留，以及第三轮新增的「HTML artifact 在首次提交前崩溃时恢复到 artifact URL，而不是被替换页面的已提交 URL」。
- AC2 — `node node_modules/vitest/vitest.mjs run --project main src/main/features/browser/__tests__/GuestSession.test.ts src/main/features/browser/__tests__/BrowserSessionService.test.ts src/main/features/browser/__tests__/AgentBrowserRegistry.test.ts`：76 通过；死掉的渲染进程会作废文档、拒绝挂起命令，且无法被重新 acquire。
- Rework round — 同样这几个文件加上 managed MCP controller 覆盖重新武装：崩溃的 guest 先拒绝工作，随后同一个 `WebContents` 经自身重载恢复、工具调用重新成功。第三轮补上了这次重新武装的下载一半，两层各有用例：恢复后的 managed 会话能上报此后发生的下载；反复崩溃/恢复之后 `will-download` 监听仍然只注册一次；持有 `observe()` 句柄的 borrowed 会话在恢复后继续观察，释放句柄即停止观察（这三条在上一版 head 上是红的）。
- AC3 — `node node_modules/@playwright/test/cli.js test tests/e2e/smoke/agentBrowserRecovery.test.ts --project=electron`：真实 Electron 运行——崩溃后 guest id 不变且会话仍绑定（不自动替换），提示上的动作原地替换（新原生 id、旧 `WebContents` 消失、URL 与分区不变、页面恢复），被阻塞的页面经 `Reset page` 恢复，隐藏后重新打开保持同一个 guest。
- AC4 — 同一次真实运行在恢复后经地址栏导航、经工具栏 `Reload` 重新加载，断言标记仍渲染且 guest id 不变；既有 `WebviewNavigation` 与 `WebviewBrowser` 套件仍通过。
- Regression — `probe/probe2.json`：真实应用中崩溃后经提示恢复，原生 id 由 3 变为 4，`webContents.fromId(3)` 为 undefined，分区与 URL 不变，页面 54 ms 内恢复。
- Regression — `probe/probe3.json`：被阻塞的面板 guest 在 Electron 44.9.3 上 132 秒内没有任何 `unresponsive`/`responsive`，这是卡死只能人工判断、并因此提供 `Reset page` 的依据。

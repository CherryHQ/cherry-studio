# Agent Note: 选择将 Chat 链接打开到话题浏览器面板

Status: proposed

[English](2026-11-09-chat-link-right-browser-pane.md) | 中文

## Problem

主界面 Chat 消息中的普通 HTTP(S) 链接使用通用叶节点打开器（`src/renderer/components/chat/messages/hooks/useMessageLeafCapabilities.ts:173`）。当 `app.browser.open_links_in_browser` 为 true 时，主进程将链接派发到独立的内置浏览器标签页，否则交给外部浏览器（`src/main/services/MainWindowService.ts:582`）。因此，用户要对照论述阅读其来源，就必须切换标签页或应用（#21958）。

话题已有自己的浏览器面板（`src/renderer/pages/home/components/TopicRightPane.tsx:147`），智能体会话也已将符合条件的链接路由到会话面板（`src/renderer/pages/agents/components/AgentRightPane/AgentRightPane.tsx:407`）。缺少的是供用户主动选择的普通主界面 Chat 链接路由，而非另一套浏览器实现。

## Proposal

### 偏好与优先级

在 `scripts/data-classify/data/target-key-definitions.json` 中新增布尔偏好 `app.browser.open_chat_links_in_right_panel`，默认值为 `false`；重新生成 `src/shared/data/preference/preferenceSchemas.ts`，绝不手改生成的 schema。“设置 → 浏览器”提供独立开关，帮助文本明确说明仅适用于 Chat 消息。保存的选择在重新加载、重启和升级后仍然保留。

| `app.browser.open_chat_links_in_right_panel` | `app.browser.open_links_in_browser` | 符合条件的主界面 Chat 激活 |
|---|---|---|
| false | true | 现有的独立浏览器标签页路由 |
| false | false | 现有的外部浏览器路由 |
| true | either | 话题面板可用时使用该面板，否则沿用现有回退路径 |

手动阅读独立于 `app.browser.auto_open_panel`、`app.browser.agent_control.enabled` 和 `assistant.settings.enableBrowser`。它不授予自动化权限，也不修改或要求启用这些设置。现有的全局链接开关、工具驱动的展示开关和自动化授权均默认为 true（`scripts/data-classify/data/target-key-definitions.json:37`）；它们保留原有含义。

### 渲染进程归属与激活

路由归 `homeMessageListAdapter.tsx` 所有，其 provider 已拥有 `topicId`（`src/renderer/pages/home/messages/homeMessageListAdapter.tsx:114`）。在展开叶节点动作之后覆盖 `openExternalUrl`（`src/renderer/pages/home/messages/homeMessageListAdapter.tsx:861`）。不在主进程拦截，不新增 IPC 或 DataApi 端点：`openWebsite()` 不携带话题身份（`src/main/services/MainWindowService.ts:582`），主进程无法知道激活属于哪个话题标签页。智能体会话及其他界面保留现有路由。

只有同时满足以下条件，主界面 Chat 激活才符合新路由要求：新偏好为 true、处于正常交互式渲染、话题身份与可选的面板状态及动作均存在、允许展示、浏览器面板已就绪，且 `resolveSafeExternalUrl()` 解析得到的协议严格为 `http:` 或 `https:`。旧式 `http://file/` 附件 URL 不在范围内。截图渲染、归属或展示不可用、其他协议及所有其他不符合条件的情况，都恰好一次委托给现有打开器。如果打开过程中失去归属，该次激活也恰好一次交给现有打开器。

只有无修饰键的主键点击或等效键盘激活采用新路由。Markdown 锚点已有修饰键和非主键激活保护（`src/renderer/components/chat/messages/markdown/Link.tsx:38`）。引用悬浮卡片和 HTTP 工具结果链接目前忽略修饰键（`src/renderer/components/chat/citations/WebCitation.tsx:136`、`src/renderer/components/chat/messages/tools/shared/ToolResultLink.tsx:43`）；这些注释界面通过消息动作传递 `preserveDefaultRouting` 提示，保留当前行为，不统一其事件处理。锚点、应用路由、工作区文件和需要确认的协议保留现有处理，包括确认与取消。

接受打开请求后，面板最终处于停靠状态，即使此前另一个面板已最大化。在面板内导航后，再次显式激活原始 URL，会让现有 guest 返回该 URL。目前 `ensure()` 比较的是最初请求的 `sourceUrl`，因此重复请求不会产生效果（`src/renderer/services/AgentBrowserRuntimeService.ts:53`）；显式激活必须表达导航，而非仅确保资源存在。

### 关闭与展示身份

关闭使用现有 shell 动作，该动作清除打开与最大化意图，并报告关闭状态（`src/renderer/components/chat/panes/Shell/RightPanel.tsx:294`）。它既不记忆，也不恢复先前选中的面板。不得调用浏览器运行时的 `close()`：只要话题仍有归属，关闭并重新打开面板后，保留的 guest、导航历史和页面状态仍然存在。

本提案保留[将右侧面板展示状态绑定到实例](../../implemented/bug-fix/2026-10-31-right-panel-presentation-identity.md)的约束：面板身份不可用时，不自动回退到其他面板，也不引入按会话记忆打开状态的映射。对于未被接受的激活回退到现有 URL 打开器，与为了维持打开布局而选择另一面板，是不同的行为。

后退、前进和重新加载通过 `SessionBrowserView` 复用现有话题浏览器控件（`src/renderer/components/SessionBrowserView.tsx:70`）；关闭复用上述 shell 动作。不新增浏览器控件、webview 或导航 IPC。

话题浏览器快捷入口目前要求 `browserEnabled && browserControlEnabled`（`src/renderer/pages/home/components/TopicRightPane.tsx:281`）。新偏好也可独立启用该快捷入口：`openChatLinksInRightPanel || (browserEnabled && browserControlEnabled)`。关闭新偏好时，快捷入口仍遵循原有的 AI 控制门控；手动消息链接路由仍独立于该门控。

### 浏览器宽度策略

新增命名宽度预设 `browser`，使用独立的可空宽度键 `ui.chat.browser_pane.width` 和 `ui.window.chat.browser_pane.width`，两者均为 `number | null`，默认值为 `null`。它们遵循现有的按窗口作用域缓存策略（`src/renderer/hooks/useWindowScopedPersistCache.ts:29`）。其他面板保留当前预设和已存宽度；现有 `inspector` 与 `navigation-list` 策略相互独立（`src/renderer/components/chat/shell/paneLayout.ts:60`）。

`null` 表示用户尚未作出选择。浏览器宽度未设置时，请求约为聊天 shell 宽度的三分之一：1200 px 的 shell 请求 400 px，1500 px 的 shell 请求 500 px。随后，该请求沿用现有的 255 px 面板最小宽度、360 px 中央区域舒适宽度、200 px 中央区域下限，以及按比例让出空间的规则（`src/renderer/components/chat/shell/paneLayout.ts:2`、`src/renderer/components/chat/shell/paneLayout.ts:20`、`src/renderer/components/chat/shell/paneWidthPolicy.ts:14`）。

不会在每次 shell 调整大小时持久化比例解析结果。用户调整的宽度优先，并通过现有缓存策略保留。渲染和侧栏自动折叠预测使用同一宽度解析；后者已经共享停靠宽度计算（`src/renderer/components/chat/shell/paneWidthPolicy.ts:51`），因此两者不能对浏览器请求宽度产生分歧。

## Alternatives considered

- **复用 `app.browser.open_links_in_browser` 作为开关。** 它已默认为 true，会在用户未主动选择的情况下将现有 Chat 点击移到面板中，也无法表达“使用面板，但仅限聊天链接”。
- **复用 `app.browser.auto_open_panel` 或 `app.browser.agent_control.enabled`。** 两者分别代表工具驱动的展示和自动化授权，且均已默认为 true。任一选择都会给手动阅读赋予错误身份，并将其与无关行为耦合。
- **在主进程路由。** `openWebsite()` 没有话题身份，存在将链接重定向到错误话题标签页的风险。
- **在锚点或 Markdown 渲染器处拦截。** 该渲染器与智能体会话及非 Chat 界面共享，并拥有现有修饰键保护。在此路由会将变更扩大到话题所有者之外。
- **复用 `inspector` 宽度预设，并把 280 px 称为“三分之一”。** 现有回退值为 280 px（`src/renderer/components/chat/shell/paneLayout.ts:22`）；该值可测量，但在实际 shell 宽度下并非三分之一，共享其已存宽度还会耦合无关面板。
- **关闭时记忆并恢复先前选中的面板。** 本轮不采用：这会改变共享 shell 语义，超出仅要求布局恢复正常的验收范围。

## Acceptance criteria

- AC1 — “设置 → 浏览器”显示独立开关，默认关闭，重新加载或重启后仍然保留其状态，帮助文本说明它适用于 Chat 消息。 (verification: `BrowserSettings` 渲染进程测试 + Electron)
- AC2 — 开启开关后，在主界面 Chat 话题中无修饰键激活普通 HTTP(S) Markdown 链接，会在该话题停靠的右侧面板显示 URL，宽度约为三分之一；活动对话、输入框内容和滚动位置均不改变，也不打开独立标签页或向外部浏览器派发。 (verification: home 适配器渲染进程测试 + Electron)
- AC3 — 开关关闭时、不符合条件的激活、修饰键或中键激活、`mailto:`、锚点、应用路由、工作区文件、`http://file/` URL 和需要确认的协议均保留原有行为，包括确认对话框及其取消操作。 (verification: markdown、工具结果和引用界面的渲染进程测试 + Electron 修饰键矩阵)
- AC4 — 后退、前进和重新加载驱动真实 guest；关闭使布局恢复正常：占位宽度为零、展示隐藏且不可交互、输入框可用、经典布局打开覆盖值为 `false`，空间允许时释放侧栏自动折叠；不恢复先前选中的面板。 (verification: `RightPanel`、`RightPaneHost` 和 `useClassicLayoutRightPaneOpen` 测试 + Electron 几何测量)
- AC5 — 浏览器宽度未设置时请求约为 shell 宽度的三分之一，用户调整的宽度保留且优先，其他面板宽度不变，自动折叠预测使用同一解析。 (verification: `paneLayout`、`RightPaneHost`、`ChatAppShell` 和 `useWindowScopedPersistCache` 测试 + Electron 在 1200 和 1500 px 下测量)
- AC6 — 面板内导航后重新激活原始链接，会让 guest 返回该 URL；打开过程中失去归属时，恰好一次回退到现有打开器。 (verification: 运行时渲染进程测试 + Electron)
- AC7 — 每个新增渲染进程字符串在所有随产品发布的语言中均完成翻译，且 i18n 检查通过。 (verification: i18n 检查)

## Risks

- 新增持久化偏好键必须在升级后保留，不能重置用户主动选择的状态。
- 如果预设选择、可空值或缓存键传递有误，共享 shell 宽度策略变更可能干扰其他面板。
- 持久化浏览器宽度增加了持久状态；保留的 guest 会为每个打开的话题面板占用内存，即使其展示已关闭。
- 考虑窗口、边栏宽度及现有空间让出规则后，可见宽度的三分之一只是近似目标。
- 路由依赖仅存在于渲染进程的话题身份。在话题 provider 外渲染的界面有意保留原有行为。

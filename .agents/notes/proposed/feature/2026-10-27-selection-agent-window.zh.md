# Agent Note: 划词助手智能体窗口

Status: proposed

[English](2026-10-27-selection-agent-window.md) | 中文

## 问题

划词动作只能把选中文本交给助手。[动作窗口](../../../../src/renderer/windows/selection/action/ActionWindow.tsx)用内存里的临时话题给出一个答案：不能追问，不能调用工具，关窗后什么都不留。想用智能体、MCP 工具、追问和历史记录的诉求在 #11838、#9239、#6984、#22680、#10950、#12431 以及它们被 stale 关闭的重复 issue 里反复出现。

智能体会话已经具备工具、审批、工作目录、持久化和后台执行，但它的界面只能在主窗口的标签页里使用。智能体消息列表里还有两处默认存在 TanStack 路由：[ErrorBlock](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx) 里的服务商链接，以及 [agentMessageListAdapter](../../../../src/renderer/pages/agents/messages/agentMessageListAdapter.tsx) 里的分叉来源跳转。没有路由的窗口无法安全地渲染它们。

## 提案

### 产品约定

- **入口。** 新的内置工具栏动作 `ask-agent` 打开指令条。自定义动作可以改为绑定智能体和工作目录，而不是助手；这类动作跳过指令条，直接发送按模板展开的提示词。助手动作继续使用现有动作窗口，不做改动。
- **会话。** 第一次发送时，通过 `POST /agent-sessions` 在选定的智能体和工作目录下创建一个 `conversation` 会话；在此之前不创建任何东西。这个会话就是普通的智能体会话：出现在主窗口的会话列表里，也可以在那里继续。
- **消息内容。** 选中文本以输入框现有的 `quote` token 进入第一条消息，后面跟一行来源应用名（取自划词事件的 `programName`）。自定义动作沿用助手动作的 `{{text}}` 模板规则。
- **外壳。** 没有系统标题栏色带，整个窗口使用 popover 表面。44px 的头部由应用绘制。macOS 保留嵌在头部里的系统红绿灯。Windows 和 Linux 绘制最小化按钮（提示文字「收起为胶囊」）和关闭按钮。右侧依次是在主窗口打开、置顶和透明度。
- **指令条 → 对话窗口。** 指令条宽 560，高度随内容，包含选中文本、指令输入框以及智能体和工作目录选择。第一次发送后向下长成对话窗口（默认 560×620，最小 420×480）；下方空间不够时，保持底边不动向上长高。对话区复用主窗口的消息渲染、工具卡片和审批输入区。为这个窗口专门设计的呈现方式推迟到实际体验之后再决定。
- **运行中追问。** 在这个窗口里，运行中发送一律插话。消息直接交给主进程，主进程立即保存，再把它插进当前这一轮，或安排为下一轮。这里停用输入框在 renderer 侧的追问队列，因为关窗会悄悄丢掉排队的消息。等队列有了唯一的主进程侧归属（#22824）后再恢复。
- **收起。** macOS 黄灯、Cmd+M 以及 Windows/Linux 的最小化按钮会把已经发送过的窗口收成胶囊。开启自动关闭时，启动中、运行中或等待批准的窗口失焦后收成胶囊。指令条不能收起。关窗永远不会停止这一轮，只有「停止」会。
- **胶囊。** 胶囊从窗口所在显示器可用区域的右下角向上堆叠，避开程序坞和任务栏。等待批准的胶囊离角落最近，往上依次是运行中、完成或出错。每个胶囊显示智能体和状态：第 N 步、等你批准、完成或出错。最多显示 5 个，其余折叠成「+N」。点击胶囊，窗口恢复到收起前的位置和大小。悬停时显示会话名和关闭按钮。胶囊上永远不能直接批准。胶囊只在应用这次运行期间存在。
- **在主窗口打开。** 调用现有的 `navigation.focus_or_open_conversation`，关闭迷你窗口和它的胶囊，并把未发送的草稿文本带到主窗口输入框。

| 状态 | 失焦（开启自动关闭） | 最小化 | Esc | 新的划词触发 |
|---|---|---|---|---|
| 指令条有草稿 | 保留 | 不可用 | 不响应 | 另开窗口 |
| 指令条为空 | 关闭 | 不可用 | 关闭 | 替换这个窗口 |
| 启动中或运行中 | 收起 | 收起 | 停止 | 另开窗口 |
| 等待批准 | 收起 | 收起 | 拒绝 | 另开窗口 |
| 完成或出错，无草稿 | 关闭 | 收起 | 关闭 | 替换这个窗口 |
| 完成或出错，有草稿 | 保留 | 收起 | 不响应 | 另开窗口 |
| 已收起 | — | — | — | 另开窗口 |

置顶的窗口不处理失焦，和现有动作窗口一致。

### 归属

| 部分 | 归属 | 约定 |
|---|---|---|
| 智能体窗口生命周期与胶囊布局 | `src/main/services/selection/` 下新的主进程生命周期服务，由 `selection.process_action` 的分发启动 | 记录每个智能体窗口的会话、状态、摘要和恢复位置。按 `screen` 的可用区域为每块显示器排布胶囊。负责收起、恢复、关闭以及带动画展开的请求。 |
| 智能体窗口 | `WindowType.SelectionAgent`，池化（standby 1，eager 预热），与 `SelectionAction` 分开 | 收起用 `wm.hide()`，不会把窗口还给空闲池；只有关闭才释放。不继承动作窗口在隐藏时发 `selection.action_dismissed` 的语义。 |
| 胶囊宿主 | `WindowType.SelectionCapsule`，default 生命周期，每块有胶囊的显示器一个窗口 | 尺寸贴合胶囊堆、锚定右下角，所以不需要点击穿透。不可聚焦、始终置顶、在全屏空间上可见，层级和工作区选项沿用工具栏。胶囊堆清空时销毁。 |
| 智能体窗口 renderer | 新入口 `src/renderer/windows/selection/agent/` | 挂载 `useAgentChatRuntimeState`、`AgentSessionMessages` 和 `AgentComposerSlot`；不挂 `AgentChat`、`AgentChatMain`、`AgentChatLayout`，它们需要右侧面板 scope。Provider：主题、代码样式、文件编辑会话、命令上下文与命令、MCP 交互宿主、弹窗、toast、听写、语音播放。不挂 `TabsProvider`，也没有路由。 |
| 胶囊 renderer | 新入口 `src/renderer/windows/selection/capsule/` | 渲染主进程推送的列表，并上报测得的尺寸，沿用工具栏 `determine_toolbar_size` 的做法。 |
| 运行中发送模式 | `AgentComposer` | 新增一个选项，让运行中的发送改为插话而不是排队。划词智能体窗口开启它，主窗口继续排队。 |
| 胶囊摘要 | 智能体窗口 renderer | 用 `useTopicStreamStatus`（含 `awaitingApprovalAnchors`）推出状态，用当前这一轮的工具调用数算出步数，再发给主进程。隐藏的窗口仍保持流的连接，所以收起后摘要会继续更新。 |
| macOS 黄灯 | `native/darwin/selectionPanel.mm` | Electron 的 `minimize` 事件不能取消。打了标记的智能体面板拦截 `performMiniaturize:` / `miniaturize:`，通过 N-API 线程安全回调通知 JavaScript。聚焦在智能体窗口时，Cmd+M 改走收起。 |
| 动效 | 主进程 | macOS 用 `setBounds(bounds, true)` 做展开，以及朝胶囊位置的收起。Windows 和 Linux 直接切换。`systemPreferences.getAnimationSettings().prefersReducedMotion` 为 true 时，所有平台都直接切换。 |
| 草稿交接 | `navigation.focus_or_open_conversation` | 新增可选的草稿文本。接收方主窗口 renderer 在打开会话前写入该会话的智能体草稿缓存；如果该会话的输入框已经挂载，就把文本追加进去。 |
| 划词动作数据 | `SelectionActionItem` 和 `selectionActionItemSchema` | 新增 `agentId?` 和 `agentWorkspace?`（`AgentSessionWorkspaceSource`）。模型单选变为默认模型、助手、智能体，保存时清空其他选项对应的字段。`ask-agent` 没有 `agentId` 时，解析为 `builtin_role` 为 `assistant` 的内置智能体；没有工作目录时使用系统工作目录。 |
| 默认值与升级 | `classification.json` 和一个版本化的升级 seeder | 新装用户默认启用 `ask-agent`。已有的存储数组只补一次，未启用并追加在末尾，不改变用户条目的顺序和内容。 |
| 划词来源 | 工具栏 renderer 和 `selection.process_action` 的输入 | 把 `programName` 和选中文本一起传递；目前工具栏把它丢掉了。 |
| 设置 | `SelectionAssistantSettings` | `ask-agent` 在名称旁显示默认智能体，并有一个设置默认智能体和工作目录的弹窗。绑定智能体的自定义动作显示智能体名。自定义动作弹窗新增智能体选项、智能体选择和工作目录选择。 |

### 导航解耦（最底层的实现层）

- `ErrorBlock` 把 TanStack 的 `<Link>` 换成 `openRoute('/settings/provider', { id })`。在主窗口里，它会打开或切到设置标签页，而不是替换当前对话标签页，和其他地方的 `openSettingsTab` 一致。在其他窗口里，现有的 IPC 回退会在主窗口打开设置。
- 分叉来源跳转改为 `AgentSessionMessages` 及其适配器的可选宿主动作。智能体页面传入现有的原地 TanStack `navigate`，行为不变；不传的宿主隐藏分叉来源链接。从划词窗口创建的会话永远不是分叉会话。
- `openRoute` 保持为模块函数。它先在本窗口派发 DOM 事件、没人处理再走 IPC 回退，已经让每个窗口自己决定是否处理路由。把它的 40 个调用点改成注入，不会改变这个功能。

### 交付分层

1. Spec（本文）。
2. 导航解耦。
3. 划词动作数据、默认值与升级 seeder、设置界面，以及 `programName` 的传递。
4. 智能体窗口：指令条、会话创建、对话视图、状态规则、在主窗口打开和草稿交接。
5. 胶囊与收起：胶囊窗口类型与布局、macOS 原生拦截和动效。这一层把本文移到 implemented。

## 考虑过的替代方案

- **在划词窗口里挂载带标签页和路由的整个智能体页面。** 否决。`AgentChatMain` 和页面布局需要右侧面板 scope，页面会读取标签页和路由状态，划词窗口也会带上一堆用不上的主窗口外壳。
- **给划词窗口套一层内存路由。** 否决。它会把失效的跳转藏起来：链接会在一个看不见的路由里跳转，表面上什么都不发生。
- **把 `openRoute` 全面改成依赖注入。** 推迟。它通过事件桥已经可以按窗口注入。只有视图内的原地跳转需要宿主，目前只有一个调用点。
- **复用 `SelectionAction` 的池化窗口类型。** 否决。它的隐藏事件表示「已关闭」，窗口池也假定一次性结果；智能体窗口要能以胶囊形式隐藏着继续存在。
- **继续使用内存临时话题。** 产品已决定智能体的工作要以会话形式持久保存，因此否决。
- **用 `ai.agent.session.reuse_or_create` 创建会话。** 否决。它可能复用主窗口正当作草稿显示的空会话，包括 Cherry Assistant 预置的那个空会话。
- **一个铺满显示器、带点击穿透的透明胶囊层。** 否决。Linux 不支持 `setIgnoreMouseEvents` 的事件转发，动态切换可点击区域也很脆弱。每个胶囊一个窗口同样否决，因为每颗胶囊都要一个 renderer。
- **胶囊放在右上角。** 否决。macOS 的系统通知从那里滑出，Windows 和 GNOME 最大化窗口的关闭按钮也在那里。
- **监听 Electron 的 `minimize` 再恢复窗口。** 否决。这个事件不能取消，程序坞的动画会先闪一下。
- **默认隐藏系统红绿灯，自己画仿制品。** 只作为原生拦截不可行时的回退方案保留。
- **Windows 和 Linux 上逐帧动画。** 推迟到实际体验之后。透明窗口逐帧缩放有闪烁风险。
- **划词窗口专用的消息呈现（标题式首条消息、紧凑的步骤行）。** 推迟到实际体验复用的渲染之后。
- **在这个窗口里保留 renderer 侧的追问队列。** 在 #22824 之前否决。关窗会悄悄丢掉排队的消息；在关窗时补发或弹窗确认，等于为一个放错归属的队列加一条异步关窗路径。
- **把智能体草稿改成 shared 缓存层来做交接。** 否决。为了一次交接，会改变所有窗口的草稿同步方式。

## 验收标准

- AC1 — 在主窗口里，ErrorBlock 的服务商链接会打开或切到该服务商的设置标签页，不替换对话标签页。在没有路由的窗口里，它会打开主窗口的设置。智能体页面的分叉来源跳转行为不变。 (verification: renderer)
- AC2 — 新装用户的动作列表里 `ask-agent` 已启用。已有用户只补一次、未启用，不改变他们条目的顺序和内容。 (verification: unit)
- AC3 — 自定义动作弹窗提供默认模型、助手和智能体。选智能体时保存智能体 id 和工作目录并清空助手 id，反之亦然。已有的助手动作行为不变。 (verification: renderer)
- AC4 — `ask-agent` 打开一个已聚焦的指令条，显示选中文本和来源应用，不发送也不创建会话。关掉它后会话列表没有变化。 (verification: renderer + Electron)
- AC5 — 第一次发送在选定的智能体和工作目录下恰好创建一个对话会话。它的第一条用户消息包含指令、引用的选中文本和来源应用，指令条展开成对话窗口。 (verification: renderer + Electron)
- AC6 — 绑定智能体的自定义动作打开对话窗口，并立即发送按 `{{text}}` 规则展开的提示词。 (verification: renderer)
- AC7 — 对话窗口流式显示回复和工具调用，有待批准时显示审批输入区，运行中发送的内容直接插话、不在窗口里排队，完成后继续同一个会话，并使用主窗口的消息渲染。 (verification: Electron)
- AC8 — 窗口没有系统标题栏色带，两种主题下都只有一种表面颜色。macOS 红绿灯在 44px 头部里垂直居中，Windows 和 Linux 提供收起和关闭按钮。 (verification: Electron)
- AC9 — 已经发送过的窗口，按黄灯、Cmd+M 或 Windows/Linux 的最小化按钮会收成胶囊，而不是最小化到程序坞或任务栏。指令条不能收起。 (verification: Electron)
- AC10 — 开启自动关闭时，启动中、运行中和等待批准的窗口失焦后收起；没有草稿的完成、出错窗口和空的指令条失焦后关闭；任何有草稿的窗口都保留。置顶的窗口不处理失焦。 (verification: renderer)
- AC11 — 胶囊从所属窗口所在显示器可用区域的右下角向上堆叠，不遮挡程序坞或任务栏；按等待批准、运行中、完成或出错排序，实时显示状态和步数，最多 5 个外加「+N」，点击后窗口恢复到之前的位置和大小。 (verification: Electron)
- AC12 — 关闭窗口或胶囊都不会停止这一轮。主窗口会话列表显示运行中或等待批准，在主窗口里可以审批，只有「停止」会中止。 (verification: Electron)
- AC13 — 「在主窗口打开」会在主窗口聚焦或打开这个会话，关闭迷你窗口和它的胶囊，主窗口输入框显示未发送的草稿。 (verification: Electron)
- AC14 — 有窗口处于启动中、运行中、等待批准、有草稿或已收起时，新的划词触发会另开一个窗口，原窗口不受影响。 (verification: Electron)
- AC15 — 展开和收起在 macOS 上有动画，在 Windows 和 Linux 上直接切换；系统偏好减少动态效果时，所有平台都直接切换。 (verification: Electron)
- AC16 — 智能体没有模型、运行时缺失、绑定的智能体或工作目录不可用时，窗口里都会给出对应的操作。 (verification: renderer)
- AC17 — 翻译、解释、总结、优化和绑定助手的自定义动作保持现有窗口和行为。 (verification: renderer + Electron)

## 风险

- **macOS 拦截可能做不到或很脆弱。** Electron 的面板类和按钮动作属于内部实现，Electron 升级时可能变化。先做技术验证。回退方案是隐藏系统按钮（`setWindowButtonVisibility(false)`），在同一位置绘制外观一致的红绿灯。
- **隐藏的窗口可能被节流。** Chromium 可能节流隐藏的 renderer，导致胶囊摘要更新变慢。需要实测；必要时为这个窗口类型关闭后台节流。
- **MCP 交互提示可能落进隐藏的窗口。** 它们会发给第一个活着的监听窗口。如果那个监听者是已收起的智能体窗口，提示就看不见。要把它转到可见的窗口，或在胶囊上提示。
- **会话归属必须留在主窗口。** `navigation.focus_or_open_conversation` 会询问各 renderer 是否持有该会话。智能体窗口不能声明持有，这样目的地才始终是主窗口。
- **插话发出后不能撤回。** 和主窗口里排队的消息不同，这个窗口里发出的追问不能再编辑、重新排序或删除。在 #22824 之前接受这一点。
- **每个智能体窗口都占一个 renderer。** 窗口池的上限能约束空闲窗口，但同时收起的多个会话会各自占着一个 renderer。
- **第一轮要承担运行时启动开销。** Claude Code 按已存在的会话预热（`ai.agent.session.prewarm`），而这个窗口在第一次发送时才创建会话，所以这一轮无法预热。Pi 建立连接时要先等智能体的 MCP 工具目录就绪。因此窗口有「启动中」状态。智能体动作的定位是办事，不追求秒出结果。
- **内置的 Cherry Assistant 出厂时没有模型。** 新用户在智能体引导分配模型之前，会走「没有配置模型」这条路径。

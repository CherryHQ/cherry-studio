# Agent Note: 划词助手智能体窗口

Status: implemented

[English](2026-10-27-selection-agent-window.md) | 中文

## 问题

划词动作原先只能把选中文本交给助手。[动作窗口](../../../../src/renderer/windows/selection/action/ActionWindow.tsx)用内存里的临时话题给出一个答案：不能追问，不能调用工具，关窗后什么都不留。想用智能体、MCP 工具、追问和历史记录的诉求在 #11838、#9239、#6984、#22680、#10950、#12431 以及它们被 stale 关闭的重复 issue 里反复出现。

智能体会话已经具备工具、审批、工作目录、持久化和后台执行，但它的界面原先只能在主窗口的标签页里使用。智能体消息列表里还有两处默认存在 TanStack 路由：[ErrorBlock](../../../../src/renderer/components/chat/messages/blocks/ErrorBlock.tsx) 里的服务商链接，以及 [agentMessageListAdapter](../../../../src/renderer/pages/agents/messages/agentMessageListAdapter.tsx) 里的分叉来源跳转。没有路由的窗口无法安全地渲染它们。

## 决策

### 产品约定

- **入口。** 内置工具栏动作 `ask-agent` 打开指令条。自定义动作可以改为绑定智能体和工作目录，而不是助手；这类动作跳过指令条，直接发送按模板展开的提示词。助手动作继续使用动作窗口，不做改动。
- **会话。** 第一次发送时，在选定的智能体和工作目录下创建一个 `conversation` 会话；在此之前不创建任何东西。绑定了智能体的，通过 `POST /agent-sessions` 创建。没有绑定智能体的 `ask-agent` 改走 `ai.agent.assistant_session.create`：这个接口接受可选的工作目录参数，并会在 Cherry Assistant 被删除时重建它。这个会话就是普通的智能体会话：出现在主窗口的会话列表里，也可以在那里继续。如果主进程拒绝了首条消息（例如备份恢复期间流被暂停，或工作目录、服务商不可用），它不会保存任何内容；对话窗口照常打开，消息连同引用回到输入框，可以再次发送。
- **消息内容。** 选中文本以输入框现有的 `quote` token 进入第一条消息，自定义动作沿用助手动作的 `{{text}}` 模板规则。除此之外不追加任何内容：指令条显示来源应用，但不发送它。
- **外壳。** 没有系统标题栏色带，整个窗口使用 popover 表面。44px 的头部由应用绘制。macOS 保留嵌在头部里的系统红绿灯。Windows 和 Linux 绘制最小化按钮（提示文字「收起为胶囊」）和关闭按钮。右侧依次是在主窗口打开、置顶和透明度。
- **指令条 → 对话窗口。** 指令条宽 560，高度随内容，包含选中文本、指令输入框，以及标明所绑定智能体和工作目录的标签。点击任一标签会在主窗口打开划词设置，在那里更改绑定，已打开的指令条会跟着更新。第一次发送后向下长成对话窗口（默认 560×620，最小 420×480）；下方空间不够时，保持底边不动向上长高。对话区复用主窗口的消息渲染、工具卡片和审批输入区。
- **运行中追问。** 在这个窗口里，运行中发送一律插话。消息直接交给主进程，主进程立即保存，再把它插进当前这一轮，或安排为下一轮。这里停用输入框在 renderer 侧的追问队列，因为关窗会悄悄丢掉排队的消息。等队列有了唯一的主进程侧归属（#22824）后再恢复。
- **收起。** macOS 黄灯、Cmd+M 以及 Windows/Linux 的最小化按钮会把已经发送过的窗口收成胶囊。开启自动关闭时，启动中、运行中或等待批准的窗口失焦后收成胶囊。指令条不能收起；在 macOS 上，它的黄灯和 Cmd+M 显示为不可用。关窗永远不会停止这一轮，只有「停止」会。
- **胶囊。** 胶囊从窗口所在显示器可用区域的右下角向上堆叠，避开程序坞和任务栏。胶囊所在的显示器被移除后，胶囊改在主显示器上显示，直到那块显示器接回。在等用户处理的胶囊（等待批准，或 MCP 服务器在等一个回答）离角落最近，往上依次是启动中或运行中、完成或出错；同一档里先收起的排在前面。每个胶囊显示智能体和状态：运行中、第 N 步、等你批准、需要你输入、完成或出错。最多显示 5 个，其余折叠成「+N」，点击后展开整个胶囊堆，点「收起」再折叠回去。展开后高过可用区域的胶囊堆在区域内滚动。点击胶囊，窗口恢复到收起前的位置和大小。悬停时显示会话名和关闭按钮。胶囊上永远不能直接批准。胶囊只在应用这次运行期间存在。
- **动效。** 在 macOS 上，指令条以动画展开成对话窗口；收起时窗口朝胶囊所在的角落缩小并淡出，之后胶囊才出现；恢复时窗口再从那里放大回去。每段动画 200 ms。输入时指令条的高度变化不做动画。Windows 和 Linux 直接切换；系统偏好减少动态效果时，所有平台都直接切换。
- **在主窗口打开。** 调用 `navigation.focus_or_open_conversation`，关闭迷你窗口和它的胶囊，并把未发送的草稿带到主窗口输入框：文字、引用和其他标记、附件，以及知识库选择。

| 状态 | 失焦（开启自动关闭） | 最小化 | Esc | 新的划词触发 |
|---|---|---|---|---|
| 指令条有草稿 | 保留 | 不可用 | 不响应 | 另开窗口 |
| 指令条为空 | 关闭 | 不可用 | 关闭 | 替换这个窗口 |
| 启动中或运行中 | 收起 | 收起 | 停止 | 另开窗口 |
| 等待批准 | 收起 | 收起 | 拒绝权限请求 | 另开窗口 |
| 完成或出错，无草稿 | 关闭 | 收起 | 关闭 | 替换这个窗口 |
| 完成或出错，有草稿 | 保留 | 收起 | 不响应 | 另开窗口 |
| 已收起 | — | — | — | 另开窗口 |

草稿指输入框里任何未发送的文字、标记或附件。置顶的窗口不处理失焦，和动作窗口一致；新的划词触发也不会替换置顶的窗口。待回答的提问不响应 Esc：回答填写在输入框里，误按 Esc 会丢掉已经填好的内容。

### 归属

| 部分 | 归属 | 约定 |
|---|---|---|
| 智能体窗口生命周期与胶囊布局 | `SelectionAgentWindowService`（`src/main/services/selection/`），由 `SelectionService.processAction` 为智能体动作打开 | 记录每个智能体窗口的布局（指令条或对话）、下一次触发能否替换它、胶囊摘要，以及是否已收起。收起的窗口保持自己的位置和大小，恢复时就回到这里。按 `screen` 的可用区域为每块显示器发布一个排好序的胶囊堆；排序和定位是 `selectionCapsuleLayout.ts` 里的纯函数。负责收起、恢复、从胶囊关闭以及各段动画。 |
| 智能体窗口 | `WindowType.SelectionAgent`，池化（standby 1，eager 预热），与 `SelectionAction` 分开 | 收起用 `wm.hide()`，不会把窗口还给空闲池；只有关闭才释放。不继承动作窗口在隐藏时发 `selection.action_dismissed` 的语义。 |
| 胶囊宿主 | `WindowType.SelectionCapsule`，池化（无 standby，lazy 预热），每块有胶囊的显示器一个窗口 | 尺寸贴合胶囊堆、锚定右下角，所以不需要点击穿透。以不激活的方式显示，永远不获得焦点（macOS 上是不可聚焦的 panel，Windows 和 Linux 上是不可聚焦的 toolbar 窗口），始终置顶，在全屏空间上可见，层级和工作区选项沿用工具栏。胶囊堆清空时关闭，也就是隐藏回窗口池，所以下一次出现第一个胶囊时不用等 renderer 启动。它关闭了后台节流，隐藏时也能排版并测量下一个胶囊堆。显示器被移除后，它上面的胶囊移到主显示器。 |
| 智能体窗口 renderer | 入口 `src/renderer/windows/selection/agent/` | 挂载 `useAgentChatRuntimeState`、`AgentSessionMessages` 和 `AgentComposerSlot`；不挂 `AgentChat`、`AgentChatMain`、`AgentChatLayout`，它们需要右侧面板 scope。Provider：主题、代码样式、文件编辑会话、命令上下文与命令、MCP 交互宿主、弹窗、toast、听写、语音播放。不挂 `TabsProvider`，也没有路由，所以永远不会声明持有会话。 |
| 胶囊 renderer | 入口 `src/renderer/windows/selection/capsule/` | 渲染主进程发布在 shared 缓存 `selection.agent_capsules.<displayId>` 里的胶囊堆，并通过 `selection.determine_capsule_size` 上报测得的尺寸，沿用工具栏 `determine_toolbar_size` 的做法。 |
| 运行中发送模式 | `AgentComposer` | `steerWhileBusy` 选项让运行中的发送改为插话而不是排队。划词智能体窗口开启它，主窗口继续排队。 |
| 胶囊摘要 | 智能体窗口 renderer | 用 `useTopicStreamStatus`（含 `awaitingApprovalAnchors`）和本话题待处理的 MCP 交互推出状态，用当前这一轮的工具调用数（包括仍在流式生成的部分）算出步数，再通过 `selection.update_agent_summary` 发给主进程。隐藏的窗口仍保持流的连接，所以收起后摘要会继续更新。 |
| macOS 黄灯 | `native/darwin/selectionPanel.mm` 里的 `setMiniaturizeHandler` 和 `interceptMiniaturize` | Electron 的 `minimize` 事件不能取消。addon 在 Electron 的面板类上覆盖 `performMiniaturize:` 和 `miniaturize:`：打了标记的智能体窗口把黄灯、Cmd+M 和标题栏双击通过 N-API 线程安全函数交给 JavaScript，没打标记的面板照常最小化。指令条把 `minimizable` 设为 false。 |
| 动效 | `SelectionAgentWindowService` 和 addon 里的 `animateWindow` | 用 `NSAnimationContext` 对窗口的位置大小和不透明度做动画，返回的 promise 在动画结束时 resolve。窗口做动画期间解除最小尺寸，动画结束后恢复该布局的限制。收起的终点是角落里一个固定的胶囊大小的位置，因为第一个胶囊出现时，胶囊宿主还没有测量尺寸。 |
| 在全屏应用上恢复 | addon 里的 `isFrontmostFullScreen` | 恢复时读取最前台应用焦点窗口的 `AXFullScreen`，消息超时为 0.25 秒。结果为全屏时，按全屏显示流程显示窗口并让 Dock 保持隐藏，和 `open()` 根据工具栏的 `isFullscreen` 所做的一样。没有辅助功能权限时结果为 false。 |
| 草稿交接 | `navigation.focus_or_open_conversation` 和 `agentDraftHandoff` | 路由接受可选的草稿：文字、标记、附件和知识库 id。内存中的附件以字节传输，因为 IPC 传不了 `Blob`。接收方 renderer 按会话把草稿放进待交接队列。该会话的智能体输入框在挂载或所在标签页重新显示时取走草稿，追加到自己的草稿后面，再以合并结果重新挂载。直接写草稿缓存行不通：隐藏标签页里的输入框不会重新读取缓存。 |
| 划词动作数据 | `SelectionActionItem` 和 `SelectionActionSchema`（`@shared/types/selection`） | 存储形态有 `runner?`（`default`、`assistant` 或 `agent`）、`agentId?` 和 `agentWorkspace?`（`AgentSessionWorkspaceSource`）。业务代码通过以 `isBuiltIn` 为判别字段的联合类型解析它：内置动作再按 `id` 区分，只带各自的字段；自定义动作必须有 `runner`。`runner` 决定自定义动作由谁运行，`assistantId`、`agentId` 和 `agentWorkspace` 则保留每种方式上次的选择。`ask-agent` 没有 `agentId` 时，解析为 `builtin_role` 为 `assistant` 的内置智能体。没有工作目录即表示系统工作目录。 |
| 默认值与升级 | `classification.json` 和 `SelectionActionItemsUpgradeSeeder` | 新装用户默认启用 `ask-agent`。已有的存储数组只补一次，未启用并追加在末尾，不改变用户条目的顺序和内容。这个 seeder 还按 `assistantId` 给已有的自定义动作补上 `runner`。 |
| 划词来源 | 工具栏 renderer 和 `selection.process_action` 的输入 | 把 `programName` 和选中文本一起传递，供指令条显示。 |
| 智能体可用性 | 工具栏 renderer 和 `SelectionAssistantSettings` | 智能体没有可用的模型（未设置，或模型连同服务商已被删除），或绑定的智能体已不存在时，对应的智能体动作在工具栏上不可用。hover 时按钮文字换成原因；工具栏窗口显示期间不会改变大小，所以按钮按两段文字中较长的那段预留宽度。紧凑模式下改为图标变灰并加标记。设置页在该动作及其弹窗里高亮同样的原因。Cherry Assistant 不存在时，没有绑定智能体的 `ask-agent` 仍然可用，因为发送时会重建它。 |
| 设置 | `SelectionAssistantSettings` | `ask-agent` 在名称旁显示默认智能体，并有一个设置默认智能体和工作目录的弹窗。绑定智能体的自定义动作显示智能体名。自定义动作弹窗有智能体选项、智能体选择和工作目录选择。 |

### 导航解耦

- `ErrorBlock` 通过宿主的 `navigateToRoute` 能力打开服务商设置，两个消息列表适配器都把它实现为 `openRoute(path, query)`。在主窗口里，它会打开或切到设置标签页，而不是替换当前对话标签页。在其他窗口里，`openRoute` 的 IPC 回退会在主窗口打开设置。不提供这个能力的宿主把服务商名显示为纯文本。
- 分叉来源跳转是 `AgentSessionMessages` 及其适配器的可选宿主动作 `navigateToForkSource`。智能体页面传入现有的原地 TanStack `navigate`，行为不变；不传的宿主隐藏分叉来源链接。从划词窗口创建的会话永远不是分叉会话。
- `openRoute` 保持为模块函数。它先在本窗口派发 DOM 事件、没人处理再走 IPC 回退，已经让每个窗口自己决定是否处理路由。

### 交付

Spec 在 #22827 合并，之后是五个实现层：

1. 导航解耦（#22981）。
2. 划词动作数据、默认值与升级 seeder、设置界面，以及 `programName` 的传递（#22990）。
3. 指令条、会话创建、对话视图，以及工具栏和设置页上的智能体可用性（#23065）。
4. 状态规则、在主窗口打开、草稿交接（#23089）。
5. 胶囊与收起：胶囊窗口类型与布局、失焦收起和 Windows/Linux 的按钮（#23097）；macOS 原生拦截、动效和在全屏应用上恢复（本层）。

## 考虑过的替代方案

- **在划词窗口里挂载带标签页和路由的整个智能体页面。** 否决。`AgentChatMain` 和页面布局需要右侧面板 scope，页面会读取标签页和路由状态，划词窗口也会带上一堆用不上的主窗口外壳。
- **给划词窗口套一层内存路由。** 否决。它会把失效的跳转藏起来：链接会在一个看不见的路由里跳转，表面上什么都不发生。
- **把 `openRoute` 全面改成依赖注入。** 推迟。它通过事件桥已经可以按窗口注入。只有视图内的原地跳转需要宿主，目前只有一个调用点。
- **在 `ErrorBlock` 里直接调用 `openRoute`。** 否决，改用宿主能力。两个适配器里它都落到同一个 `openRoute`，而且这样链接和 ErrorBlock 的「前往设置」按钮保持一致，后者本来就依赖宿主能力。
- **复用 `SelectionAction` 的池化窗口类型。** 否决。它的隐藏事件表示「已关闭」，窗口池也假定一次性结果；智能体窗口要能以胶囊形式隐藏着继续存在。
- **继续使用内存临时话题。** 产品已决定智能体的工作要以会话形式持久保存，因此否决。
- **用 `ai.agent.session.reuse_or_create` 创建会话。** 否决。它可能复用主窗口正当作草稿显示的空会话，包括 Cherry Assistant 预置的那个空会话。
- **一个铺满显示器、带点击穿透的透明胶囊层。** 否决。Linux 不支持 `setIgnoreMouseEvents` 的事件转发，动态切换可点击区域也很脆弱。每个胶囊一个窗口同样否决，因为每颗胶囊都要一个 renderer。
- **胶囊放在右上角。** 否决。macOS 的系统通知从那里滑出，Windows 和 GNOME 最大化窗口的关闭按钮也在那里。
- **监听 Electron 的 `minimize` 再恢复窗口。** 否决。这个事件不能取消，程序坞的动画会先闪一下。
- **隐藏系统红绿灯，自己画仿制品。** 没有用上。它是原生拦截不可行时的回退方案。
- **Electron 的带动画 `setBounds(bounds, true)`。** 否决。AppKit 同步执行带动画的缩放，每 150 px 约 0.2 秒，期间主进程被阻塞，所有窗口的输入也跟着卡住。
- **Windows 和 Linux 上逐帧动画。** 推迟到实际体验之后。透明窗口逐帧缩放有闪烁风险。
- **划词窗口专用的消息呈现（标题式首条消息、紧凑的步骤行）。** 推迟到实际体验复用的渲染之后。
- **在指令条里放智能体和工作目录选择器。** 实际体验后放弃。它们的弹层放不进按内容定高的透明窗口：列表打开前窗口要先长高，关闭后再缩回，在屏幕底部附近会带着指令条移动；弹层只要伸到标题区，原生红绿灯就会盖在它上面。绑定放在划词设置里，点击标签即可打开。
- **在这个窗口里保留 renderer 侧的追问队列。** 在 #22824 之前否决。关窗会悄悄丢掉排队的消息；在关窗时补发或弹窗确认，等于为一个放错归属的队列加一条异步关窗路径。
- **把智能体草稿改成 shared 缓存层来做交接。** 否决。为了一次交接，会改变所有窗口的草稿同步方式。
- **只交接草稿文字。** 否决。小窗关闭后引用和附件会丢失，而窗口失焦时正是因为它们才保持打开。
- **在第一条消息里附上来源应用。** 实际体验后否决。这一行用户既没写也没配置，出现在自己的消息里显得突兀。
- **只在窗口里提示没有模型。** 否决。用户会打开一个根本跑不起来的窗口，而工具栏本来就能知道智能体有没有模型。
- **根据哪个 id 有值来推断运行方式。** 否决。选择只有两种状态时可行；变成三种以后，保存时必须清空其他字段，切走再切回就丢了之前的选择。

## 影响

- 最小化拦截依赖 Electron 内部的面板类及其按钮动作。升级 Electron 时，必须重新确认黄灯和 Cmd+M 仍会收起智能体窗口，其他窗口也仍会正常最小化。
- MCP 提示发给发起请求的那个窗口。已收起的智能体窗口里的提示看不见；它的胶囊会显示「需要你输入」，直到窗口恢复。
- 池化窗口关闭时回到窗口池，不会触发 `closed`。因此，从胶囊关掉的窗口里挂着的 MCP 请求会一直等到超时。
- `navigation.focus_or_open_conversation` 会询问各 renderer 是否持有该会话。智能体窗口永远不声明持有，所以目的地始终是主窗口。
- 这个窗口里发出的追问会立即插话，之后不能再编辑、重新排序或删除，这一点和主窗口里排队的消息不同。在 #22824 之前接受这一点。
- 每个智能体窗口都占一个 renderer。窗口池的上限能约束空闲窗口，但每个已收起的会话都会各自占着一个 renderer。
- 显示过胶囊的每块显示器，在最后一个胶囊消失后还会留一个隐藏的胶囊宿主 10 分钟。启动后第一次收起，或者这 10 分钟过后，仍要等宿主启动。
- 第一轮要承担运行时启动开销。Claude Code 按已存在的会话预热（`ai.agent.session.prewarm`），而这个窗口在第一次发送时才创建会话，所以这一轮无法预热。Pi 建立连接时要先等智能体的 MCP 工具目录就绪。因此窗口和它的胶囊有「启动中」状态。
- 内置的 Cherry Assistant 出厂时没有模型。在智能体引导分配模型之前，新用户在工具栏上看到的 `ask-agent` 按钮是不可用的，并提示去设置模型。
- 工具栏无法显示 tooltip。工具栏窗口太小，放不下页面内的 tooltip；在 macOS 上，Cherry Studio 不是前台应用时，原生 `title` tooltip 不会出现。因此在紧凑模式下，工具栏无法说明智能体动作为什么不可用，原因只能在设置页里看到。
- 在全屏应用上方时，Cherry Studio 会暂时离开 macOS 的 Dock。macOS 不会把普通应用的窗口放进其他应用的全屏空间；系统为这个窗口打开的输入法候选框无法自行加入。因此窗口从工具栏打开或从胶囊恢复到全屏应用上方时，Cherry Studio 以 accessory 进程运行，Dock 图标和 Cmd+Tab 中的条目会消失，直到窗口隐藏或关闭。

## 验证

- AC1 — `pnpm vitest run --project renderer src/renderer/components/chat/messages/blocks/__tests__/ErrorBlock.test.tsx src/renderer/pages/agents/messages/__tests__/agentMessageListAdapter.test.tsx src/renderer/pages/agents/__tests__/AgentChatMain.test.tsx`：服务商链接带着服务商 id 调用 `navigateToRoute`，不会打开错误详情；没有这个能力时显示为纯文本（旧的 `<Link>` 在没有路由时会抛错）；智能体页面的分叉来源路由和 search 不变。
- AC2 — 在已迁移的测试数据库上运行 `pnpm vitest run --project main src/main/data/db/seeding/seeders/__tests__/selectionActionItemsUpgradeSeeder.test.ts`（#22990）：新装用户的列表里 Ask Agent 已启用；已有列表在两次运行中只补一次、未启用，原有条目顺序不变；旧的自定义动作按 `assistantId` 得到对应的运行方式。
- AC3 — `pnpm vitest run --project renderer src/renderer/pages/settings/SelectionAssistantSettings src/renderer/windows/selection/action src/renderer/utils/__tests__/selectionAction.test.ts`：保存智能体动作必须选择智能体；切换运行方式再切回会恢复之前的助手；动作窗口只运行选中的方式。
- AC4 — `src/renderer/windows/selection` 里的 `SelectionAgentWindow.test.tsx`。macOS 上的 Electron 验收待完成：Ask Agent 打开一个已聚焦的指令条，显示选中文本和来源应用；关掉它后会话列表不变。
- AC5 — `SelectionAgentWindow.test.tsx`、`SelectionAgentComposeBar.test.tsx` 和 `SelectionAgentConversation.test.tsx`。Electron 验收待完成：第一次发送在 Cherry Assistant 或绑定的智能体和工作目录下创建一个会话，消息只包含引用和指令，指令条展开成对话窗口。
- AC6 — `SelectionAgentWindow.test.tsx`：绑定智能体的自定义动作立即发送按 `{{text}}` 展开的提示词，启动失败时提供重试。
- AC7 — `pnpm vitest run --project renderer src/renderer/components/composer/variants/__tests__/AgentComposer.test.tsx`。Electron 验收待完成：运行中的每次发送都直接插话、不排队；窗口用主窗口的渲染流式显示回复、工具调用和审批。
- AC8 — Electron 验收，待完成：两种主题下都没有标题栏色带、只有一种表面颜色；macOS 红绿灯在 44px 头部里垂直居中；`SelectionAgentHeader` 只在非 macOS 平台渲染收起和关闭按钮。
- AC9 — `pnpm vitest run --project main src/main/services/selection/__tests__/SelectionAgentWindowService.test.ts`：最小化回调只收起它收到的原生句柄对应的窗口；指令条不可最小化，对话窗口可以。macOS 上的 Electron 验收：黄灯能收起对话窗口。待完成：Cmd+M、双击标题栏、指令条上变灰的黄灯，以及 Windows 和 Linux 的收起按钮。
- AC10 — `SelectionAgentWindow.test.tsx` 和 `SelectionAgentConversation.test.tsx`：失焦时收起启动中、运行中和等待批准的窗口（包括流已结束但 MCP 审批仍在等待的窗口），关闭已结束和空的窗口，保留有草稿的窗口，置顶时不处理失焦。
- AC11 — `SelectionCapsuleStack.test.tsx`、`useSelectionAgentSummary.test.ts` 和 `SelectionAgentWindowService.test.ts`：每块显示器的胶囊堆排好序，收起期间持续更新，最多 5 个外加「+N」（复用的宿主和「收起」都会重新折叠），按测得的尺寸锚定在右下角且不超出可用区域，显示器接回后胶囊回到原屏，并把对应的窗口恢复到原来的位置和大小。macOS 上的 Electron 验收：收起后胶囊出现在右下角，复用的宿主在动画结束时就显示胶囊。待完成：相对 Dock 的位置、收起期间的实时更新、「+N」和「收起」、高过可用区域时的滚动、悬停、恢复后的位置大小，以及多显示器。
- AC12 — Electron 验收，待完成：关闭运行中的窗口或它的胶囊后这一轮继续运行，主窗口会话列表显示运行中或等待批准，在主窗口里可以审批，只有「停止」会中止。
- AC13 — `SelectionAgentConversation.test.tsx`、`AgentComposer.test.tsx` 和 `useConversationNavigationOwner.test.tsx`。Electron 验收待完成：草稿追加到已打开的主窗口输入框里，或由之后才挂载的输入框取走；迷你窗口和它的胶囊随之关闭。
- AC14 — `SelectionAgentWindow.test.tsx` 和 `SelectionAgentWindowService.test.ts`。Electron 验收待完成：只有空的、未置顶的窗口可以被替换，已收起的窗口永远不会被替换。
- AC15 — `SelectionAgentWindowService.test.ts`：展开、收起和恢复以动画到达正确的位置大小和不透明度，结束后恢复布局限制；减少动态效果时直接切换；Windows 和 Linux 从不做动画。macOS 上的 Electron 验收：收起时窗口先朝角落缩小、淡出，之后胶囊才出现。待完成：展开、恢复和减少动态效果。
- AC16 — `SelectionAgentComposeBar.test.tsx`、`src/renderer/components/selection` 和 `src/renderer/windows/selection/toolbar`。Electron 验收待完成：工具栏和设置页标出缺少模型或智能体；没有绑定智能体的 Ask Agent 在 Cherry Assistant 缺失时仍然可用；窗口指出缺失的工作目录或模型；缺少 Claude Code 运行时时显示它的下载状态。
- AC17 — `pnpm vitest run --project main src/main/services/selection/__tests__/SelectionService.test.ts`。Electron 验收待完成：绑定助手的自定义动作和内置的助手动作都留在动作窗口里。

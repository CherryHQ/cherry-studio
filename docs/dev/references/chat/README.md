---
description: Current chat-domain map covering shared renderer modules, page-owned adapters, rich clipboard, and the message tree
sources:
  - src/renderer/components/chat
  - src/renderer/components/composer
  - src/renderer/pages/home/messages
  - src/renderer/pages/agents/messages
  - src/main/data/services/MessageService.ts
---

# Chat Reference

The chat domain spans reusable renderer modules, page-owned adapters, composer UI,
and the main-process message tree. There is no root
`@renderer/components/chat` barrel or generic `components/chat/adapters/`
directory; consumers import from the module that owns the capability.

## Current ownership

| Path | Responsibility |
|---|---|
| `src/renderer/components/chat/messages/` | Shared message-list contracts, rendering, actions, tools, markdown, streaming, and list behavior |
| `src/renderer/components/chat/sideChat/` | 侧聊面板、来源标记及窗口内存状态的界面接入 |
| `src/renderer/components/chat/actions/` | Generic action descriptors/registry plus current topic and session action sets |
| `src/renderer/components/chat/{resourceList,shell,panes,flow}/` | Shared resource navigation, conversation shell, auxiliary panes, and topic-tree visualization |
| `src/renderer/components/composer/` | Shared composer surface and its Chat/Agent variants |
| `src/renderer/pages/{home,agents}/messages/` | Page-owned projections from business state into the shared message-list contract |
| `src/main/data/services/MessageService.ts` | SQLite-backed topic-message tree operations and invariants |

The repository previously carried target-architecture documents for a generic
adapter layer and root package barrel. Those APIs did not land; the current
reference set documents implemented behavior only.

## Agent mode controls

The Agent composer exposes Plan as an independent Quick Panel toggle on harnesses
that support it. Shift+Tab switches ordinary/Plan without changing the draft;
open-panel and prompt-variable navigation take priority. Plan is absent from the
composer's Permission Mode submenu. The toggle still saves the native Agent
permission mode (`plan` or `default`).

Goal is selected separately in the Quick Panel through the existing native
`/goal` command. Selection prefixes the draft once and leaves submission to the
user. Pi and Durable provide a static command entry; Claude uses its live SDK
catalog. Draft keywords and the input placeholder do not suggest modes.

## Documents

| Document | What it covers |
|---|---|
| [Composer Rich Clipboard](./composer-rich-clipboard.md) | Private clipboard format that preserves composer tokens across copy/paste, its restore rules, and ownership boundaries |
| [Message Tree](./message-tree.md) | The topic message-tree model: adjacency list, virtual root, sibling groups, invariants, delete semantics, consumer contract |

## 侧聊界面

普通聊天和智能体通过 `MessageListActions.openSideChat` 提供划词入口。
`TopicRightPane` 和 `AgentRightPane` 承载侧聊。回答下方、流程图及右上角不提供打开入口。
原文划词标记可打开对应侧聊。同一位置有多条侧聊时，在该处选择。面板顶部不显示历史列表或重复引用。
侧聊适配器不提供 `openSideChat`，避免递归。删除仅显示图标，位于顶部“关闭侧边栏”左边，执行前仍确认。
收起或切换预览不会清除侧聊。删除成功后清除内容和草稿，并收起当前侧聊边栏。删除期间切到其他内容时，不关闭新内容。保存模式沿用原存储规则。

侧聊没有模型、提示词和保存设置。保留既有保存偏好和历史，不改变默认保存语义。
普通聊天从主 `ChatComposer` 的唯一有效模型接线，创建及每次发送、重试传当前 `modelId`。
多模型选择时需在主输入框选择单个模型。智能体保留 `agent-session:<sessionId>` 来源，主进程解析所属智能体当前模型。
进行中的请求不换模型。无有效模型时保留草稿和历史，并沿用现有错误提示。

消息使用共享 `MessageList`，输入使用共享 `ComposerSurface`，并提供独立工具上下文。预填引用时直接加载其富文本运行时，避免短暂显示引用标签源码。侧聊草稿仅保存在窗口内存，不接主聊草稿缓存。
侧聊输入框复用聊天和智能体共有的工具菜单、固定工具栏、语音和模型速度控件，不提供“新任务”、联网搜索或绘图开关。模型仍跟随主对话。智能体专用技能、权限模式和斜杠命令尚未接入侧聊执行链，不能将当前输入框视为完全一致。
联网和绘图能力读取来源配置，不因隐藏按钮而关闭。MCP 选择修改来源助手或智能体的配置，按钮显示来源的启用状态。附件、知识库选择和本轮推理强度、服务等级随问题发送，重试和授权续跑保留这些数据。
已保存侧聊的附件沿用普通聊天文件入库流程。临时侧聊仅引用原文件或内存图片，不创建文件条目；仍受模型文件能力和侧聊上下文上限约束。
已有侧聊的富文本草稿、附件和知识库选择保留在窗口内存。删除侧聊时一并清理。截图按钮显式指定接收输入框，避免主聊和侧聊同时挂载时串入。
侧聊沿用普通对话的工具执行链。普通聊天继承来源助手的工具和 MCP 配置；智能体来源使用其关联 MCP、知识库和工具禁用项。
工具调用、结果和授权卡使用共享消息组件。授权决定绑定侧聊及回答；同一回答的授权全部处理后才继续，拒绝不执行对应工具。
续跑保留原回答和模型，不复制主对话历史。临时侧聊的消息与工具结果仍只保存在内存，工具输出不落盘卸载。
点击“在侧栏中提问”后，直接显示输入框。划词使用与主对话相同的引用 token，放在输入框内。
不再显示“创建侧聊”确认按钮。首次发送时才创建侧聊并提交问题；发送失败保留草稿，重试复用已创建的侧聊。
发送时保留主对话的 composer 快照，引用按共享组件显示。保留文本偏移，避免空白裁剪破坏引用位置。旧消息中的初始引用仅在显示时补齐元数据，不修改历史存储。
`useSideChats` 与 `SideChatState` 仅保存窗口内存状态。RPC 和事件共用 revision 检查，删除后保留版本墓碑。
流事件不进入持久缓存，也不记录请求正文。
保存侧聊的模型用量关联到对应回答，复用主对话的用量统计。临时侧聊在内存中保留流返回的 token 统计和运行时间，不创建消息记录。统计沿用共享消息右下角的显示。

侧聊与复制、引用共用划词气泡。选区位于同一条回答时，不要求显示文字与 Markdown 源码逐字相同，支持跨格式、表格及内容块选择。跨消息、编辑器和操作按钮内的选区不提供侧聊入口。
侧聊保留用户选择的显示文字。主进程核对来源消息与话题，并读取原始问答。显示文字无法在源码中精确匹配时，不记录定位前后文，也不猜测原文标记位置。
代码阅读视图按源代码行号和行内偏移提取选区。支持语法高亮节点和跨行选择，排除显示行号和工具栏。代码原文入口保留语法高亮。
原文标记同时核对消息身份、选区和前后文。重复、修改或缺失的片段不猜位置。

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
原文标记只标识已核对的位置，不可点击。侧聊适配器不提供 `openSideChat`，避免递归。
收起或切换预览不会关闭侧聊。明确关闭临时侧聊会清除内容和草稿；保存模式保留历史。

侧聊没有模型、提示词和保存设置。保留既有保存偏好和历史，不改变默认保存语义。
普通聊天从主 `ChatComposer` 的唯一有效模型接线，创建及每次发送、重试传当前 `modelId`。
多模型选择时需在主输入框选择单个模型。智能体保留 `agent-session:<sessionId>` 来源，主进程解析所属智能体当前模型。
进行中的请求不换模型。无有效模型时保留草稿和历史，并沿用现有错误提示。

消息使用共享 `MessageList`，输入使用 `ComposerSurface`。侧聊仅接窗口内存草稿，不接工具、设置和主聊草稿缓存。
`useSideChats` 与 `SideChatState` 仅保存窗口内存状态。RPC 和事件共用 revision 检查，删除后保留版本墓碑。
流事件不进入持久缓存，也不记录请求正文。

Markdown 选区只接受能与源码位置核对的文本。跨消息或无法核对的选区不提供入口，不改为引用整条回答。
原文标记同时核对消息身份、选区和前后文。重复、修改或缺失的片段不猜位置。

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
| `src/renderer/components/chat/sideChat/` | Side-chat panels, source markers, and UI integration with window-local memory state |
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

## Side-chat UI

Ordinary chat and Agent sessions expose text-selection actions through
`MessageListActions.openSideChat`. `TopicRightPane` and `AgentRightPane` host side
chats. There are no entry points below answers, in the flow canvas, or at the top
right. Source-text markers open the corresponding side chat; when multiple side
chats share a location, users choose one there. The panel header shows neither a
history list nor a repeated quote. The side-chat adapter omits `openSideChat` to
prevent nesting. Delete is an icon-only action to the left of Close Sidebar in the
header and still requires confirmation. Collapsing the panel or switching previews
does not clear the side chat. Successful deletion clears its content and draft and
collapses the current side-chat sidebar. If the user switches to other content
during deletion, that content stays open. Saving follows the existing storage rules.

Side chats have no model, prompt, or saving controls. Existing saving preferences,
history, and default saving behavior remain unchanged. Ordinary chat uses the main
`ChatComposer`'s single valid model and passes the current `modelId` on creation and
each submit or retry. If multiple models are selected, the user must select one
model in the main composer. Agent sources retain `agent-session:<sessionId>`; the
main process resolves the owning Agent's current model. In-flight requests keep
their model. Without a valid model, drafts and history are retained and the existing
model error is shown.

Messages use the shared `MessageList`; input uses the shared `ComposerSurface` with
an independent tool context. Prefilled quotes load the rich-text runtime directly
to avoid briefly showing raw quote tags. Side-chat drafts stay in window-local
memory and do not use the main-chat draft cache.
The side-chat composer reuses the tool menu, pinned toolbar, voice, and model-speed
controls shared by ordinary chat and Agents. It omits New Task, web-search, and
image-generation toggles. The model still follows the main conversation. Agent-only
skills, permission mode, and slash commands are not connected to side-chat execution
yet, so the composers are not fully equivalent.
Web-search and image-generation capabilities read the source configuration;
hiding their buttons does not disable them. MCP selection updates the source
Assistant or Agent configuration, and the button shows its enabled state.
Attachments, knowledge-base selections, reasoning effort, and service tier are sent
with the question and retained across retries and approval continuations.
Saved side-chat attachments use ordinary chat's file-ingestion flow. Temporary side
chats reference original files or in-memory images without creating file records;
model file capabilities and side-chat context limits still apply.
Rich-text drafts, attachments, and knowledge-base selections for existing side chats
remain in window-local memory and are cleared on deletion. The screenshot button
explicitly selects the receiving composer so screenshots do not enter the wrong
composer when main and side chats are mounted together.
Side chats reuse ordinary chat's tool execution path. Ordinary chat inherits its
source Assistant's tool and MCP configuration; Agent sources use their associated
MCP services, knowledge bases, and disabled-tool rules.
Tool calls, results, and approval cards use shared message components. Approval
decisions are bound to the side chat and answer. Execution resumes only after every
approval for that answer has been decided; rejected tools do not run.
Continuation retains the original answer and model without copying main-chat
history. Temporary side-chat messages and tool results remain in memory, with no
tool-output offloading to disk.
Ask in Sidebar opens the composer immediately. Selected text appears inside it as
the same quote token used by the main conversation.
There is no Create Side Chat confirmation button. The first submit creates the side
chat and sends the question; a failed submit retains the draft, and retry reuses the
created side chat.
Submission preserves the main composer's snapshot, and shared components render the
quote. Text offsets are retained so whitespace trimming cannot shift the quote's
position. Initial quotes in older messages receive missing metadata only for
display; stored history is not changed.
`useSideChats` and `SideChatState` hold only window-local memory state. RPC responses
and events share revision checks, and deletion retains version tombstones.
Stream events do not enter persistent caches, and request bodies are not logged.
Saved side-chat model usage is linked to the corresponding answer and reuses
main-chat usage statistics. Temporary side chats retain streamed token counts and
runtime duration in memory without creating message records. Statistics appear at
the bottom right of the shared message component.

Side chats share the text-selection bubble with Copy and Quote. Selections within
one answer may span formatting, tables, and content blocks; rendered text need not
match the Markdown source verbatim. Cross-message selections and selections inside
editors or action buttons do not expose the side-chat action.
Side chats retain the rendered text selected by the user. The main process validates
the source message and topic and reads the original question and answer. If the
rendered text has no exact source match, it stores no surrounding text for location
matching and does not guess where to place a source marker.
The code reading view extracts selections using source line numbers and offsets
within lines. It supports syntax-highlighted nodes and multiline selections while
excluding displayed line numbers and toolbars. Source entry points in code retain
syntax highlighting.
Source markers validate message identity, selection, and surrounding text together.
They do not guess locations for repeated, edited, or missing passages.

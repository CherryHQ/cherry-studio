# Message Components Refactor TODO

This TODO is scoped to `src/renderer/src/components/chat/messages` and the Home/Agent/History wiring that feeds it.

Sources:

- `README.md`: message components own display only; business data and page behavior enter through provider/actions/adapters.
- Feishu doc `聊天页面组件 v2 设计`: v2 components should use Provider/Context contracts, Adapter contracts, Action/Command descriptors, shared message stream/frame/block primitives, and avoid v1 boundaries such as separate chat/agent message implementations.
- Current code state: `MessageListItem + CherryMessagePart[]` is already the main rendering contract, Home/Agent already share `MessageList`, `MessageListProvider` has started splitting contexts, and `MessageMenuBar` has started using an action registry.

## Overall Target

把消息显示从 Home、Agent、History 的业务逻辑里拆出来，最终形成一套稳定、可复用、可测试的消息组件。

The refactor has three practical goals:

- 断开旧耦合：shared messages 不再直接依赖 Home chat context、page-private hooks、legacy message/block types, or platform side effects.
- 能力可插拔：delete, edit, retry, export, trace, translation, tool approval, and file operations are provided as capabilities by page adapters.
- 边界可验证：each step has static import checks, focused tests, and manual regression points so the refactor does not quietly drift back to v1-style coupling.

## Scope Guard

Do not expand this TODO into unrelated page work.

In scope:

- message list orchestration
- virtual list and scroll runtime
- message frame, header, body, footer, actions
- message blocks and tool-call blocks
- selection and multi-select message actions
- Home/Agent/History adapter wiring needed to feed the shared message UI

Out of scope for this file:

- input/composer redesign
- top navigation
- left resource/session/topic sidebars
- right pane redesign, except explicit artifact/message preview contracts
- settings pages, except values that must be injected as message render config

## Current Baseline

Already in place or partially in place:

- Shared list contract uses `MessageListItem` and `partsByMessageId`.
- Home and Agent render through the shared `MessageList`.
- `MessageListProvider` is split into data, parts, actions, meta, render config, selection, and UI contexts.
- `MessageMenuBar` action definitions live in `frame/messageMenuBarActions.tsx`.
- Platform actions such as save image, export, trace, open path, show in folder, and abort tool are exposed through `MessageListActions`.
- Agent has started gaining capability-driven actions instead of relying on a global read-only switch.
- Message selection and multi-select actions now enter through `useMessageSelectionController` and `MessageListActions`; the old `useChatContext` bridge has been removed.

Still leaking or incomplete:

- Shared leaf components still read Preference/Cache/DataApi or business hooks directly in several places.
- `ErrorBlock` still owns AI error diagnosis caching and message patching.
- `MessageMenuBar` still reads preferences and handles translation/model-selection details locally.
- Tool-call UI is shared visually, but Agent execution is not yet a clear `AgentExecutionTimeline` style primitive.
- Adapters still live under `messages/adapters`; acceptable during migration, but long-term page business assembly should move back to page-side wiring.

## Step 1: Move Selection And Multi-Select Out Of `useChatContext`

Status: Done in the current branch.

Goal: message selection belongs to the message provider contract, not the legacy chat context.

Why this matters: 多选应该是消息列表能力，不是 Home 聊天上下文能力；这样 Agent 和 History 可以逐步接入多选，而不会误用 Home 的写接口或平台保存逻辑。

Tasks:

- Add a message-selection controller/hook that returns only renderable selection state plus actions:
  - `selection.enabled`
  - `selection.isMultiSelectMode`
  - `selection.selectedMessageIds`
  - `actions.selectMessage`
  - `actions.toggleMultiSelectMode`
  - `actions.copySelectedMessages`
  - `actions.saveSelectedMessages`
  - `actions.deleteSelectedMessages`
- Let Home and Agent adapters inject those capabilities explicitly.
- Move multi-select markdown export ordering to a shared utility based on `MessageListItem[] + partsByMessageId`.
- Route selected-message save through `actions.saveTextFile`, not direct `window.api`.
- Remove `useChatContext(topic)` from `homeMessageListAdapter`.
- Keep composer hiding and bottom spacing as page-level behavior that reacts to selection state, not as message-core shell ownership.

Acceptance:

```bash
rg "useChatContext" src/renderer/src/components/chat/messages src/renderer/src/pages/agents src/renderer/src/pages/home/ChatContent.tsx --glob '!TODO.md'
test ! -e src/renderer/src/hooks/useChatContext.ts
```

Expected result: message adapters no longer depend on `useChatContext`; selected-message file save does not call `window.api` directly.

Focused tests:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/__tests__/agentMessageListAdapter.test.tsx \
  src/renderer/src/pages/home/__tests__/ChatContent.test.tsx
```

## Step 2: Finish Fine-Grained Provider Consumption

Goal: the provider split should reduce unnecessary rendering and make each component depend only on the data it needs.

Why this matters: streaming parts 高频变化时，只应该刷新正文和相关 block；header、menu、selection、layout 不应该因为同一个大 provider object 变化而被动重渲染。

Tasks:

- Replace remaining broad `useMessageList()` usage with focused hooks:
  - `useMessageListData`
  - `useMessageListParts`
  - `useMessageListActions`
  - `useMessageListMeta`
  - `useMessageRenderConfig`
  - `useMessageListSelection`
  - `useMessageListUi`
- Move render-only preferences into `MessageRenderConfig` or `MessageListState`:
  - markdown math engine and single-dollar behavior
  - code fancy block flag
  - thinking auto-collapse
  - message font and size for blocks/tool output
  - developer-mode and confirm-delete/regenerate flags for menu rendering
  - export menu option flags
- Keep `partsByMessageId` updates isolated to `MessagePartsRenderer` and block-level consumers where possible.
- Keep `MessageListContext` only as a temporary compatibility escape hatch; do not add new consumers.

Acceptance:

```bash
rg "useMessageList\\(" src/renderer/src/components/chat/messages
rg "usePreference" src/renderer/src/components/chat/messages/{frame,blocks,markdown,tools}
```

Expected result: broad provider consumption decreases; Preference reads are either gone from shared core or listed as explicit temporary exceptions.

Focused tests:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/__tests__/MessageGroup.test.tsx \
  src/renderer/src/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx \
  src/renderer/src/components/chat/messages/markdown/__tests__/Markdown.test.tsx
```

## Step 3: Finish `MessageMenuBar` As Action/Command UI

Goal: the menu bar should render resolved actions and not own business capability checks.

Why this matters: 菜单按钮是否显示、是否禁用、是否需要确认，都应该由 action availability 决定；这样 Home、Agent、History 只要注入不同能力，就能复用同一套菜单 UI。

Tasks:

- Move menu preference inputs into provider state/meta:
  - message style
  - developer mode
  - confirm delete/regenerate
  - export menu availability
- Move translation execution behind a message action, for example:
  - `translateMessage?(messageId, language)`
  - `abortMessageTranslation?(messageId)`
- Move model mention/regenerate selection behind an injected action or render slot, so `MessageMenuBar` does not directly know model-provider filtering rules.
- Keep `messageMenuBarActions.tsx` as the only place that declares action descriptors.
- Keep `MessageMenuBar.tsx` responsible only for layout, dropdown rendering, and connecting click events to resolved actions.
- Make toolbar and dropdown availability purely descriptor-driven.

Acceptance:

```bash
rg "usePreference|useMultiplePreferences|translateText|abortCompletion|ModelSelector" src/renderer/src/components/chat/messages/frame/MessageMenuBar.tsx
rg "availability:" src/renderer/src/components/chat/messages/frame/messageMenuBarActions.tsx
```

Expected result: `MessageMenuBar.tsx` has no direct business preference or translation/model-selection wiring; action availability lives in descriptors.

Focused tests:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx
```

## Step 4: Turn Error Diagnosis And Error Mutation Into Capabilities

Goal: `ErrorBlock` displays error state; adapters decide whether AI diagnosis, cache, navigation, or message mutation are available.

Why this matters: 错误块应该只负责展示错误；AI 诊断、缓存、删除 error part、patch message 都是业务能力，必须由具体页面决定是否支持。

Tasks:

- Add explicit actions/types:
  - `diagnoseMessageError?(input): Promise<DiagnosisResult | string | null>`
  - `removeMessageErrorPart?(messageId, partId): Promise<void>`
  - `openErrorDetail?(input): void`
  - `navigateErrorTarget?(target): void`
- Move `classifyErrorByAI`, cache TTL, and DataApi patching into Home adapter or a page-side service.
- Let Agent/History omit mutation/diagnosis actions when unsupported.
- Keep local deterministic classification and visual display in the block if it is pure and renderer-only.

Acceptance:

```bash
rg "dataApiService|cacheService|classifyErrorByAI|useNavigate" src/renderer/src/components/chat/messages/blocks/ErrorBlock.tsx
```

Expected result: no DataApi/Cache direct access in `ErrorBlock`; unsupported actions hide or disable the remove/diagnose affordance.

Focused tests:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx
```

Add a minimal ErrorBlock test when extracting the actions.

## Step 5: Clean Leaf Block And Tool Platform Boundaries

Goal: message blocks and tool cards should be renderers plus provider actions, not page/platform integrations.

Why this matters: Markdown、Thinking、Code、MCP、附件、编辑器这些底层 block 越纯，越容易复用和测试；它们不应该自己读 Preference、DataApi、`window.api` 或页面私有 hook。

Tasks:

- `MessageEditor`:
  - move editor preferences into `MessageListState` or editor-specific config
  - move upload/file normalization behind actions such as `prepareEditorFiles` or `uploadEditorFiles`
  - keep `selectFiles` capability-driven
  - avoid direct `FileManager` and broad input/composer settings in shared core
- `MainTextBlock`, `ThinkingBlock`, `Markdown`, `CodeBlock`, `MessageMcpTool`:
  - replace direct `usePreference` reads with `MessageRenderConfig` or block config
- `MessageAttachments` / `MessageAttachmentPreview`:
  - verify whether `useAttachment` is pure rendering support or business ownership
  - move opening/downloading side effects to actions when needed
- Tool approval and MCP/tool metadata:
  - move approval responses to provider actions
  - move auto-approval lookup out of shared blocks if it depends on business data
  - keep `abortTool` as injected action
- Agent file paths:
  - keep open/show-in-folder capability-driven
  - remove direct external-app hook usage from shared renderers if possible

Acceptance:

```bash
rg "@data/|@renderer/hooks|window\\.api" src/renderer/src/components/chat/messages/{frame,blocks,markdown,tools}
```

Expected result: direct imports are either gone or documented as pure UI/runtime exceptions.

Focused tests:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/blocks/__tests__/MainTextBlock.test.tsx \
  src/renderer/src/components/chat/messages/blocks/__tests__/ThinkingBlock.test.tsx \
  src/renderer/src/components/chat/messages/markdown/__tests__/CodeBlock.test.tsx \
  src/renderer/src/components/chat/messages/tools/__tests__/ClickableFilePath.test.tsx
```

## Step 6: Formalize Agent Execution Components

Goal: ordinary chat and Agent share the message frame, while Agent execution becomes an explicit message sub-family.

Why this matters: 普通聊天和 Agent 可以共享消息框架，但工具调用、权限请求、终端输出、文件 diff、todo、subagent 等执行过程需要清晰的 Agent execution 组件族，而不是散落在普通消息 block 里。

Tasks:

- Introduce or consolidate these primitives under `tools/` or a dedicated `execution/` folder:
  - `AgentExecutionTimeline`
  - `ToolCallCard`
  - `ToolCallGroup`
  - `ToolPermissionCard`
  - `AskUserQuestionCard`
  - `TerminalOutputCard`
  - `FileDiffCard`
  - `TaskTodoPanel`
  - `SubAgentGroup`
  - `ExecutionSummary`
- Define the input contract from `CherryMessagePart[]`, not page-private Agent state.
- Add collapse state and "show final messages only" mode as provider UI state/actions.
- Keep permission and ask-user responses capability-driven.
- Keep task/todo data real and adapter-fed; avoid mock-only visual containers.

Acceptance:

```bash
rg "@renderer/pages/agents|@renderer/pages/home" src/renderer/src/components/chat/messages/tools
rg "mock" src/renderer/src/components/chat/messages/tools src/renderer/src/components/chat/messages/blocks
```

Expected result: agent execution rendering is explicit, reusable, and not coupled to page-private Agent modules.

Focused tests:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/tools/__tests__/AgentToolRenderer.test.tsx
```

## Step 7: Move Business Adapters Back To Page Wiring

Goal: shared message core should expose contracts and UI; Home/Agent/History should own business assembly.

Why this matters: `components/chat/messages` 越干净，越不容易重新引入 page-private imports；Home、Agent、History 如何取数、写入和接平台能力，应回到各自页面侧 wiring。

Target shape:

```txt
components/chat/messages/
  MessageList.tsx
  MessageListProvider.tsx
  types.ts
  list/
  frame/
  blocks/
  tools/
  markdown/
  stream/
  utils/

pages/home/messages/
  homeMessageListAdapter.tsx
  useMessageExportActions.ts
  useMessageListRenderConfig.ts

pages/agents/messages/
  agentMessageListAdapter.ts

pages/history/messages/
  historyMessageListAdapter.ts
```

Tasks:

- Move `homeMessageListAdapter.tsx`, `agentMessageListAdapter.ts`, and business helper hooks out of shared `messages/adapters`.
- Keep only shared projection helpers and type-safe utilities under `components/chat/messages/utils`.
- Make public exports from `components/chat/messages/index.ts` contract-focused.
- Ensure shared components do not import page-private paths.

Acceptance:

```bash
rg "@data/|@renderer/hooks|EventEmitter|window\\.api|@renderer/pages/(home|agents)" src/renderer/src/components/chat/messages
find src/renderer/src/components/chat/messages/adapters -type f
```

Expected result: shared core has no business/data/platform imports, and `messages/adapters` is either empty, deleted, or limited to documented generic adapter utilities.

## Step 8: History And Search Follow-Up

Goal: History should consume the same message list contract without reintroducing legacy message/block types.

Why this matters: History 如果继续走 legacy `MessageBlock` 或 Dexie `message_blocks`，消息重构就会留下第二条旧链路；它也应该使用 `MessageListItem + partsByMessageId`。

Tasks:

- Keep History rendering on `MessageListItem + partsByMessageId`.
- Ensure search result loading returns enough data to render a focused message view without Dexie `message_blocks`.
- Keep History write actions absent unless explicitly supported.
- Reuse the same export and plain-text utilities as Home/Agent.

Acceptance:

```bash
rg "@renderer/types/newMessage|message_blocks|dexie" src/renderer/src/pages/history src/renderer/src/components/chat/messages
```

Expected result: no legacy message-block data source in History message rendering.

## Step 9: Regression And Performance Baseline

Goal: each refactor step stays reversible, testable, and measurable.

Why this matters: 这轮重构会持续多步推进，必须每一步都有静态边界检查、聚焦测试和手测场景，避免“代码变多了，但边界没有变干净”。

Required focused checks after touching message components:

```bash
pnpm exec vitest run \
  src/renderer/src/components/chat/messages/__tests__/MessageGroup.test.tsx \
  src/renderer/src/components/chat/messages/blocks/__tests__/MessagePartsRenderer.test.tsx \
  src/renderer/src/components/chat/messages/frame/__tests__/messageMenuBarActions.test.tsx \
  src/renderer/src/pages/home/__tests__/ChatContent.test.tsx

npm run typecheck:web
```

Static gates before declaring a message-boundary step done:

```bash
rg "@renderer/pages/(home|agents)" src/renderer/src/components/chat/messages
rg "@renderer/types/newMessage" src/renderer/src/components/chat/messages src/renderer/src/pages/history
rg "window\\.api|dataApiService|cacheService|EventEmitter" src/renderer/src/components/chat/messages
rg "useMessageList\\(" src/renderer/src/components/chat/messages
```

Manual regression checklist:

- Home topic switch shows the right message list without long loading flicker.
- Agent session switch uses the same loading behavior as Home.
- Home and Agent single-message menu capabilities match injected actions.
- Home and Agent multi-select copy/save/delete preserve visible message order.
- Streaming assistant message updates without forcing unrelated headers/menus to visibly flicker.
- Older-message loading keeps scroll position.
- Message locate/highlight works for virtualized messages.
- Error block still shows deterministic classification and only shows mutation affordances when supported.
- Agent tool calls, permission requests, ask-user prompts, file paths, terminal output, and final messages still render correctly.

## Suggested PR Slices

Keep every PR small enough to review and roll back:

1. `refactor(messages): move selection actions into message provider`
2. `refactor(messages): inject render preferences through provider config`
3. `refactor(messages): finish menu action registry boundary`
4. `refactor(messages): extract error diagnosis capabilities`
5. `refactor(messages): remove leaf block business hooks`
6. `refactor(messages): formalize agent execution rendering`
7. `refactor(messages): move page adapters out of shared core`
8. `refactor(history): align history messages with shared contract`

Each slice should include at least one focused test or fixture, plus the static acceptance command for the boundary it changes.

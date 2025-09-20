# Agents Service Refactor TODO (interface-level)

- [x] **SessionMessageService.createSessionMessage**
  - Replace the current `EventEmitter` that emits `UIMessageChunk` with a readable stream of `TextStreamPart` objects (same shape produced by `/api/messages` in `messageThunk`).
  - Update `startSessionMessageStream` to call a new adapter (`claudeToTextStreamPart(chunk)`) that maps Claude Code chunk payloads to `{ type: 'text-delta' | 'tool-call' | ... }` parts used by `AiSdkToChunkAdapter`.
  - Add a secondary return value (promise) resolving to the persisted `ModelMessage[]` once streaming completes, so the renderer thunk can await save confirmation.

- [x] **main -> renderer transport**
  - Update the existing SSE handler in `src/main/apiServer/routes/agents/handlers/messages.ts` (e.g., `createMessage`) to forward the new `TextStreamPart` stream over HTTP, preserving the current agent endpoint contract.
  - Keep abort handling compatible with the current HTTP server (honor `AbortController` on the request to terminate the stream).

- [x] **renderer thunk integration**
  - Introduce a thin IPC contract (e.g., `AgentMessagePersistence`) surfaced by `src/main/services/agents/database/index.ts` so the renderer thunk can request session-message writes without going through `SessionMessageService`.
    - Define explicit entry points on the main side:
      - `persistUserMessage({ sessionId, agentSessionId, payload, createdAt?, metadata? })`
      - `persistAssistantMessage({ sessionId, agentSessionId, payload, createdAt?, metadata? })`
      - `persistExchange({ sessionId, agentSessionId, user, assistant })` which runs the above in a single transaction and returns both records.
    - Export these helpers via an `agentMessageRepository` object so both IPC handlers and legacy services share the same persistence path.
    - Normalize persisted payloads to `{ message, blocks }` matching the renderer schema instead of AI-SDK `ModelMessage` chunks.
  - Extend `messageThunk.sendMessage` to call the agent transport when the topic corresponds to a session, pipe chunks through `createStreamProcessor` + `AiSdkToChunkAdapter`, and invoke the new persistence interface once streaming resolves.
  - Replace `useSession().createSessionMessage` optimistic insert with dispatching the thunk so Redux/Dexie persistence happens via the shared save helpers.

- [x] **persistence alignment**
  - Remove `persistUserMessage` / `persistAssistantMessage` calls from `SessionMessageService`; instead expose a `SessionMessageRepository` in `main` that the thunk invokes via existing Dexie helpers.
  - On renderer side, persist agent exchanges via IPC after streaming completes, storing `{ message, blocks }` payloads while skipping Dexie writes for agent sessions so the single source of truth remains `session_messages`.

- [x] **Blocks renderer**
  - Replace `AgentSessionMessages` simple `<div>` render with the shared `Blocks` component (`src/renderer/src/pages/home/Messages/Blocks`) wired to the Redux store.
  - Adjust `useSession` to only fetch metadata (e.g., session info) and rely on store selectors for message list.

- [x] **API client clean-up**
  - Remove `AgentApiClient.createMessage` direct POST once thunk is in place; calls should go through renderer thunk -> stream -> final persistence.

- [ ] **Regression tests**
  - Add integration test to assert agent sessions render incremental text the same way as standard assistant messages.

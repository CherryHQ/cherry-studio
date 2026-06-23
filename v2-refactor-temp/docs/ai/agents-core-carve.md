# Agents Core Carve (history rides this)

Scope doc for the carve that lands the v2 **agent-session core** onto `main`,
and with it the **history** page (#8 of the non-chat/agent page splits, which
measured as *not* an independent page — see below). Status: **scoped, not
started** (user-deferred 2026-06-21; the 7 true page carves #16263–16269 shipped
first).

## Why history is not a page split

The 7 non-chat/agent pages (translate, mini-apps, launchpad, openclaw, code,
knowledge, settings) carve standalone because their feat-vs-main delta is
additive — new/changed files depending only on `main` + a brought shared
component. `history` does not: assembling its full closure on `main` and running
`tsgo --noEmit -p tsconfig.web.json` yields **63 errors, 42 of them inside
`pages/agents`**. `HistoryRecordsPage` renders agent sessions and topic history
against the v2 agent shape, so it pulls the whole agent-session stack with it.

## The two hard couplings (measured)

1. **Agent type — `src/renderer/types/agent.ts`.** feat enriches the renderer
   agent shape: `name: string`, `modelName: string | null`, and
   `planModel?: \`${string}::${string}\`` (branded `UniqueModelId`) — vs main's
   `model: string` / `planModel?: string` / no `name`. `HistoryRecordsPage`
   passes `Map<string, Agent>` into `buildAgentSources` / `buildAgentStatusItems`
   (`SessionList.helpers.ts`, brought) which expect the enriched shape →
   `TS2345` at HistoryRecordsPage:555/571/715, plus `deleteSessions` /
   signature drift at :514/516/585. Bringing `types/agent.ts` cascades through
   `hooks/agents/*` (useAgent 10/14, useActiveSession 1/18,
   useAgentSessionInitializer 0/28, useSession tests 170/8, …) and every
   `pages/agents` consumer. `useAgents`/`useAgentSessions` themselves are
   **identical** feat↔main — the drift is the *type*, not the hooks.

2. **Export path — `src/renderer/utils/export.ts`.** feat's
   `messageToMarkdown(message: MessageExportView)` vs main's `(message: Message)`
   (v1 `blocks`). This is the un-migrated tail of the messages carve (#16229):
   `useMessageExportActions:53/84` and `utils/knowledge:303/341` fail because
   main's export still wants v1 `Message`. Migrating `utils/export` to
   `MessageExportView` touches every export consumer on `main`.

## Additive bringable bits (cheap, ride along)

- `@shared/data/preference/preferenceTypes` — add `TopicDisplayMode`,
  `AgentSessionDisplayMode`, `MathEngine` (used by `Topics.helpers` /
  `SessionList.helpers` / `preferenceSchemas`).
- `hooks/useTopic` — add `useTopics`.
- `components/command` — add `CommandHint` (used by `components/chat/resources`).
- `EVENT_NAMES.REVEAL_ACTIVE_RESOURCE_LIST` — surgical add to `EventService`
  (#16202 deleted it from main; `resourceListRevealEvents` needs it).
- `components/chat/resources` + `components/chat/actions/ResourceListActionContextMenu`.
- `components/chat/messages/hooks` + `messageListProviderBuilder`,
  `useConversationNavigation`, `hooks/agents/useAgentSessionStreamStatuses`,
  the home/agent context-menu helpers — all relocated v2 files.
- `pages/history/HistoryPage` was renamed → `HistoryRecordsPage`; main's
  `components/Popups/SearchPopup` still imports the old path → repoint or shim.

## Suggested sequence

1. **Agent type + stack** — `types/agent.ts` + `hooks/agents/*` + `pages/agents/*`
   as one unit (this is the 42-error core; `pages/agents` is a co-equal carve,
   not a "shared component").
2. **v2 export** — `utils/export.ts` (`Message`→`MessageExportView`) +
   `services/MessagesService.getMessageTitle` + main's export consumers
   (`utils/knowledge`, …). Closes the #16229 tail.
3. **Additive bringables** above.
4. **history** — `pages/history` + `SearchPopup` repoint, on top of 1–3.

## Validation

- `tsgo --noEmit -p tsconfig.web.json --composite false` → 0 (excl. the 6
  markdown env-noise modules).
- `vitest run src/renderer/pages/agents src/renderer/pages/history`.
- Manual: open History (topic + agent-session tabs), session group/status
  filters, agent source grouping.

## Retires these transitional shims (from the 7 page carves)

- `ModelSelector` subpath `@renderer/components/Selector/model` (used in
  translate/openclaw/code/knowledge/settings) → back to the barrel once main's
  program converges with feat.
- launchpad's re-added `getSidebarFavoriteLabelKey` (feat renamed to
  `getSidebarIconLabelKey`).

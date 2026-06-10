# feat/chat-page Split Review List

Last updated: 2026-06-10

This working note tracks the `origin/feat/chat-page` split stack for review. The goal is to land independently reviewable business-logic PRs into `main` without a catch-all remainder PR.

## Ground Rules

- Target branch is `main`.
- Do not use the abandoned `codex/chat-stack-01..15` branches.
- Do not open catch-all equivalence branches as a substitute for business-boundary splits.
- Prefer business boundaries over file-count boundaries.
- Let DB API PRs grow when schema, handler, service, hook, and consumer changes form one contract.
- For stacked PRs, review the smallest prerequisite first, then rebase or retarget dependent PRs as prerequisites merge.

## Open PRs

These branches already have non-draft PRs open against `main`.

| PR | Branch | Review area |
| --- | --- | --- |
| [#15848](https://github.com/CherryHQ/cherry-studio/pull/15848) | `codex/split-01-data-delete-body` | DataApi delete request bodies |
| [#15849](https://github.com/CherryHQ/cherry-studio/pull/15849) | `codex/split-02-ui-floating-primitives` | Portal-aware UI floating primitives |
| [#15850](https://github.com/CherryHQ/cherry-studio/pull/15850) | `codex/split-03-ui-tree-view` | UI tree view composite |
| [#15851](https://github.com/CherryHQ/cherry-studio/pull/15851) | `codex/split-04-ui-markdown-composite` | UI markdown composite |
| [#15852](https://github.com/CherryHQ/cherry-studio/pull/15852) | `codex/split-05-ui-primitive-polish` | UI primitive interaction polish |
| [#15853](https://github.com/CherryHQ/cherry-studio/pull/15853) | `codex/split-06-renderer-hook-utilities` | Renderer overlay and resize hooks |
| [#15854](https://github.com/CherryHQ/cherry-studio/pull/15854) | `codex/split-07-renderer-virtual-list-groups` | Grouped sortable virtual lists |
| [#15855](https://github.com/CherryHQ/cherry-studio/pull/15855) | `codex/split-08-renderer-html-artifacts-preview` | HTML artifact preview improvements |
| [#15856](https://github.com/CherryHQ/cherry-studio/pull/15856) | `codex/split-09-renderer-code-toolbar-position` | Code toolbar click-through positioning |
| [#15857](https://github.com/CherryHQ/cherry-studio/pull/15857) | `codex/split-10-renderer-edit-components` | Shared prompt edit components |
| [#15858](https://github.com/CherryHQ/cherry-studio/pull/15858) | `codex/split-11-renderer-icons` | Shell and loading icons |
| [#15859](https://github.com/CherryHQ/cherry-studio/pull/15859) | `codex/split-12-renderer-horizontal-scroll` | Horizontal scroll control layering |
| [#15860](https://github.com/CherryHQ/cherry-studio/pull/15860) | `codex/split-13-provider-api-options` | Provider API option visibility |
| [#15861](https://github.com/CherryHQ/cherry-studio/pull/15861) | `codex/split-14-link-preview-og-card` | Link preview OG card rendering |
| [#15862](https://github.com/CherryHQ/cherry-studio/pull/15862) | `codex/split-15-knowledge-navigator-menus` | Knowledge navigator command menus |
| [#15863](https://github.com/CherryHQ/cherry-studio/pull/15863) | `codex/split-16-ai-trace-observability` | AI trace span capture |
| [#15864](https://github.com/CherryHQ/cherry-studio/pull/15864) | `codex/split-17-ai-stream-steer-queue` | AI stream steer queue |
| [#15865](https://github.com/CherryHQ/cherry-studio/pull/15865) | `codex/split-18-ai-agent-runtime` | Agent runtime warm sessions |
| [#15866](https://github.com/CherryHQ/cherry-studio/pull/15866) | `codex/split-19-ai-mcp-tool-runtime` | Claude MCP tool runtime |
| [#15867](https://github.com/CherryHQ/cherry-studio/pull/15867) | `codex/split-20-provider-settings-patch` | Provider settings patch merge |
| [#15868](https://github.com/CherryHQ/cherry-studio/pull/15868) | `codex/split-25-library-resource-workflow` | Library resource workflow |

## Pushed Branches Waiting For PRs

These branches are pushed to `origin` but did not have matching open PRs at the time of this update.

| Branch | Suggested review area | Notes |
| --- | --- | --- |
| `codex/split-21-chat-primitives` | Chat primitives | Branch pushed; PR description was not captured locally. |
| `codex/split-22-chat-contracts-adapters` | Chat contracts and adapters | Branch pushed; PR description was not captured locally. |
| `codex/split-23-chat-resource-actions` | Chat resource actions | Branch pushed; PR description was not captured locally. |
| `codex/split-24-chat-shell-layout` | Chat shell layout | Branch pushed; PR description was not captured locally. |
| `codex/split-26-selector-model-infra` | Reusable selector infrastructure | Adds selector shell, model selector implementation, portal support, filtering, keyboard navigation, and focused tests. |
| `codex/split-27-tag-management-hooks` | Tag mutation hooks | Adds reusable tag rename and delete mutations for resource surfaces. |
| `codex/split-28-assistant-catalog-source-api` | Assistant catalog source API | Persists assistant source, stable catalog preset IDs, list ordering filters, and serialized DB writes. |
| `codex/split-29-library-form-adapters` | Library form adapters | Branch pushed; PR description was not captured locally. |
| `codex/split-30-agent-resource-api` | Agent resource API | Moves agents from persisted allowlists to disabled-tool policy, adds order keys and incremental list reads. |
| `codex/split-31-container-trace-data-api` | Container-owned trace data API | Moves trace IDs from message rows to topic/session containers and updates schemas, DTOs, mappers, projections, and migration targets. |
| `codex/split-32-topic-branch-copy-data-api` | Topic branch copy DataApi | Adds branch-copy endpoint and service logic to clone a root-to-node path into a new topic. |
| `codex/split-33-chat-settings-panel` | Chat settings panel | Extracts reusable chat preference sections for input, message, math, and code settings. |
| `codex/split-34-library-skill-detail-dialog` | Library skill detail dialog | Replaces full skill editor navigation with a focused metadata dialog in library resource flows. |
| `codex/split-35-chat-trace-pane` | Chat trace pane | Adds renderer trace tree/detail pane and minimal `TRACE_GET_DATA` IPC backed by `SpanCacheService.getSpans()`. |
| `codex/split-36-chat-adapter-contracts` | Shared chat adapter contracts | Adds `ResourceListAdapter`, `ComposerAdapter`, tests, README guidance, and chat component exports. |
| `codex/split-37-chat-layout-primitives` | Chat layout primitives | Adds layout contexts, `NarrowLayout`, immersive navbar resolution logic, and layout tests. |
| `codex/split-38-chat-composer-token-draft` | Composer token draft foundation | Adds token chips, Tiptap token schema, prompt-variable editing, paste parsing, draft serialization, and sent-message token metadata. |
| `codex/split-39-chat-message-flow-model` | Superseded message flow model | Superseded by `split-50` and `split-51`; do not open unless intentionally collapsing the smaller flow graph/layout split. |
| `codex/split-40-chat-message-projection` | Chat message projection | Adds `MessageListItem`, projection helpers, model snapshots, status/stats metadata, and active-branch metadata. |
| `codex/split-41-chat-message-virtualizer-runtime` | Message virtualizer runtime | Adds scroll preservation, streaming follow, sent-message pinning, anchor cache keys, and `virtua`. |
| `codex/split-42-chat-message-list-layout` | Message list layout primitives | Adds shared message-list containers and delayed initial loading UI with tests. |
| `codex/split-43-chat-message-grouping-utils` | Message grouping utilities | Adds sibling grouping, multi-model group layout helpers, and structural-sharing grouped-message cache. |
| `codex/split-44-chat-message-virtual-list` | Message virtual list shell | Connects the virtualizer runtime to React rendering, scroll readiness, top padding, wheel handling, and scroll-to-bottom control. |
| `codex/split-45-chat-message-parts-context` | Message parts context | Adds parts, refresh, and translation overlay contexts for later message renderer slices. |
| `codex/split-46-chat-message-provider-contract` | Message provider contract | Adds provider state/actions/meta types, render/menu defaults, export DTOs, and default-value tests. |
| `codex/split-47-chat-message-provider-runtime` | Message provider runtime | Adds `MessageListProvider` and `MessageContentProvider` runtime contexts and hook-level tests. |
| `codex/split-48-chat-message-selection-utils` | Message selection utilities | Adds selected-message ordering, export view construction, and copy text restoration for composer tokens. |
| `codex/split-49-chat-message-file-path-utils` | Inline file path utilities | Adds renderer-local inline file path normalization, `~/` resolution, token detection, and tests. |
| `codex/split-50-chat-message-flow-graph` | Message flow graph model | Adds topic message flow graph construction and live-tree merge helpers; expands root sibling groups with `SiblingsGroup.parentId: string \| null`. |
| `codex/split-51-chat-message-flow-layout` | Message flow graph layout | Stacked on `split-50`; adds dagre-based React Flow node/edge layout conversion and layout tests. |

## Suggested Review Order

1. Review and land the already-open foundation PRs first: `split-01` through `split-20`, plus `split-25`.
2. Open and review the remaining resource/data API branches: `split-26` through `split-34`.
3. Keep DB API and consumers together when the contract boundary requires it.
4. Review chat shell and composer foundations: `split-21` through `split-24`, then `split-35` through `split-38`.
5. Review message-list foundations before renderer shells: `split-40`, `split-41`, `split-42`, `split-43`, `split-44`.
6. Review message provider and selection utilities: `split-45`, `split-46`, `split-47`, `split-48`, `split-49`.
7. Review message flow as a small stack: `split-50`, then `split-51`.

## Follow-up Split Backlog

These areas still need branch work or PR descriptions after the pushed branches above:

- Tool response adapter for AI SDK `CherryMessagePart` to tool response DTOs.
- Clickable file path renderer, after provider runtime and file path utilities are available.
- Markdown renderer slice.
- Shared tool disclosure/table foundation.
- Agent tool renderer set.
- Remaining `src/renderer/components/chat/` and `src/renderer/pages/` slices that are not covered by the pushed branches.

## Reviewer Checklist

- Confirm each PR has a single business boundary and is not a fallback catch-all.
- Confirm stacked PR bases show only the intended incremental diff.
- For DB/API PRs, review schema/service/handler/hook consumers together when they form one contract.
- Confirm CI is green before merge; local split validation should include `pnpm build:check` unless the PR is docs-only.
- After prerequisite PRs land, rebase or retarget dependent branches before requesting final review.

# feat/chat-page Split Review List

Last updated: 2026-06-10

This working note tracks the `origin/feat/chat-page` split stack for review. The goal is to land independently reviewable business-logic PRs into `main` without a catch-all remainder PR.

## Ground Rules

- Target branch is `main`.
- Do not use the abandoned `codex/chat-stack-01..15` branches.
- Do not open catch-all equivalence branches as a substitute for business-boundary splits.
- Prefer business boundaries over file-count boundaries.
- Let DB API PRs grow when schema, handler, service, hook, and consumer changes form one contract.
- For stacked or prerequisite-heavy areas, review the smallest business slice first, then rebase or retarget dependent PRs as prerequisites merge.

## Open PRs

All currently pushed `codex/split-*` branches now have non-draft PRs open against `main`.

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
| [#15874](https://github.com/CherryHQ/cherry-studio/pull/15874) | `codex/split-21-chat-primitives` | Reusable chat UI primitives |
| [#15875](https://github.com/CherryHQ/cherry-studio/pull/15875) | `codex/split-22-chat-contracts-adapters` | Chat contracts, adapters, action registry, token helpers, and export contracts |
| [#15876](https://github.com/CherryHQ/cherry-studio/pull/15876) | `codex/split-23-chat-resource-actions` | Resource-list action menus, confirm flow, grouped virtual lists, and resource-list infrastructure |
| [#15877](https://github.com/CherryHQ/cherry-studio/pull/15877) | `codex/split-24-chat-shell-layout` | Conversation shell layout, right-pane hosting, immersive navbar state, and resize behavior |
| [#15868](https://github.com/CherryHQ/cherry-studio/pull/15868) | `codex/split-25-library-resource-workflow` | Library resource workflow |
| [#15878](https://github.com/CherryHQ/cherry-studio/pull/15878) | `codex/split-26-selector-model-infra` | Reusable selector and model-selector infrastructure |
| [#15879](https://github.com/CherryHQ/cherry-studio/pull/15879) | `codex/split-27-tag-management-hooks` | Tag mutation hooks |
| [#15880](https://github.com/CherryHQ/cherry-studio/pull/15880) | `codex/split-28-assistant-catalog-source-api` | Assistant catalog source API |
| [#15881](https://github.com/CherryHQ/cherry-studio/pull/15881) | `codex/split-29-library-form-adapters` | Library form adapters |
| [#15882](https://github.com/CherryHQ/cherry-studio/pull/15882) | `codex/split-30-agent-resource-api` | Agent resource API disabled-tool policy and ordering |
| [#15883](https://github.com/CherryHQ/cherry-studio/pull/15883) | `codex/split-31-container-trace-data-api` | Container-owned trace data API |
| [#15884](https://github.com/CherryHQ/cherry-studio/pull/15884) | `codex/split-32-topic-branch-copy-data-api` | Topic branch copy DataApi |
| [#15885](https://github.com/CherryHQ/cherry-studio/pull/15885) | `codex/split-33-chat-settings-panel` | Chat settings panel |
| [#15886](https://github.com/CherryHQ/cherry-studio/pull/15886) | `codex/split-34-library-skill-detail-dialog` | Library skill detail dialog |
| [#15887](https://github.com/CherryHQ/cherry-studio/pull/15887) | `codex/split-35-chat-trace-pane` | Chat trace pane |
| [#15888](https://github.com/CherryHQ/cherry-studio/pull/15888) | `codex/split-36-chat-adapter-contracts` | Shared chat adapter contracts |
| [#15889](https://github.com/CherryHQ/cherry-studio/pull/15889) | `codex/split-37-chat-layout-primitives` | Chat layout primitives |
| [#15890](https://github.com/CherryHQ/cherry-studio/pull/15890) | `codex/split-38-chat-composer-token-draft` | Composer token draft foundation |
| [#15891](https://github.com/CherryHQ/cherry-studio/pull/15891) | `codex/split-39-chat-message-flow-model` | Earlier combined chat message flow model |
| [#15892](https://github.com/CherryHQ/cherry-studio/pull/15892) | `codex/split-40-chat-message-projection` | Chat message projection |
| [#15893](https://github.com/CherryHQ/cherry-studio/pull/15893) | `codex/split-41-chat-message-virtualizer-runtime` | Message virtualizer runtime |
| [#15894](https://github.com/CherryHQ/cherry-studio/pull/15894) | `codex/split-42-chat-message-list-layout` | Message list layout primitives |
| [#15895](https://github.com/CherryHQ/cherry-studio/pull/15895) | `codex/split-43-chat-message-grouping-utils` | Message grouping utilities |
| [#15896](https://github.com/CherryHQ/cherry-studio/pull/15896) | `codex/split-44-chat-message-virtual-list` | Message virtual list shell |
| [#15897](https://github.com/CherryHQ/cherry-studio/pull/15897) | `codex/split-45-chat-message-parts-context` | Message parts context |
| [#15898](https://github.com/CherryHQ/cherry-studio/pull/15898) | `codex/split-46-chat-message-provider-contract` | Message provider contract |
| [#15899](https://github.com/CherryHQ/cherry-studio/pull/15899) | `codex/split-47-chat-message-provider-runtime` | Message provider runtime |
| [#15900](https://github.com/CherryHQ/cherry-studio/pull/15900) | `codex/split-48-chat-message-selection-utils` | Message selection utilities |
| [#15901](https://github.com/CherryHQ/cherry-studio/pull/15901) | `codex/split-49-chat-message-file-path-utils` | Inline file path utilities |
| [#15902](https://github.com/CherryHQ/cherry-studio/pull/15902) | `codex/split-50-chat-message-flow-graph` | Message flow graph model |
| [#15903](https://github.com/CherryHQ/cherry-studio/pull/15903) | `codex/split-51-chat-message-flow-layout` | Message flow graph layout |
| [#15904](https://github.com/CherryHQ/cherry-studio/pull/15904) | `codex/split-52-chat-tool-response-adapter` | Chat tool response adapter |
| [#15905](https://github.com/CherryHQ/cherry-studio/pull/15905) | `codex/split-53-chat-tool-output-truncation` | Tool output truncation helper |
| [#15906](https://github.com/CherryHQ/cherry-studio/pull/15906) | `codex/split-54-chat-tool-task-data` | Agent task data helpers |

## Suggested Review Order

1. Review and land the already-open foundation PRs first: `split-01` through `split-20`, plus `split-25`.
2. Review chat shell and composer foundations: `split-21` through `split-24`, then `split-35` through `split-38`.
3. Review the remaining resource/data API branches: `split-26` through `split-34`. Keep DB API and consumers together when the contract boundary requires it.
4. Review message-list foundations before renderer shells: `split-40`, `split-41`, `split-42`, `split-43`, `split-44`.
5. Review message provider, selection, and file-path utilities: `split-45`, `split-46`, `split-47`, `split-48`, `split-49`.
6. Review message flow: `split-50` and `split-51`; `split-39` is the earlier combined flow-model split and should be reconciled with those smaller PRs during review.
7. Review tool foundation slices: `split-52`, `split-53`, `split-54`.

## Follow-up Split Backlog

These areas still need branch work after the pushed PR set above:

- Clickable file path renderer, after provider runtime and file path utilities are available.
- Markdown renderer slice.
- Shared tool disclosure/table consumers beyond the foundation pieces already split.
- Agent tool renderer set.
- Remaining `src/renderer/components/chat/` and `src/renderer/pages/` slices that are not covered by the pushed branches.

## Reviewer Checklist

- Confirm each PR has a single business boundary and is not a fallback catch-all.
- Confirm PR diffs are interpreted with prerequisite context where branches were split from the same `feat/chat-page` work.
- For DB/API PRs, review schema/service/handler/hook consumers together when they form one contract.
- Confirm CI is green before merge; local split validation should include `pnpm build:check` unless the PR is docs-only.
- After prerequisite PRs land, rebase or retarget dependent branches before requesting final review.

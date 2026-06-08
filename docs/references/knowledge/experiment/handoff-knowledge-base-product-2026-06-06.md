# Handoff: Agent-Managed Knowledge Base Product

Date: 2026-06-06

This handoff captures the current state of the Cherry Studio knowledge base product-design discussion. It is meant for a fresh agent continuing product or technical design work.

## Primary Artifacts

- Product glossary: [../../../CONTEXT.md](../../../CONTEXT.md)
- Main PRD: [agent-managed-knowledge-product.md](./agent-managed-knowledge-product.md)
- UI decision doc: [knowledge-ui-presentation-options.md](./knowledge-ui-presentation-options.md)
- Feishu product doc: <https://mcnnox2fhjfq.feishu.cn/docx/OD28dYOruoFUCSxb6xtcSuxynIb>
- Docs index entry: [../../README.md](../../README.md)
- Older companion docs mentioned in prior discussion, `local-model-product.md` and `file-mode-podcast-acceptance.md`, are not present in this checkout. Reconcile them separately if they are restored from another branch or workspace.

Do not re-create the PRD from scratch. Continue by editing or reviewing the artifacts above.

## Session Sources

The complete product discussion is in:

```text
$HOME/.codex/sessions/2026/06/05/rollout-2026-06-05T21-16-28-019e97ed-8f93-7cb0-9bff-ec5c5a57c6a4.jsonl
```

Useful subagent brainstorm records from the same discussion:

```text
$HOME/.codex/sessions/2026/06/06/rollout-2026-06-06T09-47-11-019e9a9c-db5c-7be2-99af-7de6705ff967.jsonl
$HOME/.codex/sessions/2026/06/06/rollout-2026-06-06T09-47-11-019e9a9c-dbb9-7d22-a0d6-83ed7e38f108.jsonl
$HOME/.codex/sessions/2026/06/06/rollout-2026-06-06T09-47-11-019e9a9c-dc0f-7002-9854-a9849d7ee03e.jsonl
$HOME/.codex/sessions/2026/06/06/rollout-2026-06-06T09-47-11-019e9a9c-dc59-71f2-bf56-67d3acab89d5.jsonl
```

Later review subagents checked the PRD against the main session. Their findings were already folded into the PRD and glossary.

## Latest Update

The latest product principle has been captured locally and in the Feishu doc:

```text
Uploading or importing a source means copying or capturing it as knowledge material in the knowledge base.
The knowledge base owns a stable saved copy or snapshot.
External sources are not live references by default.
```

This applies to files, folders, Cherry Studio notes, URLs, future cloud documents, and Agent-added materials. Cherry Studio notes are no longer treated as "referenced material" that automatically syncs from the source note. They are imported as snapshots by copying the note's indexed local source file.

## Current Product Direction

Product semantics are considered LGTM as of the latest discussion. Remaining work should not reopen the core product model unless a new requirement contradicts it; continue with UI refinement, technical design, or ADR decisions.

The new user-facing knowledge base should be a folder-based, Agent-managed workspace. Users create a knowledge base with only a name. Retrieval models, rerank, and file processors are enhancements configured after creation, not creation prerequisites.

First principle: uploading or importing a source copies or captures it as knowledge material in the knowledge base. Files, folders, Cherry Studio notes, URLs, cloud documents, and Agent-added sources all become knowledge-base-owned saved copies or snapshots. External sources are not live references by default.

The UI should show the real visible knowledge base directory via watcher/fs list. No virtual UI table should decide the file tree. Metadata may decorate files with status such as URL snapshot, processed material, refreshable, Agent generated, stale, or user edited, but metadata must not replace the real directory tree.

The knowledge base detail page should use a file-manager-style main view. The first-phase shape is an ima-like single-pane material browser for the current directory, with list and grid view modes. Clicking a material opens a page-level detail overlay in the same interaction family as the current Knowledge RAG config panel; the browser remains visible underneath and returns to the same list/grid state after close. The primary UI objects are files and directories; source, processing, indexing, refresh, and Agent-generated states are file decorations and detail-overlay explanations. First phase does not include user-visible change logs, operation history, file versions, or Agent operation audit.

Confirmed final direction that overrode earlier subagent suggestions:

- The knowledge base UI main view is an ima-like single-pane material browser with list/grid modes, not data-source-first and not a default two-pane directory tree.
- Material clicks open a page-level detail overlay, not an inline row expansion and not a small action-menu popover.
- If the user enables MinerU/Paddle-style processing and uploads a PDF, generated Markdown is visible processed material.
- The UI may show both `report.pdf` and `report.md`.
- Search indexes and returns the Markdown, not the PDF, when processed Markdown exists.
- Generated Markdown is lifecycle-independent: deleting or moving the PDF does not delete or move the Markdown.
- Agent-generated files are ordinary visible materials once written to the knowledge base directory. There is no hidden Agent artifact pool or "promote to directory" state in the current product decision.
- Agent organization results are reflected by the real directory. The first phase does not persist a separate UI change log or operation history.

## Important Decisions Already Captured

- `list` lists all knowledge bases visible to the current user, not only candidate or bound knowledge bases.
- `search` must pass an explicit knowledge base id, but the id does not need to come from the candidate list.
- Agent-configured knowledge bases, `@知识库`, and "chat from knowledge base detail" add candidate ids to prompt context. They are not permission boundaries.
- `read` should use search locators and be owned by the knowledge system. Raw filesystem reads are only a local transition/testing fallback.
- A future `tree` / `listFiles` knowledge tool is needed so Agents can inspect a knowledge base file tree without raw filesystem access.
- `refresh` for URL/cloud snapshots overwrites the current saved snapshot after confirmation and updates indexes.
- `add` should support the same source families as manual add: local path, files, folders, Cherry Studio notes, URL, cloud document source, and plain text note.
- `delete` removes the knowledge base copy and indexes, not external sources.
- Same-path conflicts prompt replace / keep both / skip. Keep both uses `_2`, `_3`.
- Different-path duplicate content is allowed; Agent can help organize duplicates later.
- Cherry Studio notes are imported as snapshots by copying the note's indexed local source file into the knowledge base. The copied file uses the local source filename, does not auto-sync when the note or source file changes, and can be manually refreshed with overwrite confirmation when source identity is still available.
- Cloud documents are future scope; product direction is saved snapshot plus manual refresh. Provider folders such as Feishu / Tencent Docs are tentative and require i18n consideration.
- Old RAG knowledge base upgrade creates a new folder-based copy. It does not convert in place and does not automatically rewrite Agent/Assistant bindings.
- Migration preserves only folder hierarchy and vector mappings that old data can prove. Do not guess from paths or filenames.
- MinerU Document Explorer is data-design reference only, not UI reference.

## Recent Review Fixes Already Applied

After a review against the main session, the PRD was updated to include:

- Local file content changes should update full-text and semantic indexes.
- External Finder/filesystem deletion should remove the file from UI and clean indexes without a second confirmation.
- Cloud snapshot refresh also updates indexes.
- URL naming is now marked tentative, not final.
- Knowledge-base-detail-to-Agent handoff is now a temporary conversation context, not a persistent binding.
- `list` now says "current user visible" knowledge bases.
- `read` now explicitly is a post-search context tool, not arbitrary path reading.
- Agent-generated files edited by users can retain provenance but should be marked user edited.
- Old vector reuse requires a provable old chunk / loader metadata mapping.
- `CONTEXT.md` was aligned to say legacy upgrade preserves only provable hierarchy.
- The "upload/import means copy/capture into the knowledge base" first principle was added to the PRD, UI doc, handoff, older companion docs, and Feishu product doc.
- Cherry Studio note semantics were changed from source-note reference / automatic sync to copied source-file snapshot / manual refresh with overwrite confirmation.
- The Feishu product doc was updated to add the first principle, replace the Cherry Studio note section, update open questions, add note snapshot acceptance criteria, and remove old "reference source note" language.

## Current Repo State

Known changed/untracked files at the time of handoff:

```text
 M docs/README.md
?? CONTEXT.md
?? docs/references/knowledge/agent-managed-knowledge-product.md
?? docs/references/knowledge/file-mode-podcast-acceptance.md
?? docs/references/knowledge/handoff-knowledge-base-product-2026-06-06.md
?? docs/references/knowledge/knowledge-ui-presentation-options.md
?? docs/references/knowledge/local-model-product.md
```

This is documentation-only work. `git diff --check` passed for the touched docs. `pnpm lint`, `pnpm test`, and `pnpm format` were not run.

`lark-cli` reported an available update while syncing the Feishu doc:

```text
current: 1.0.47
latest: 1.0.48
command: lark-cli update
```

## Open Work

- Decide whether to create ADRs for hard-to-reverse decisions such as folder-based default, visible processed Markdown, non-allowlist candidate knowledge ids, and the file-manager-style material browser.
- Start technical design for storage, provenance, watcher integration, indexes, migration, and Agent tools.
- Keep cloud/enterprise permissions in scope for technical design, but do not over-spec cloud details yet.
- Refine UI copy, list/grid density, detail overlay fields, and unavailable-refresh presentation without reopening the product semantics.
- Decide final URL snapshot naming and cloud provider folder naming/i18n behavior during UI/technical design.

## Suggested Skills

- `grill-with-docs`: Continue product-language refinement and update `CONTEXT.md` / PRD as decisions change.
- `improve-codebase-architecture`: Use when moving from PRD to technical architecture and implementation slices.
- `to-issues`: Convert the PRD into independently implementable engineering issues.
- `gh-create-issue`: Create GitHub issues from those implementation slices if needed.
- `gh-pr-review`: Review future implementation PRs against this product model and Cherry Studio conventions.

## Notes For Next Agent

- Treat `agent-managed-knowledge-product.md` as the current source of truth for product semantics.
- Treat the Feishu product doc as the user-facing product document mirror. Keep it aligned when major decisions change.
- Treat `CONTEXT.md` as glossary only. Do not put implementation plans, table designs, or detailed workflows there.
- The user prefers macro-to-detail grilling and one decision at a time when product details are still open.
- The user does not want a UI virtual table to decide the file tree. Watcher/fs list drives visible directory state.
- Do not resurrect earlier brainstormed hidden processed-Markdown or mandatory raw/processed tab schemes unless the user explicitly reopens that decision.
- Do not resurrect Cherry Studio note "source reference with automatic sync"; the latest decision is copied note snapshot with manual refresh.

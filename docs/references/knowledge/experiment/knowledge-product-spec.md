# Cherry Studio Knowledge Base — Product Spec

## 1. Positioning

**A knowledge base is a "searchable folder of materials that an agent can manage."** It moves away from "configure retrieval models first, then upload (RAG)" toward a material space where you "drop materials in, search works by default, and embedding / rerank / file processors make it stronger as you configure them". User-facing copy always says "knowledge base"; internal concepts like File Mode are never exposed.

## 2. Product principles (four)

1. **Low creation barrier** — a name is enough to create a base; no vector/RAG knowledge required. ("Full-text search without embedding configured" is the target state; current v2 still requires an embedding model.)
2. **Import means copy** — uploading creates the base's own stable copy/snapshot; later changes to the external source never rewrite the base's content automatically.
3. **The real directory is the user-visible truth** — the UI reflects the real folder; no virtual directory table. Index/chunk/cache system assets never appear among the materials.
4. **The agent is a helper, not unbounded automation** — low-risk tidying executes then reports; refresh-overwrite, delete, and overwriting existing files require confirmation.

## 3. Material behavior at a glance

| Material | Core rules |
| --- | --- |
| Local file / folder | Copied into the base, name kept, hierarchy kept; deleting the in-base copy never deletes the original; external deletion of the original → UI removal + index cleanup, no second confirmation |
| URL | A **snapshot** (fetched as Markdown), not a live reference; refresh = re-fetch and overwrite (confirmation required) |
| Note | Copied as the base's own snapshot, default name from the source; no auto-sync, refresh-overwrite needs confirmation |
| PDF processor output | The generated Markdown is an **independent, visible file**; search indexes/returns the Markdown; deleting the PDF keeps the md |
| Agent-created material | Writing into the base directory makes an ordinary visible material — no hidden output pool; the user can edit freely |

Same-path conflicts offer three choices (overwrite / keep copy `_2` / skip) as the target state; duplicate content is not blocked (the agent tidies it later).

## 4. Agent capability boundaries

- **list** shows **all** knowledge bases visible to the current user; **search** must receive an explicit base id and is not limited to candidates; **read** takes the locator a search returned (never an arbitrary file path); **tree** is bounded by visibility; **manage** (add/delete/refresh) requires confirmation for destructive operations.
- **Candidate ids are hints, not a permission boundary** — agent binding / chat @-mention / detail-page entry only decide the candidates; a single user owns all of their local bases, candidates merely narrow this conversation's search scope, and once personal cloud sources (Feishu / WebDAV) are connected, readability of a given material is additionally bounded by that cloud account's own visibility.

## 5. Settled product decisions

| # | Rule |
| --- | --- |
| 1 | A name alone creates a base |
| 2 | User-facing name stays "knowledge base" |
| 3 | Internal objects are uniformly Knowledge Material |
| 4 | File-manager-style main view (list/grid, no fixed raw/processed tabs) |
| 5 | Uploads copy without renaming; folders keep their hierarchy |
| 6 | URLs are fetched as Markdown; refresh overwrites and updates the index |
| 7 | Cloud documents are stored as local snapshots with manual refresh (later capability) |
| 8 | PDF-generated Markdown is an independent visible file; search returns the Markdown; deleting the PDF keeps the md |
| 9 | Agent writes are immediately visible |
| 10 | Same-path conflicts offer three choices, copies use `_2`/`_3` suffixes (target state; currently reject-on-conflict) |
| 11 | Duplicate content is not blocked |
| 12 | External deletion → UI removal, index cleanup, no second confirmation |
| 13 | list shows all visible bases; search requires an id but is not candidate-limited; candidates ≠ permission boundary |
| 14 | Legacy base migration builds a new copy — no in-place conversion, no automatic rewrite of agent bindings; unprovable parts are skipped with diagnostics recorded, never guessed |

## 6. Hard-to-roll-back decisions

1. New knowledge bases default to the folder model; 2. the UI is driven by the real directory; 3. processor-output Markdown is a visible independent file; 4. candidate bases are not a search allowlist; 5. migration creates a new copy, not an in-place conversion.

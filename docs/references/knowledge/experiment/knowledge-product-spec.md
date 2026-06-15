# Cherry Studio Knowledge Base — Product Spec

## 1. Positioning

**A knowledge base is a "managed library of materials that an agent can manage."** It moves away from "configure retrieval models first, then upload (RAG)" toward a material space where you "drop materials in, search works by default, and embedding / rerank / file processors make it stronger as you configure them". It is a *managed* library: every material runs a tracked lifecycle (import → process → embed → fail / retry → delete) that the UI reflects from business state (`knowledge_item`), not from a live filesystem listing. User-facing copy always says "knowledge base"; internal concepts like File Mode are never exposed.

## 2. Product principles (four)

1. **Low creation barrier** — a name is enough to create a base; no vector/RAG knowledge required. ("Full-text search without embedding configured" is the target state; current v2 still requires an embedding model.)
2. **Import means copy** — uploading creates the base's own stable copy/snapshot; later changes to the external source never rewrite the base's content automatically.
3. **Business state is the user-visible truth** — the UI reflects each material's tracked lifecycle status from `knowledge_item`, never a live filesystem read; the per-base folder is internal, Cherry-managed byte storage the user never browses directly. Index/chunk/cache system assets never appear among the materials.
4. **The agent is a helper, not unbounded automation** — low-risk tidying executes then reports; refresh-overwrite, delete, and overwriting existing files require confirmation.

## 3. Material behavior at a glance

| Material | Core rules |
| --- | --- |
| Local file / folder | Copied into the base (one-shot copy), name kept, hierarchy kept; the imported original is **never tracked** afterward — its later edits or deletion never affect the base copy; deleting the in-base copy never touches the original |
| URL | A **snapshot** (fetched as Markdown), not a live reference; refresh = re-fetch and overwrite (confirmation required) |
| Note | Copied as the base's own snapshot, default name from the source; no auto-sync, refresh-overwrite needs confirmation |
| PDF processor output | The generated Markdown is an **independent, visible file**; search indexes/returns the Markdown; deleting the PDF keeps the md *(target state / v2.x — in current v2 the md is **not** a separate item, only the PDF item's `indexedRelativePath`; deleting the PDF item deletes both md and PDF)* |
| Agent-created material | Writing into the base directory makes an ordinary visible material — no hidden output pool; the user can edit freely |

Same-path conflicts offer three choices (overwrite / keep copy `_1` / skip); keep-copy auto-renames with a `_N` suffix and is **landed** (live upload + v1 migration), while overwrite / skip are still target state. Duplicate content is not blocked (the agent tidies it later).

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
| 8 | PDF-generated Markdown is an independent visible file; search returns the Markdown; deleting the PDF keeps the md *(target state / v2.x — current v2: md is not a separate item, deleting the PDF deletes both)* |
| 9 | Agent writes go through the create-material API (not a raw file drop into the folder), then are immediately visible |
| 10 | Same-path conflicts offer three choices, copies use `_1`/`_2` suffixes (keep-copy / auto-rename `_N` landed for both live upload and v1 migration; overwrite / skip still target state) |
| 11 | Duplicate content is not blocked |
| 12 | Imported originals are not tracked — their external edits/deletion never change the base; a base copy is removed only by an explicit in-app delete (`missing` is a lazy read-time flag, not a watcher signal) |
| 13 | list shows all visible bases; search requires an id but is not candidate-limited; candidates ≠ permission boundary |
| 14 | Legacy base migration builds a new copy — no in-place conversion, no automatic rewrite of agent bindings; unprovable parts are skipped with diagnostics recorded, never guessed |

## 6. Hard-to-roll-back decisions

1. New knowledge bases default to the folder-backed storage model; 2. the UI is driven by `knowledge_item` business state, not a live directory read; 3. processor-output Markdown is a visible independent file; 4. candidate bases are not a search allowlist; 5. migration creates a new copy, not an in-place conversion.

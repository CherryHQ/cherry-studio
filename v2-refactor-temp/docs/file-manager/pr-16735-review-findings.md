# PR #16735 — Review Findings Tracker

Tracks the `CHANGES_REQUESTED` review by **@0xfullex** (MEMBER) on
[PR #16735](https://github.com/CherryHQ/cherry-studio/pull/16735), submitted
2026-07-19 against HEAD `b8a72e08`. Each item below was independently verified
against the code at that HEAD before being classified. Findings are grouped by
kind (runtime bug / behavior judgment / cleanup / documentation), not by the
reviewer's original numbering; the original numbers are preserved in the **#**
column for cross-reference.

Legend — **Verdict**: `confirmed` (real defect), `judgment` (behavior change
that needs a product decision), `doc` (documentation accuracy). **Status**:
`open` / `resolved` / `accepted` (deliberately kept as-is, with rationale).

---

## Root cause shared by #1 and #3

The `file.get_metadata` route was designed with a "missing / unreadable → `null`"
contract. That contract has a hole: the handler's `try/catch → null` only
absorbs **`fs` errors**. Input that fails `AbsolutePathSchema` at the IpcApi
boundary is **rejected (the request promise throws)** — it never reaches the
handler, so it never becomes `null`. The legacy `window.api.file.isDirectory`
was a bare `ipcMain.handle` with no such schema, so callers that assumed "any
problem resolves to a falsy/`null` result" held under v1 but not after the
migration.

Two concrete regressions fall out of this:

- **#1** — relative paths that are not resolved against a workspace root reach
  the route and get rejected → the caller throws instead of resolving `false`.
- **#3** — `fileUrlToPath` emits forward-slash Windows paths (`C:/…`) that
  `AbsolutePathSchema` rejects (it requires backslash `C:\…`) → the request
  throws, the drop falls through to plain text.

Both are closed by (a) making callers robust (catch → `null`/`false`, matching
the documented contract) **and** (b) reconciling the Windows path form so a
*valid* path is not wrongly rejected in the first place. (b) is the same
absolute-path-type unification tracked as §7 / task #8.

---

## Runtime bugs (confirmed)

### #1 — Relative Agent tool paths no longer open
- **Verdict**: confirmed · **Status**: open
- **Where**: `src/renderer/pages/agents/messages/agentMessageListAdapter.ts:191-200`
  (the `isDirectory` action), consumed by
  `src/renderer/components/chat/messages/tools/shared/ClickableFilePath.tsx:79-88`.
- **Detail**: `ClickableFilePath` documents the contract explicitly (lines 71-74):
  "`isDirectory` is fs.stat-backed and resolves `false` on a missing path, so a
  vanished file still falls through to the preview pane." The adapter's
  `isDirectory` violates it: when `AbsolutePathSchema` rejects a still-relative
  path (workspace root not applied), `ipcApi.request` **throws**, so
  `handleOpen`'s catch fires and surfaces an error toast — the file never
  reaches `openArtifactFile`. `useFileDragDrop` and `useIsTextFile` already wrap
  the probe in a catch; this adapter is the one that does not.
- **Planned fix**: wrap the adapter's `isDirectory` probe in a catch → `false`
  (restore the documented contract). Thread `workspacePath` into the tool-flow
  provider so relative tool output resolves to an absolute path instead of only
  "not erroring". Add a relative-path tool-flow regression test.

### #3 — Windows `file://` URL drops regress to plain text
- **Verdict**: confirmed · **Status**: open
- **Where**: `src/renderer/components/composer/paste/useFileDragDrop.ts:55-62`;
  path contract in `src/shared/data/types/file.ts:180-184` (`AbsolutePathSchema`)
  vs. `src/shared/utils/file/url.ts:198-208` (`fileUrlToPath`).
- **Detail**: `fileUrlToPath('file:///C:/a/b.pdf')` returns `C:/a/b.pdf`
  (forward slashes, by design — see the docstring example). `AbsolutePathSchema`
  accepts a Windows path only in backslash form (`/^[A-Za-z]:\\/`). So a dropped
  `file:///C:/…` value is rejected at the IPC boundary, the probe throws, and the
  drop falls through to `onTextDropped` instead of attaching the file.
- **Planned fix**: normalize the path form before handle construction (e.g.
  through `canonicalizeAbsolutePath`) or reconcile the shared path contract so
  forward-slash Windows paths are valid. Add a Windows `file://` URL regression
  test. Ties into §7 / task #8 (unify the branded absolute-path type).

### #8 — `isTextByContent` leaks a file descriptor on read failure
- **Verdict**: confirmed · **Status**: open
- **Where**: `src/main/utils/file/metadata.ts:34-37`.
- **Detail**: the handle is opened, then closed only after a successful
  `fileHandle.read(...)`. If `read` throws, the outer `catch` returns `false`
  without closing the handle → descriptor leak. This is v2 code introduced by
  this migration (the `File_IsTextFile` fold), so it is in scope to fix.
- **Planned fix**: close the handle in a `finally` block.

---

## Behavior judgment (decided → accepted)

### #2 — `File_IsTextFile` migration changes text-detection semantics
- **Verdict**: judgment · **Status**: resolved (behavior change accepted + documented + tested)
- **Where**: `src/renderer/hooks/useIsTextFile.ts:48-49` consumes
  `meta.type === 'text'`; `type` is derived by
  `src/main/utils/file/metadata.ts` (`getFileType`, extension-first).
- **Detail**: verified against git history — the legacy `_isTextFile`
  (`FileStorage.ts:1028`) **always content-sniffed** (`isBinaryFile` + `chardet`),
  ignoring the extension. The new path is extension-first and only sniffs when
  the extension maps to `FILE_TYPE.OTHER`. Consequences:
  - binary content named `.txt` → old: binary; new: text
  - text content with a recognized non-text extension (e.g. `.png`) → old: text;
    new: not text
- **Blast-radius analysis** (why the change is safe): the classification flows
  to exactly two gates. (1) The attach/translate gate
  (`renderer/utils/file.ts` `isSupportedFile`) checks its **extension allowlist
  first**, so `meta.type` is only a fallback for allowlist-miss extensions —
  and those mostly map to `OTHER`, where `getFileType` *still* sniffs. The
  costly "binary read as text into an LLM" case is therefore **not a
  regression**: a binary `.txt` short-circuits on the allowlist under both old
  and new. (2) The artifact preview gate (`useIsTextFile` → `ArtifactPane`) is
  visual-only and 2 MiB size-capped. The only true behavior delta is the
  pathological "text content under a recognized non-text extension", which loses
  text classification but is still handled correctly by its extension's type.
- **Resolution**: extension-first is the *more correct* semantics for a
  preview/attach gate (a text-bearing `.png` should still be treated as an
  image), so the change is **deliberately accepted** rather than reverting to an
  always-sniff probe (which would re-introduce a content read on every file).
  Locked in by:
  - an extension-first **contract docstring** on `getFileType`
    (`src/main/utils/file/metadata.ts`) that spells out the mismatch edge cases,
    plus a cross-reference note on `useIsTextFile`;
  - two **mismatch tests** in `src/main/utils/file/__tests__/metadata.test.ts`
    (recognized text ext + binary bytes → `text`; recognized non-text ext + text
    bytes → the ext's type).
  - No runtime guard added: the "read cost" concern is orthogonal and pre-existing
    (depends on whether the attach read path is size-bound), out of scope here.

---

## Cleanup (valid, low effort)

### #6 — New user-visible metadata errors bypass i18n
- **Verdict**: confirmed · **Status**: open
- **Where**: `HtmlFilePreview.tsx:141`, `MarkdownFilePreview.tsx:134`,
  `TextFilePreview.tsx:116` (and the sibling PDF/Word/PowerPoint plugins that
  share the pattern) — `throw new Error('Failed to read file metadata: ' + path)`
  is rendered through `description={error.message}`.
- **Planned fix**: render an existing localized load-error description (each
  plugin already has a localized `*.read_error.title`); keep the detailed path
  in the log line only.

### #9 — FilePreview tests retain deleted legacy preload APIs
- **Verdict**: confirmed · **Status**: open
- **Where**: the FilePreview plugin test files touched by this migration still
  install `window.api.file.getMetadata` (and, in the text test, `isTextFile`),
  even though production now calls `@renderer/ipc`.
- **Planned fix**: remove the v1 preload residue (opportunistic removal — these
  files are already being edited) and drive metadata behavior only through the
  IpcApi mock, including a `null`-result assertion.

---

## Documentation

These concern the working audit docs under `v2-refactor-temp/docs/file-manager/`.
Maintainer decision: **update the headline inaccuracies** (not a full re-audit —
these are throwaway working docs) and keep them in Chinese.

### #4 — `legacy-file-ipc-audit.md` counts are stale for this HEAD
- **Verdict**: doc · **Status**: resolved
- **Detail**: reported 11 IpcApi file routes / 6 FileManager legacy handlers / 30
  Group B handlers / 36 total legacy channels; HEAD (verified) has **12 / 5 / 27
  / 32**. `Open_Path` has moved to `system.shell.open_path`, and cited preload
  paths named `src/preload/index.ts` (the file is `src/preload/preload.ts`).
- **Resolution**: corrected the §1 summary counts (12 / 5 / 27 / 32) and the
  `src/preload/index.ts` → `src/preload/preload.ts` filename references, and
  added a dated "point-in-time snapshot" note to the header stating that summary
  counts are refreshed to HEAD but inline `file:line` numbers may have drifted
  after the `origin/main` merge. Per-line-number chasing was deliberately not
  done (disproportionate for a throwaway working doc; the header note scopes it).

### #5 — Audit documents contradict themselves post-C-1
- **Verdict**: doc · **Status**: resolved
- **Detail**: `filestorage-consumption-audit.md` said `file.get_metadata` still
  needs to be added while a later C-1 block said it was already implemented;
  `filemetadata-consumer-audit.md:657` claimed `@main/utils/file`'s `stat`
  returns `{ kind, ... }` while it actually returns
  `{ size, createdAt, modifiedAt, isDirectory }`.
- **Resolution**: reconciled the `getMetadata` status row / route count in
  `filestorage-consumption-audit.md` to the post-C-1 state (single route added),
  and corrected the `stat` shape claim in `filemetadata-consumer-audit.md:657`
  to `{ isDirectory, ... }` with a note that `isDirectory` must be projected to
  `kind`. (The AgentComposer block at :660 already reflects the nullable /
  no-error-code decision accurately, so it was left as-is.)

### #10 — New audit docs are written in Chinese
- **Verdict**: doc · **Status**: accepted (kept in Chinese)
- **Detail**: the audit documents are in Chinese; the reviewer cited an
  English-only documentation rule.
- **Resolution**: **kept in Chinese by maintainer decision.** These are
  throwaway `v2-refactor-temp/` working documents that the maintainer reads
  directly; the English-only rule targets durable `docs/` references, not this
  scratch tier. (This tracker itself is written in English as it is the
  review-facing artifact.)

---

## Resolved

### #7 — Deprecated `getMetadata` contract is non-nullable
- **Verdict**: confirmed · **Status**: resolved
- **Where**: `src/shared/types/file/ipc.ts:361` declares
  `getMetadata(handle): Promise<PhysicalFileMetadata>` while the live schema and
  handler return `PhysicalFileMetadata | null`.
- **Resolution**: this whole file is already `@deprecated` and slated for
  deletion once the File IPC migration completes. Rather than chase per-method
  signature parity with the live IpcApi schemas, the file header now states
  explicitly that individual method contracts here may have drifted and that
  `src/shared/ipc/schemas/file.ts` + the handlers are authoritative for any
  migrated route. Per-method signatures are intentionally not kept in lockstep.

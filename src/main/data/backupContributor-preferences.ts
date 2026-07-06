// PREFERENCES backup contributor — owns `preference` + `note`.
//
// Co-located in the preference owning module (PreferenceService lives in
// src/main/data/) per backup-architecture §7 placement. Both aggregates are
// settings-class: conflictDefault is SKIP (local-first + fill-missing), the
// documented exception to invariant #21 (natural-key aggregates default to
// FIELD_MERGE). `note` stores only a state overlay (isStarred/isExpanded) keyed
// by (rootPath, path) into the Notes markdown files — NOT note body text, which
// is a file resource.
//
// preference.value is arbitrary JSON with NO entity-id soft-references;
// jsonSoftReferences is [] and the coverage test guards against future drift.
//
// Preset: full + lite.

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

// Module-level logger — the context intentionally carries no logger; contributors
// own their own via loggerService.withContext('backup/<domain>').
const logger = loggerService.withContext('backup/PREFERENCES')

/**
 * PREFERENCES domain. preference is keyed by composite [scope, key]; note by the
 * UNIQUE (rootPath, path) overlay key. Both are natural-key SKIP (settings
 * exception, #21): restore keeps local values and only fills missing keys.
 */
export const PREFERENCES_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'PREFERENCES',
  schema: {
    tables: [table('preference'), table('note')],
    references: [],
    primaryKeys: [mirrorPk('preference'), mirrorPk('note')],
    aggregates: [
      {
        root: table('preference'),
        identityKey: columns(['scope', 'key']),
        identityClass: 'natural-key',
        conflictDefault: 'SKIP',
        members: [],
        renamable: false
      },
      {
        root: table('note'),
        identityKey: columns(['rootPath', 'path']),
        identityClass: 'natural-key',
        conflictDefault: 'SKIP',
        members: [],
        renamable: false
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: [],
    // preference.value is the entire preference key-value store payload — arbitrary
    // JSON with NO embedded entity-id/fileId soft refs (it is a settings bag, not a
    // reference carrier). Declared so finalize #12 exhaustiveness passes. (note has
    // no JSON columns.)
    exemptJsonCols: [
      { table: table('preference'), column: column('value'), reason: 'no soft refs — holds the preference key-value store payload (arbitrary settings JSON), not entity references' }
    ]
  },
  backupPolicy: {
    // PREFERENCES-only: key patterns EXCLUDED at restore so a backup from another
    // OS/machine does not import foreign keybindings or absolute paths. Starter
    // set; the full list is curated by the
    // PREFERENCES owner. Matching semantics are finalized with the D restore track.
    platformSpecificKeys: [
      'shortcut.*', // keybindings — key codes differ per OS (Cmd vs Ctrl)
      '*.path' // filesystem paths — machine-specific absolute paths
    ]
  },
  // TODO(D track): note-overlay selected-resource filtering (codex review P2) —
  // `note` rows are state overlays keyed by (rootPath, path) into Notes markdown
  // files. In lite mode (files excluded) the restore MUST filter note rows whose
  // markdown is not in the backup, else it imports starred/expanded state for
  // non-existent notes. The Notes markdown body itself is a file resource (full
  // mode only). Cache refresh is NOT needed under the D model (#16714): relaunch
  // after preboot promotion fresh-loads PreferenceService.onInit.
  operations: {
    // PREFERENCES owns Notes markdown bodies as a file resource: the `note` table
    // stores only state overlays (starred/expanded), while the markdown bodies live
    // as `.md` files under the user-visible Notes root. BackupService resolves that
    // root from the feature.notes.path preference (falling back to the managed
    // feature.notes.data) and injects it via the context. This hook scans it
    // recursively and returns relative POSIX paths so the stager + archive carry the
    // bodies (full mode). A missing root = "no notes configured" (empty set); an
    // unreadable root (permission) throws — never a silent empty backup.
    // restoreResources (dir-swap preboot promotion) is the D restore track (#16714).
    collectFileResources: collectNotesMarkdown
  }
})

/**
 * Recursively scan the Notes markdown root and return every note file as a relative
 * POSIX path (e.g. `'note1.md'`, `'sub/note2.md'`). The orchestrator + FileStager
 * consume these as the notes file-resource set (full preset only — lite excludes
 * file resources, and PREFERENCES' note-overlay filtering belongs to the D restore
 * track, not here).
 *
 * Extension matching is case-insensitive (`.md`, `.MD`, `.Md`) to match the Notes
 * UI, which treats them the same (toLowerCase().endsWith in NotesService.ts) — a
 * case-sensitive check here would silently drop uppercase-ext notes.
 *
 * Root vs subtree read errors are handled differently:
 *  - Root: ENOENT = "no Notes configured" → empty set; any other error (EACCES,
 *    EPERM, …) → throw so the export fails loudly instead of archiving zero notes.
 *  - Subtree: skip + warn (permission / removed mid-scan); the stager re-reports a
 *    collected path under a skipped subtree as missing at stage time.
 *
 * Relative-POSIX normalization keeps the manifest portable across OSes: a Windows
 * user's `sub\note.md` becomes `sub/note.md` so restore resolves the same path.
 * Returns an empty set when notesRoot is undefined (unit tests / Notes unwired).
 */
async function collectNotesMarkdown(ctx: FileResourceContext): Promise<Set<string>> {
  // notesRoot is optional — undefined means "no Notes root on this host / test".
  if (!ctx.notesRoot) return new Set<string>()
  const root = ctx.notesRoot
  const out = new Set<string>()

  // Process one directory level: push subdirs onto the DFS stack, add matching
  // note files to `out` as notesRoot-relative POSIX paths.
  const processLevel = (dir: string, entries: readonly Dirent[]): string[] => {
    const subdirs: string[] = []
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        subdirs.push(full)
      } else if (e.isFile() && extname(e.name).toLowerCase() === '.md') {
        // Case-insensitive .md — Notes UI treats README.MD == note.md.
        out.add(relative(root, full).split(sep).join('/'))
      }
    }
    return subdirs
  }

  // Root read is separate from subtree reads: a missing root is a legitimate
  // "no notes configured" state (empty set), but an unreadable root must NOT
  // silently produce an empty backup — throw so the export fails loudly.
  let stack: string[]
  try {
    stack = processLevel(root, await readdir(root, { withFileTypes: true }))
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      logger.warn('PREFERENCES collectFileResources: notes root does not exist (no notes configured)', {
        notesRoot: root
      })
      return out
    }
    throw new Error(
      `PREFERENCES collectFileResources: cannot read notes root (${code ?? 'unknown'}): ${root}`
    )
  }

  // Iterative DFS over the remaining tree. Symlinks are not followed (readdir +
  // isDirectory matches the stager's own directory check, so a symlinked dir would
  // be reported missing at stage time rather than duplicated here).
  while (stack.length > 0) {
    const dir = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (e) {
      // Unreadable subtree (permission / removed mid-scan) — skip + warn; the
      // stager re-reports any collected path under it as missing at stage time.
      logger.warn('PREFERENCES collectFileResources: unreadable subtree skipped', {
        dir,
        code: (e as NodeJS.ErrnoException).code
      })
      continue
    }
    for (const sub of processLevel(dir, entries)) stack.push(sub)
  }

  logger.info('PREFERENCES collectFileResources: collected notes markdown files', {
    count: out.size
  })
  return out
}

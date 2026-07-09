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

import type { BackupContributor } from '@main/data/db/backup/contributor-types'
import { columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

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
    jsonSoftReferences: []
  },
  backupPolicy: {
    // PREFERENCES-only: key patterns EXCLUDED at restore so a backup from another
    // OS/machine does not import foreign keybindings or absolute paths. Starter
    // set; the full list is curated by the
    // PREFERENCES owner. Matching semantics are finalized with the D restore track.
    platformSpecificKeys: [
      'shortcut.', // keybindings — key codes differ per OS (Cmd vs Ctrl)
      '.path', // filesystem paths — machine-specific absolute paths
      'app.hardware_acceleration' // GPU/driver-specific, not portable
    ]
  },
  // TODO(D track): two restore requirements for PREFERENCES (neither is a finalize
  // concern; both wire when the D restore track lands):
  //  1. Cache refresh — after commit, call PreferenceService.reloadFromDb() +
  //     rebroadcast so the main + renderer preference caches reflect restored values
  //     (M1; without it restore silently no-ops until restart). Blocked on the upstream
  //     reloadFromDb API (upstream, tracked separately).
  //  2. note-overlay selected-resource filtering (codex review P2) — `note` rows are
  //     state overlays keyed by (rootPath, path) into Notes markdown files. In lite
  //     mode (files excluded) the restore MUST filter note rows whose markdown is not
  //     in the backup, else it imports starred/expanded state for non-existent notes
  //     (selected-resource consistency in lite mode). The Notes markdown
  //     body itself is a file resource (full mode only).
  operations: undefined
})

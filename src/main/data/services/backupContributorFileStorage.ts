// FILE_STORAGE backup contributor — owns the `file_entry` table (uuid-v7 PK).
//
// Co-located in the file owning module (FileEntryService lives in this flat
// data-services dir) per backup-architecture §7 placement. Schema-only at the
// declaration level: file_entry has no FKs and no business UNIQUE key. (It does
// carry a `lower(externalPath)` expression unique index, but expression indexes
// can't be codegen-reflected — and file_entry is uuid-entity, so finalize #13
// exempts it from unique-backing anyway.)
//
// Post-#16532 the old polymorphic `file_ref` table was split into
// `chat_message_file_ref` (→ TOPICS, by sourceId→message) and `painting_file_ref`
// (→ PAINTINGS, by sourceId→painting). Those junctions belong to their SOURCE
// domains, NOT FILE_STORAGE — so this contributor owns file_entry only.
//
// The file BLOB itself (externalPath/size) is a file resource. Restore staging
// restores it below backupRoot before its owning DB row is imported.
//
// Preset: full only (lite-excluded — files are large blobs).

import fs from 'node:fs'
import path from 'node:path'

import type { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import type {
  BackupContributor,
  RestoreResourceContext,
  RestoreResourceResult
} from '@main/data/db/backup/contributorTypes'
import { columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'
import { sealRestoreResourceFromPath } from '@main/data/db/backup/restoreResourceSeal'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { isNull } from 'drizzle-orm'

/**
 * Collect ids of non-soft-deleted file_entry rows — the export blob set. Both
 * internal (origin='internal', stored under feature.files.data) and external
 * (origin='external', absolute externalPath) entries are returned; staging
 * (ExportOrchestrator step 4) resolves each source path and skips any that are
 * missing/unreadable rather than failing the whole export.
 */
export async function collectFileEntryIds(liveDb: BackupReadonlyDb): Promise<Set<string>> {
  const rows = await liveDb.select().from(fileEntryTable).where(isNull(fileEntryTable.deletedAt))
  return new Set(rows.map((r) => r.id))
}

/** Stage selected archive blobs below backupRoot without ever writing a live path. */
export async function restoreFileResources(ctx: RestoreResourceContext): Promise<RestoreResourceResult> {
  const restoredFileIds = new Set<string>()
  const skippedFileIds = new Set<string>()

  for (const id of ctx.filesAffected) {
    const payloadPath = safePayloadPath(ctx.archiveRoot, id)
    if (!payloadPath) {
      skippedFileIds.add(id)
      continue
    }
    const stagedPath = path.join(ctx.backupRoot, 'files', id)
    sealRestoreResourceFromPath(ctx.backupRoot, stagedPath, payloadPath)
    restoredFileIds.add(id)
  }

  return { restoredFileIds, skippedFileIds }
}

/** Resolve an archive payload only when its flat id remains inside files/ after realpath. */
export function safePayloadPath(archiveRoot: string, id: string): string | undefined {
  if (!isSafeFileId(id)) return undefined
  const filesRoot = path.resolve(archiveRoot, 'files')
  const candidate = path.resolve(filesRoot, id)
  if (!isContained(filesRoot, candidate) || !fs.existsSync(candidate)) return undefined
  try {
    const realRoot = fs.realpathSync(filesRoot)
    const realCandidate = fs.realpathSync(candidate)
    if (!isContained(realRoot, realCandidate) || !fs.statSync(realCandidate).isFile()) return undefined
    return realCandidate
  } catch {
    return undefined
  }
}

/** Archive file resource identifiers are flat filenames, never paths. */
function isSafeFileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id)
}

/** Check lexical or resolved path containment without prefix collisions. */
function isContained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`)
}

/**
 * FILE_STORAGE domain: user file entries. Single table, uuid-v7 PK, no FKs, no
 * cross-domain references. conflictDefault derives to SKIP (uuid-entity → SKIP, §6.2).
 */
export const FILE_STORAGE_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'FILE_STORAGE',
  schema: {
    tables: [table('file_entry')],
    references: [],
    primaryKeys: [mirrorPk('file_entry')],
    aggregates: [{ root: table('file_entry'), identityKey: columns(['id']), members: [], renamable: false }],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: {},
  operations: {
    // Export blob set = non-deleted file_entry ids (internal + external). Staging
    // resolves each id to its source path and copies the blob into files/<id>;
    // a missing external source is skipped, not fatal.
    collectFileResources: (ctx) => collectFileEntryIds(ctx.liveDb),
    // Resources are written only into the per-restore staging subtree. The coordinator
    // validates manifest/live-target policy around the contributor's byte staging result.
    restoreResources: (ctx) => restoreFileResources(ctx),
    // An archived external path is not portable. The keyed staging metadata proves
    // a managed blob exists, so convert only that row into the internal invariant.
    transformRow: ({ row, fileEntryRewrites }) => {
      const rewrite = fileEntryRewrites.get(String(row.id))
      if (!rewrite) return row
      return {
        ...row,
        origin: rewrite.origin,
        external_path: rewrite.externalPath,
        size: rewrite.size
      }
    }
  }
})

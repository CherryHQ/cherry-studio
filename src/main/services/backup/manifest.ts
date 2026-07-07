// Backup archive manifest — the metadata header written as `manifest.json` at
// the root of every .cbu archive.
//
// Pure serialization module: writeManifest / readManifest + the BackupManifest
// type. No validation here — the restore-side manifest gate (backup-architecture
// §9 step 0) enforces backupFormatVersion / schemaMigrationId compatibility.
// Export-side just records what was exported.

import { readFile, writeFile } from 'node:fs/promises'

import { z } from 'zod'

import type { BackupDomain } from '@main/data/db/backup/domains'
import { deepFreeze } from '@main/data/db/backup/freeze'

import type { BackupPreset } from './presets'

/**
 * Archive format major version. v2 baseline = 1. A major bump marks an
 * incompatible format change (e.g. release-time migration-chain regeneration,
 * see backup-architecture.md §2) so old archives are rejected at the gate rather
 * than failing inside migrate-forward. Minor format additions stay on the same
 * major.
 */
export const BACKUP_FORMAT_VERSION = 1 as const

/**
 * The manifest payload. Field semantics + the 3-field compatibility gate
 * (backupFormatVersion ✅ / schemaMigrationId ✅ / producerAppVersion ❌) are
 * defined in export-orchestrator.md "manifest schema" + backup-architecture §2.
 */
export interface BackupManifest {
  /** Archive format major version (BACKUP_FORMAT_VERSION). */
  readonly backupFormatVersion: number
  /** ISO timestamp of the export moment. */
  readonly createdAt: string
  /** Preset the user selected. */
  readonly preset: BackupPreset
  /** Selected domains, topo-sorted by reference dependency. */
  readonly domains: readonly BackupDomain[]
  readonly includeFiles: boolean
  readonly includeKnowledgeFiles: boolean
  /** API-key / auth-config disposition (default: included, not rotated). */
  readonly sensitiveData: { readonly included: boolean; readonly rotated: false }
  /**
   * Producer's last applied migration `when` (folderMillis). The authoritative
   * schema version for the compatibility gate (migrate-forward / reject / direct
   * import). Filled by the orchestrator from the drizzle migration journal.
   */
  readonly schemaMigrationId: string
  /** Producer app version (package.json) — diagnostic only, NOT in the gate. */
  readonly producerAppVersion: string
  readonly files: {
    /**
     * Per-file staged ids (= collected file_entry ids − missing). Lets restore
     * cross-check backup.sqlite file_entry rows against the staged blob set, and
     * lets the orchestrator prune rows whose blob was missing at stage time.
     * See export-orchestrator.md "Staged blob set 驱动 manifest + DB 裁剪".
     */
    readonly ids: readonly string[]
    readonly total: number
    readonly totalBytes: number
  }
  readonly knowledge: { readonly bases: readonly string[] }
  /**
   * Staged Notes markdown relative paths (full mode; lite excludes file resources
   * → empty). Not DB-gated: missing notes don't prune any DB row (the `note` table
   * holds only overlays); the manifest lists only what was actually staged.
   */
  readonly notes: { readonly paths: readonly string[] }
}

/**
 * Runtime validation schema for untrusted manifest.json (the restore-side
 * archive boundary). Mirrors BackupManifest's shape; the restore gate
 * (backup-architecture §9 step 0) additionally checks version compatibility.
 * Established here even though the restore track is not yet landed, so the
 * export-side readManifest (used by manifest.test.ts) carries the contract
 * from day one and a corrupted/tampered manifest fails loud at parse rather
 * than as a confusing runtime error deep in restore.
 */
const manifestSchema = z.object({
  backupFormatVersion: z.number(),
  createdAt: z.string(),
  preset: z.enum(['full', 'lite']),
  domains: z.array(z.string()),
  includeFiles: z.boolean(),
  includeKnowledgeFiles: z.boolean(),
  sensitiveData: z.object({ included: z.boolean(), rotated: z.literal(false) }),
  schemaMigrationId: z.string(),
  producerAppVersion: z.string(),
  files: z.object({ ids: z.array(z.string()), total: z.number(), totalBytes: z.number() }),
  knowledge: z.object({ bases: z.array(z.string()) }),
  notes: z.object({ paths: z.array(z.string()) })
})

/** Serialize the manifest as UTF-8 JSON (2-space indent for readability). */
export async function writeManifest(path: string, manifest: BackupManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/** Read + parse a manifest, returning a deep-frozen value. */
export async function readManifest(path: string): Promise<BackupManifest> {
  const raw = await readFile(path, 'utf8')
  return deepFreeze(manifestSchema.parse(JSON.parse(raw)) as BackupManifest)
}

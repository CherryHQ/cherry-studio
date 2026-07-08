// Backup export presets — resolve 'full' | 'lite' to a domain set.
//
// Source of truth for the preset → domain-set mapping (backup-architecture.md §2 +
// export-orchestrator.md; domains.ts L14-17 documents the lite exclusion). The
// orchestrator further topo-sorts the result by reference dependency before
// invoking contributor hooks; this module only selects the domain subset.

import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'

/** User-facing export preset. Renderer passes this primitive; BackupService resolves it. */
export type BackupPreset = 'full' | 'lite'

/**
 * Domains excluded from the lite preset — large blobs / history that make the
 * archive big without being essential to "continue using the app elsewhere"
 * (domains.ts L14-17). Kept in lockstep with the BACKUP_DOMAINS tuple.
 */
export const LITE_EXCLUDED: readonly BackupDomain[] = ['KNOWLEDGE', 'PAINTINGS', 'FILE_STORAGE', 'TRANSLATE_HISTORY']

const LITE_EXCLUDED_SET: ReadonlySet<BackupDomain> = new Set(LITE_EXCLUDED)

/**
 * Resolve a preset to its backup domain set (order matches BACKUP_DOMAINS; the
 * orchestrator topo-sorts before running hooks).
 *
 * - full → all 14 domains
 * - lite → 10 domains (excludes the 4 in LITE_EXCLUDED)
 */
export function resolvePreset(preset: BackupPreset): readonly BackupDomain[] {
  // Return a fresh array so callers can freely mutate/sort without affecting the
  // shared BACKUP_DOMAINS tuple.
  if (preset === 'full') {
    return [...BACKUP_DOMAINS]
  }
  if (preset === 'lite') {
    return BACKUP_DOMAINS.filter((d) => !LITE_EXCLUDED_SET.has(d))
  }
  // Fail closed: the static type is 'full' | 'lite', but the IPC payload is
  // unvalidated at runtime (TODO(ipc-boundary) in BackupService). A typo MUST NOT
  // silently fall through to lite — that would resolve 10 domains yet skip the
  // step-2.5 strip (which matches on exactly 'lite'), leaking excluded-domain rows
  // into a lite-labelled archive.
  throw new Error(`resolvePreset: invalid preset '${preset}' (must be 'full' or 'lite')`)
}

/** Whether the preset includes file blobs (Data/Files) — full only. */
export const presetIncludesFiles = (preset: BackupPreset): boolean => preset === 'full'

/** Whether the preset includes knowledge-base folders ({baseId}/) — full only. */
export const presetIncludesKnowledge = (preset: BackupPreset): boolean => preset === 'full'

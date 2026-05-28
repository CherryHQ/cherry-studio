/**
 * Backup Domain & Manifest Types
 * V2 architecture: VACUUM INTO + selective restore
 *
 * Cross-process public contracts used for IPC between main and renderer.
 */

import * as z from 'zod'

/** Selectable backup data domains, each mapping to a set of SQLite tables or filesystem artifacts. */
export const BackupDomain = {
  TOPICS: 'topics',
  KNOWLEDGE: 'knowledge',
  PREFERENCES: 'preferences',
  MCP_SERVERS: 'mcp_servers',
  TAGS_GROUPS: 'tags_groups',
  FILE_STORAGE: 'file_storage',
  TRANSLATE_HISTORY: 'translate_history',
  PROMPTS: 'prompts',
  ASSISTANTS: 'assistants',
  PROVIDERS: 'providers',
  AGENTS: 'agents',
  SKILLS: 'skills',
  MINIAPPS: 'miniapps'
} as const

export type BackupDomain = (typeof BackupDomain)[keyof typeof BackupDomain]

/** Runtime schema for selectable backup domains used across IPC boundaries. */
export const BackupDomainSchema = z.enum(Object.values(BackupDomain) as [BackupDomain, ...BackupDomain[]])

export const BACKUP_MANIFEST_VERSION = 6 as const

/** Backup mode: full copies the entire database, selective copies only chosen domains. */
export const BackupModeSchema = z.enum(['full', 'selective'])
export type BackupMode = z.infer<typeof BackupModeSchema>

/** Warning about FK degradation caused by selective backup omitting referenced domains. */
export interface SelectiveBackupWarning {
  table: string
  column: string
  referencedDomain: string
  action: 'SET_NULL' | 'DELETE_ROW'
}

/** Runtime schema for FK degradation warnings emitted by selective backups. */
export const SelectiveBackupWarningSchema = z.strictObject({
  table: z.string().min(1),
  column: z.string().min(1),
  referencedDomain: z.string().min(1),
  action: z.enum(['SET_NULL', 'DELETE_ROW'])
})

/** Marker that the backup archive includes opt-in sensitive credentials. */
export interface SensitiveDataInfo {
  included: boolean
}

/** Runtime schema indicating whether the archive contains sensitive data. */
export const SensitiveDataInfoSchema = z.strictObject({
  included: z.boolean()
})

/** Runtime schema for per-domain export statistics. */
export const DomainStatsSchema = z.strictObject({
  itemCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative()
})

export type DomainStats = z.infer<typeof DomainStatsSchema>

/**
 * Backup manifest embedded in every backup archive.
 * Contains metadata, domain list, statistics, and integrity data.
 */
export interface BackupManifest {
  version: number
  mode: BackupMode
  appVersion: string
  platform: string
  arch: string
  createdAt: string
  schemaVersion: {
    hash: string
    createdAt: number
  }
  domains: BackupDomain[]
  domainStats: Record<string, DomainStats>
  checksums: Record<string, string>
  sourceDevice: {
    hostname: string
    os: string
  }
  selectiveBackupWarnings?: SelectiveBackupWarning[]
  sensitiveData?: SensitiveDataInfo
}

/** Runtime schema for backup manifests. Compatibility policy stays in validateBackupManifest(). */
export const BackupManifestSchema = z.strictObject({
  version: z.number().finite(),
  mode: BackupModeSchema,
  appVersion: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  createdAt: z.iso.datetime(),
  schemaVersion: z.strictObject({
    hash: z.string(),
    createdAt: z.number().int().nonnegative()
  }),
  domains: z.array(BackupDomainSchema),
  domainStats: z.record(z.string(), DomainStatsSchema),
  checksums: z.record(z.string(), z.string()),
  sourceDevice: z.strictObject({
    hostname: z.string().min(1),
    os: z.string().min(1)
  }),
  selectiveBackupWarnings: z.array(SelectiveBackupWarningSchema).optional(),
  sensitiveData: SensitiveDataInfoSchema.optional()
})

export type BackupManifestParsed = z.infer<typeof BackupManifestSchema>

/** Runtime schema for archived file metadata entries. */
export const BackupFileEntrySchema = z.strictObject({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  hash: z.string().min(1),
  mtime: z.iso.datetime(),
  mimeType: z.string().min(1).optional()
})

export type BackupFileEntry = z.infer<typeof BackupFileEntrySchema>

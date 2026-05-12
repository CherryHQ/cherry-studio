/**
 * Backup Domain & Manifest Types
 * V2 architecture: VACUUM INTO + selective restore
 */

export enum BackupDomain {
  TOPICS = 'topics',
  KNOWLEDGE = 'knowledge',
  PREFERENCES = 'preferences',
  MCP_SERVERS = 'mcp_servers',
  TAGS_GROUPS = 'tags_groups',
  FILE_STORAGE = 'file_storage',
  TRANSLATE_HISTORY = 'translate_history',
  // Phase 2 (blocked by pending PRs)
  ASSISTANTS = 'assistants',
  PROVIDERS = 'providers',
  AGENTS = 'agents',
  SKILLS = 'skills',
  MINIAPPS = 'miniapps'
}

export const BACKUP_MANIFEST_VERSION = 6 as const

export type BackupMode = 'full' | 'selective'

export interface BackupManifest {
  version: typeof BACKUP_MANIFEST_VERSION
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
}

export interface DomainStats {
  itemCount: number
  sizeBytes: number
}

export interface BackupFileEntry {
  path: string
  size: number
  hash: string
  mtime: string
  mimeType?: string
}

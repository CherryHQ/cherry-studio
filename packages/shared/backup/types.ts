/**
 * Backup Domain Types
 * Defines the domains that can be backed up/restored
 */
export enum BackupDomain {
  PROVIDERS = 'providers',
  ASSISTANTS = 'assistants',
  TOPICS = 'topics',
  PREFERENCES = 'preferences',
  KNOWLEDGE = 'knowledge',
  PLUGINS = 'plugins',
  AGENTS = 'agents'
}

/**
 * Supported backup manifest version
 */
export const BACKUP_MANIFEST_VERSION = '1.0.0' as const

/**
 * Backup manifest metadata
 */
export interface BackupManifest {
  /** Manifest version for forward compatibility */
  version: typeof BACKUP_MANIFEST_VERSION
  /** Backup creation timestamp (ISO 8601) */
  createdAt: string
  /** Source application version */
  appVersion: string
  /** Source platform (darwin, win32, linux) */
  platform: string
  /** Backup domains included */
  domains: BackupDomain[]
  /** Domain-specific statistics */
  domainStats: Record<BackupDomain, DomainStats>
  /** Encryption information (if encrypted) */
  encryption?: EncryptionInfo
  /** Incremental backup chain info */
  incremental?: IncrementalManifest
  /** Checksum of the manifest itself */
  checksum: string
}

/**
 * Statistics for a backup domain
 */
export interface DomainStats {
  /** Number of items in this domain */
  itemCount: number
  /** Total size in bytes (raw data) */
  rawSize: number
  /** Total size in bytes (compressed/archived) */
  archivedSize: number
  /** SHA-256 hash of the domain data */
  checksum: string
}

/**
 * Encryption metadata for encrypted backups
 */
export interface EncryptionInfo {
  /** Encryption algorithm used */
  algorithm: 'AES-256-GCM'
  /** Key derivation function */
  kdf: 'scrypt'
  /** Scrypt cost parameter (N) */
  n: number
  /** Scrypt block size parameter (r) */
  r: number
  /** Scrypt parallelization parameter (p) */
  p: number
  /** Salt used for key derivation (base64 encoded) */
  salt: string
  /** Initialization vector (base64 encoded) */
  iv: string
  /** Authentication tag length in bytes */
  tagLength: number
}

/**
 * Incremental backup manifest
 */
export interface IncrementalManifest {
  /** Chain ID that links all incremental backups */
  chainId: string
  /** Sequence number in the chain (0 = full backup) */
  sequence: number
  /** Parent backup manifest checksum (empty for full backup) */
  parentChecksum: string
  /** Changes included in this incremental backup */
  changes: IncrementalChange[]
  /** Timestamp when this incremental backup was created */
  createdAt: string
}

/**
 * Individual change in an incremental backup
 */
export interface IncrementalChange {
  /** Domain of the change */
  domain: BackupDomain
  /** Type of operation */
  type: 'create' | 'update' | 'delete'
  /** Primary key of the affected record */
  primaryKey: string
  /** Timestamp of the change */
  timestamp: string
}

/**
 * Backup file entry for tracking files within archives
 */
export interface BackupFileEntry {
  /** Relative path within the backup archive */
  path: string
  /** Original file size in bytes */
  size: number
  /** SHA-256 hash of file content */
  hash: string
  /** Modification time of original file */
  mtime: string
  /** MIME type of the file */
  mimeType?: string
}

/**
 * Domain-specific metadata
 */
export interface DomainMetadata {
  /** Domain this metadata belongs to */
  domain: BackupDomain
  /** Schema version for this domain */
  schemaVersion: string
  /** Additional domain-specific data */
  [key: string]: unknown
}

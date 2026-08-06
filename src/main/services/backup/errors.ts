/**
 * Backup errors thrown by the export/producer pipeline (Phase 1b-i) and the
 * archive admission pipeline (Phase 1b-ii). No merge / domain / contributor
 * error concepts are ported from #17206.
 */

/**
 * Preflight found insufficient free space (declared work + headroom) on a
 * volume the export must write. Raised BEFORE any copy/archive work so a
 * disk-full surfaces as a clear error, not a mid-stream `ENOSPC`.
 */
export class InsufficientDiskSpaceError extends Error {
  readonly needed: number
  readonly available: number
  readonly path: string
  constructor({ needed, available, path }: { needed: number; available: number; path: string }) {
    super(`insufficient disk space at ${path}: need ~${needed} bytes (incl. headroom), available ${available} bytes`)
    this.name = 'InsufficientDiskSpaceError'
    this.needed = needed
    this.available = available
    this.path = path
  }
}

/**
 * Thrown when a backup operation is requested while another one holds the
 * service. Serializing them is not politeness: export and restore preparation
 * share one staging root, so a concurrent pair would clean up each other's
 * files.
 */
export class BackupBusyError extends Error {
  readonly running: string
  readonly requested: string
  constructor(running: string, requested: string) {
    super(`a backup operation is already running (${running}); cannot start ${requested}`)
    this.name = 'BackupBusyError'
    this.running = running
    this.requested = requested
  }
}

/**
 * The restore lifecycle refused an action because the durable journal is not in
 * the state that action needs (§6.1) — or cannot be read at all.
 *
 * Structural rather than message-matched: the IPC layer has to turn these into
 * stable codes the restore UI branches on, and a journal state is exactly the
 * kind of fact that must not travel as prose.
 */
export type RestoreStateErrorCode =
  /** No journal, or one whose state this action does not accept. */
  | 'wrong-state'
  /** The journal exists but no version can parse it; preboot preserves it and refuses unsafe startup. */
  | 'unreadable'
  /** Arming succeeded but the relaunch it exists for could not be started. */
  | 'relaunch-failed'
  /** A completed journal survived, but acknowledgement already removed its rollback source. */
  | 'rollback-unavailable'
  /**
   * A failed restore could not put every file back, so its asides are still the
   * only copy and may not be released. Temporary: the next boot retries.
   */
  | 'recovery-incomplete'
  /**
   * A recovery artifact is not where this restore left it — an ancestor became a
   * symlink, or the artifact itself is no longer a plain file or directory — so
   * releasing it could delete something outside userData. The detail stays in
   * the log; the user's repair is to remove the interloper by hand.
   */
  | 'unsafe-artifact'

export class RestoreStateError extends Error {
  readonly code: RestoreStateErrorCode
  constructor(code: RestoreStateErrorCode, message: string) {
    super(message)
    this.name = 'RestoreStateError'
    this.code = code
  }
}

/** Thrown when an already-aborted `AbortSignal` is observed at a step boundary. */
export class BackupCancelledError extends Error {
  constructor(message = 'backup cancelled') {
    super(message)
    this.name = 'BackupCancelledError'
  }
}

/**
 * Thrown when a volume fills mid-write (preflight passed but the write stream hit
 * `ENOSPC`) so the caller surfaces a clear "disk full" rather than a raw errno.
 */
export class DiskFullError extends Error {
  constructor(message = 'disk became full during backup operation') {
    super(message)
    this.name = 'DiskFullError'
  }
}

/**
 * Thrown at publish time when the destination already exists — the export never
 * overwrites or deletes a pre-existing file (a prior good backup must survive).
 */
export class OutputPathExistsError extends Error {
  readonly outputPath: string
  constructor(outputPath: string) {
    super(`backup output path already exists (no-clobber): ${outputPath}`)
    this.name = 'OutputPathExistsError'
    this.outputPath = outputPath
  }
}

/**
 * Thrown when the destination volume cannot atomically hard-link the archive
 * into place (exFAT / some network mounts). This release keeps the frozen ATOMIC
 * publication contract rather than falling back to a non-atomic `copyFile` (Node
 * documents `copyFile` as non-atomic), so publication fails closed with no
 * visible partial archive. A product-approved non-atomic fallback would be a
 * separate, explicitly documented decision.
 */
export class HardLinkUnsupportedError extends Error {
  readonly outputPath: string
  constructor(outputPath: string) {
    super(`atomic hard-link publication is unsupported on this volume: ${outputPath}`)
    this.name = 'HardLinkUnsupportedError'
    this.outputPath = outputPath
  }
}

/**
 * Thrown when a backup destination is selected but its settings are missing or
 * incomplete — no host, no bucket, no directory, no Nutstore token.
 *
 * Distinct from a transport failure on purpose: "you have not set this up" and
 * "the server refused you" need different words, and a scheduled backup must be
 * able to tell them apart to decide whether reporting the failure is useful at
 * all.
 */
export class DestinationNotConfiguredError extends Error {
  readonly destination: string
  constructor(destination: string, missing: string) {
    super(`backup destination ${destination} is not configured: ${missing}`)
    this.name = 'DestinationNotConfiguredError'
    this.destination = destination
  }
}

/**
 * Thrown before writing when the staged DB payload is not a regular file or its
 * size / SHA-256 does not match what the manifest declares — the archive must
 * carry the exact DB it advertises.
 */
export class ManifestPayloadMismatchError extends Error {
  constructor(message: string) {
    super(`backup manifest payload mismatch: ${message}`)
    this.name = 'ManifestPayloadMismatchError'
  }
}

/**
 * Thrown when a source file/directory changes identity, size, or mtime — or a
 * directory's tree changes — while it is being staged. The archive cannot prove
 * which version it captured, so the export fails closed and cleans its own
 * staging.
 */
export class SourceDriftError extends Error {
  readonly sourcePath: string
  readonly reason: string
  constructor(sourcePath: string, reason: string) {
    super(`source changed during staging (${reason}): ${sourcePath}`)
    this.name = 'SourceDriftError'
    this.sourcePath = sourcePath
    this.reason = reason
  }
}

/** Restore preparation cannot safely rename one admitted resource into place. */
export class ResourceInstallPlanError extends Error {
  readonly code: string
  constructor(code: string, detail: string) {
    super(`resource cannot be installed (${code}): ${detail}`)
    this.name = 'ResourceInstallPlanError'
    this.code = code
  }
}

/**
 * Thrown when a directory unit contains a symlink or special node, or its root
 * is a symlink. A portable payload contains real directories and regular files
 * only; a symlink/special node cannot be transported or verified, so export
 * fails closed.
 */
export class NonRegularSourceError extends Error {
  readonly sourcePath: string
  constructor(sourcePath: string) {
    super(`source contains a symlink or special file (not a regular file): ${sourcePath}`)
    this.name = 'NonRegularSourceError'
    this.sourcePath = sourcePath
  }
}

export type UnportableSourceReason = 'invalid-path' | 'name-collision'

/**
 * Thrown when a source-tree relative path cannot be represented in a portable
 * archive (fails the Phase-1a portable-path rules — absolute/escaping, control
 * chars, Windows-reserved name, over-length/over-depth) or case/NFC-aliases
 * another entry. Admission would reject such an archive, so the export fails
 * closed at the producer.
 */
export class UnportableSourceError extends Error {
  readonly relPath: string
  readonly reason: UnportableSourceReason
  readonly sourceRoot?: string
  constructor(relPath: string, reason: UnportableSourceReason, sourceRoot?: string) {
    const detail =
      reason === 'name-collision' ? 'case/NFC-collides with another entry' : 'not a portable relative subpath'
    super(`source path is not portable (${detail}): ${relPath}`)
    this.name = 'UnportableSourceError'
    this.relPath = relPath
    this.reason = reason
    this.sourceRoot = sourceRoot
  }
}

/**
 * Thrown when a source unit exceeds a frozen operating ceiling (entry count,
 * per-entry bytes, total uncompressed bytes, path depth/length) during the
 * staging/hash scan — the same shared ceilings admission enforces.
 */
export class CeilingExceededError extends Error {
  readonly kind: string
  constructor(kind: string, detail: string) {
    super(`backup ceiling exceeded (${kind}): ${detail}`)
    this.name = 'CeilingExceededError'
    this.kind = kind
  }
}

/**
 * The step at which sealing a detached SQLite artifact failed
 * ({@link @main/services/backup/dbSeal}).
 */
export type DbSealStep =
  /** SQLite `integrity_check` could not run, or did not return `ok`. */
  | 'integrity'
  /** `wal_checkpoint(TRUNCATE)` did not fold the whole log into the main file. */
  | 'checkpoint'
  /** The artifact could not be taken out of WAL mode. */
  | 'journal-mode'
  /** A `-wal`/`-shm` sidecar still existed after sealing, so committed rows would sit outside the hashed file. */
  | 'sidecar'

/**
 * Thrown when a detached backup database cannot be proven sound and
 * single-file. Both the archive producer/consumer and portable materialization
 * seal through the same primitives, so a caller that needs its own error
 * taxonomy (admission maps this to `db-corrupt`) translates it at its boundary.
 *
 * MESSAGE HYGIENE: `detail` carries pragma results and step labels only — never
 * database content, which is where plaintext credentials live (§5.1.1).
 */
export class DbSealError extends Error {
  readonly step: DbSealStep
  readonly detail: string
  constructor(step: DbSealStep, detail: string) {
    super(`database seal failed (${step}): ${detail}`)
    this.name = 'DbSealError'
    this.step = step
    this.detail = detail
  }
}

export interface BackupMigrationTip {
  readonly folderMillis: number
  readonly hash: string
}

interface BackupMigrationCompatibilityCommon {
  readonly archiveAppVersion: string
  readonly archiveBuildType: 'packaged' | 'development' | 'unknown'
  readonly sourceMigrationCount: number
  readonly targetMigrationCount: number
  readonly sourceTip: BackupMigrationTip
  readonly targetTip: BackupMigrationTip
}

export type BackupMigrationCompatibility =
  | (BackupMigrationCompatibilityCommon & {
      readonly kind: 'source-ahead'
      readonly missingMigrationCount: number
      readonly firstExtraIndex: number
    })
  | (BackupMigrationCompatibilityCommon & {
      readonly kind: 'lineage-fork'
      readonly firstDivergentIndex: number
    })

/**
 * A structurally sound archive belongs to a migration lineage this build cannot
 * consume. Unlike hostile/malformed admission failures, this is safe and useful
 * to present as a bounded compatibility diagnosis.
 */
export class BackupMigrationCompatibilityError extends Error {
  readonly diagnostic: BackupMigrationCompatibility

  constructor(diagnostic: BackupMigrationCompatibility) {
    super(
      diagnostic.kind === 'source-ahead'
        ? `backup database is ahead by ${diagnostic.missingMigrationCount} migrations`
        : `backup database forked at migration #${diagnostic.firstDivergentIndex}`
    )
    this.name = 'BackupMigrationCompatibilityError'
    this.diagnostic = diagnostic
  }
}

export class BackupFormatCompatibilityError extends Error {
  readonly archiveFormatVersion: number
  readonly archiveAppVersion?: string
  readonly archiveBuildType: 'packaged' | 'development' | 'unknown'

  constructor({
    archiveFormatVersion,
    archiveAppVersion,
    archiveBuildType
  }: {
    archiveFormatVersion: number
    archiveAppVersion?: string
    archiveBuildType: 'packaged' | 'development' | 'unknown'
  }) {
    super(`backup format ${archiveFormatVersion} is not supported by this build`)
    this.name = 'BackupFormatCompatibilityError'
    this.archiveFormatVersion = archiveFormatVersion
    this.archiveAppVersion = archiveAppVersion
    this.archiveBuildType = archiveBuildType
  }
}

/**
 * The generic fail-closed rejection an untrusted `.cherrybackup` archive raises
 * at admission (Phase 1b-ii, docs/references/backup/README.md §5.2). Admission
 * is the trust boundary: every one of these fires BEFORE any restore journal or
 * live DB/resource write can exist, so a rejected archive never reaches a
 * mutating stage.
 *
 * A single discriminated error (rather than one class per check) keeps the
 * boundary auditable — a reviewer reads {@link AdmissionRejectReason} to see the
 * complete closed set of ways admission refuses an archive, and tests assert on
 * the structural `reason` instead of brittle message text.
 *
 * MESSAGE HYGIENE: `detail` carries only structural facts (entry names, byte
 * counts, limits, path segments) — NEVER file content or the parsed database,
 * which is where an archive's plaintext credentials live (§5.1.1). The DB bytes
 * are never interpolated into an error.
 */
export type AdmissionRejectReason =
  /** The file is not a readable ZIP, or its central directory could not be enumerated. */
  | 'zip-unreadable'
  /** An entry name is not a portable relative subpath (backslash/absolute/drive/UNC/dot/empty/control/reserved/over-limit). */
  | 'entry-name'
  /** Two entries collide under the case/NFC namespace, duplicate, or alias a directory against a file. */
  | 'entry-collision'
  /** An entry's metadata marks it a symlink/special node or an encrypted entry — rejected before extraction. */
  | 'entry-special'
  /** An entry's declared byte metadata is not a finite, safe, non-negative integer, or a directory declares nonzero bytes. */
  | 'entry-metadata'
  /** Actual streamed bytes did not equal the entry's declared uncompressed size (forged central/local size). */
  | 'entry-size-mismatch'
  /** Too many archive entries. */
  | 'ceiling-entries'
  /** A single entry's declared uncompressed size exceeds the per-entry ceiling. */
  | 'ceiling-entry-bytes'
  /** The aggregate declared uncompressed size exceeds the total ceiling. */
  | 'ceiling-total-bytes'
  /** An entry's uncompressed:compressed ratio exceeds the zip-bomb ceiling (incl. zero-compressed). */
  | 'ceiling-ratio'
  /** `manifest.json` exceeds the pre-parse byte cap, or actually streamed past it. */
  | 'ceiling-manifest-bytes'
  /** The archive payload layout is illegal: missing/duplicate `manifest.json`/`backup.sqlite`, a misplaced or undeclared/uncovered/overlapping/type-mismatched payload. */
  | 'layout'
  /** `manifest.json` is not valid JSON or fails the strict ManifestV2 schema. */
  | 'manifest-invalid'
  /** A recomputed DB or resource-payload size/hash does not match the manifest — the archive does not carry what it advertises. */
  | 'payload-mismatch'
  /** A staged node is a symlink/special file, or a realpath escapes the owned staging root, after extraction. */
  | 'staging-escape'
  /** The staged database fails a SQLite `integrity_check` (corrupt / not a database). */
  | 'db-corrupt'
  /** The staged database's actual applied chain does not equal the manifest's declared chain. */
  | 'chain-mismatch'
  /** Applying the trusted bundled schema failed or did not reach the complete bundled chain. */
  | 'chain-incompatible'
  /** The actual post-migration schema differs from a database built by this app's trusted migrations. */
  | 'schema-mismatch'
  /** A filesystem I/O error while extracting an entry (mapped from a raw errno, content-free). */
  | 'extraction-io'

export class ArchiveAdmissionError extends Error {
  readonly reason: AdmissionRejectReason
  readonly detail: string
  constructor(reason: AdmissionRejectReason, detail: string) {
    super(`archive admission rejected (${reason}): ${detail}`)
    this.name = 'ArchiveAdmissionError'
    this.reason = reason
    this.detail = detail
  }
}

/**
 * True for a code point that must never reach a log/terminal verbatim: C0
 * controls + DEL, C1 controls, the Unicode line/paragraph separators, and the
 * bidirectional-formatting controls (which can visually reorder a rendered
 * name to disguise it). Everything else — including ordinary printable
 * Unicode — is kept.
 */
function isUnsafeCodePoint(code: number): boolean {
  if (code < 0x20 || code === 0x7f) return true // C0 + DEL
  if (code >= 0x80 && code <= 0x9f) return true // C1
  if (code === 0x2028 || code === 0x2029) return true // line / paragraph separator
  if (code === 0x061c) return true // Arabic letter mark (bidi)
  if (code === 0x200e || code === 0x200f) return true // LRM / RLM
  if (code >= 0x202a && code <= 0x202e) return true // LRE/RLE/PDF/LRO/RLO
  if (code >= 0x2066 && code <= 0x2069) return true // LRI/RLI/FSI/PDI
  return false
}

/**
 * Render an UNTRUSTED archive entry name for inclusion in an error detail:
 * replace control / separator / bidi-formatting characters (so a crafted name
 * cannot inject terminal/log escapes or visually reorder itself) and truncate
 * (so a megabyte-long name cannot become a giant error string). Used everywhere a
 * raw entry name reaches an {@link ArchiveAdmissionError} detail.
 */
export function renderUntrustedName(name: string): string {
  let out = ''
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0
    out += isUnsafeCodePoint(code) ? '�' : ch
    if (out.length >= 96) return `${out}…`
  }
  return out
}

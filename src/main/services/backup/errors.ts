/**
 * Backup errors thrown by the export/producer pipeline (Phase 1b-i). Admission
 * (Phase 1b-ii) adds its own taxonomy in the same file when it lands. No merge /
 * domain / contributor error concepts are ported from #17206.
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
  constructor(message = 'disk became full mid-archive') {
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

/**
 * Thrown when a directory unit contains a symlink or special (non-regular) file,
 * or its root is a symlink. A portable payload is regular files only; a
 * symlink/special node cannot be transported or verified, so the export fails
 * closed.
 */
export class NonRegularSourceError extends Error {
  readonly sourcePath: string
  constructor(sourcePath: string) {
    super(`source contains a symlink or special file (not a regular file): ${sourcePath}`)
    this.name = 'NonRegularSourceError'
    this.sourcePath = sourcePath
  }
}

/**
 * Thrown when a source-tree relative path cannot be represented in a portable
 * archive (fails the Phase-1a portable-path rules — absolute/escaping, control
 * chars, Windows-reserved name, over-length/over-depth) or case/NFC-aliases
 * another entry. Admission would reject such an archive, so the export fails
 * closed at the producer.
 */
export class UnportableSourceError extends Error {
  readonly relPath: string
  readonly reason: string
  constructor(relPath: string, reason: string) {
    super(`source path is not portable (${reason}): ${relPath}`)
    this.name = 'UnportableSourceError'
    this.relPath = relPath
    this.reason = reason
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

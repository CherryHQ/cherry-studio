/** Typed failures for the Lite producer and hostile-archive boundary. */
export class InsufficientDiskSpaceError extends Error {
  readonly needed: number
  readonly available: number
  readonly path: string
  constructor({ needed, available, path }: { needed: number; available: number; path: string }) {
    super(`insufficient disk space at ${path}: need ~${needed} bytes, available ${available} bytes`)
    this.name = 'InsufficientDiskSpaceError'
    this.needed = needed
    this.available = available
    this.path = path
  }
}

export class BackupBusyError extends Error {
  constructor(
    readonly running: string,
    readonly requested: string
  ) {
    super(`a backup operation is already running (${running}); cannot start ${requested}`)
    this.name = 'BackupBusyError'
  }
}

export class BackupCancelledError extends Error {
  constructor(message = 'backup cancelled') {
    super(message)
    this.name = 'BackupCancelledError'
  }
}

export class DiskFullError extends Error {
  constructor(message = 'disk became full during backup operation') {
    super(message)
    this.name = 'DiskFullError'
  }
}

export class OutputPathExistsError extends Error {
  constructor(readonly outputPath: string) {
    super(`backup output path already exists (no-clobber): ${outputPath}`)
    this.name = 'OutputPathExistsError'
  }
}

/** No `copyFile` fallback: publication must remain atomic and no-clobber. */
export class HardLinkUnsupportedError extends Error {
  constructor(readonly outputPath: string) {
    super(`atomic hard-link publication is unsupported on this volume: ${outputPath}`)
    this.name = 'HardLinkUnsupportedError'
  }
}

export class ManifestPayloadMismatchError extends Error {
  constructor(message: string) {
    super(`backup manifest payload mismatch: ${message}`)
    this.name = 'ManifestPayloadMismatchError'
  }
}

export class CeilingExceededError extends Error {
  constructor(
    readonly kind: string,
    detail: string
  ) {
    super(`backup ceiling exceeded (${kind}): ${detail}`)
    this.name = 'CeilingExceededError'
  }
}

export type DbSealStep = 'integrity' | 'checkpoint' | 'journal-mode' | 'sidecar'

export class DbSealError extends Error {
  constructor(
    readonly step: DbSealStep,
    readonly detail: string
  ) {
    super(`database seal failed (${step}): ${detail}`)
    this.name = 'DbSealError'
  }
}

/** Closed rejection reasons for an untrusted Lite archive. */
export type AdmissionRejectReason =
  | 'zip-unreadable'
  | 'entry-name'
  | 'entry-collision'
  | 'entry-special'
  | 'entry-metadata'
  | 'entry-size-mismatch'
  | 'ceiling-entries'
  | 'ceiling-entry-bytes'
  | 'ceiling-total-bytes'
  | 'ceiling-ratio'
  | 'ceiling-manifest-bytes'
  | 'layout'
  | 'manifest-invalid'
  | 'payload-mismatch'
  | 'staging-escape'
  | 'db-corrupt'
  | 'chain-mismatch'
  | 'chain-incompatible'
  | 'schema-mismatch'
  | 'extraction-io'

export class ArchiveAdmissionError extends Error {
  constructor(
    readonly reason: AdmissionRejectReason,
    readonly detail: string
  ) {
    super(`archive admission rejected (${reason}): ${detail}`)
    this.name = 'ArchiveAdmissionError'
  }
}

/** Safe, bounded rendering for an archive-controlled entry name in logs/errors. */
export function renderUntrustedName(name: string): string {
  let out = ''
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0
    const unsafe =
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x80 && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    out += unsafe ? '�' : char
    if (out.length >= 96) return `${out}…`
  }
  return out
}

import { isSafeRelativeSubpath, portableCollisionKey, toRelativeSegments } from '@main/utils/relativePath'
import StreamZip from 'node-stream-zip'

import { DB_ENTRY, MANIFEST_ENTRY, RESOURCES_PREFIX } from '../archiveLayout'
import { ArchiveAdmissionError, renderUntrustedName } from '../errors'

/**
 * Untrusted ZIP catalog + all pre-extraction validation for archive admission
 * (Phase 1b-ii, docs/references/backup/README.md §5.2). NOTHING is written to
 * disk here: this module reads only the central directory and rejects a hostile
 * archive on its metadata alone, so a ZIP bomb, a symlink entry, or a path
 * escape never survives to the extraction stage.
 *
 * DUPLICATE-PRESERVING ENUMERATION. `node-stream-zip`'s `entries()` returns a
 * name-keyed object map, so a second entry named `manifest.json` would silently
 * overwrite the first — hiding a smuggled payload behind a benign name. We
 * instead collect the per-record `'entry'` event stream into an ARRAY (every
 * central-directory record, duplicates included) and reject duplicates
 * ourselves, and we set `skipEntryNameValidation` so the library hands us every
 * raw name verbatim and OUR Phase-1a portable policy is the sole authority.
 *
 * These ceilings are ADVISORY over the archive's own (forgeable) central-directory
 * metadata; the actual bytes are re-bounded during extraction ({@link ./extract}).
 */

/** POSIX file-type bits (`S_IFMT` family) read from the ZIP external-attribute unix mode. */
const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

/** The ceilings this stage reads. Structural `number`s so tests can narrow them. */
export interface CatalogCeilings {
  readonly maxArchiveEntries: number
  readonly maxEntryUncompressedBytes: number
  readonly maxTotalUncompressedBytes: number
  readonly maxCompressionRatio: number
  readonly maxManifestBytes: number
  readonly maxPathDepth: number
  readonly maxPathLength: number
}

/** One raw central-directory record, with its size/mode metadata snapshotted at read time. */
interface RawEntry {
  readonly rawName: string
  readonly isDirectory: boolean
  readonly uncompressedSize: number
  readonly compressedSize: number
  readonly unixMode: number
  readonly encrypted: boolean
  readonly zipEntry: StreamZip.ZipEntry
}

/** A validated entry: a portable relative path (no trailing slash) plus its stream handle. */
export interface NormalizedEntry {
  /** Portable relative subpath, directory trailing slash stripped. */
  readonly path: string
  readonly isDirectory: boolean
  /** Uncompressed size snapshotted from the central directory (validated safe non-negative int). */
  readonly uncompressedSize: number
  readonly zipEntry: StreamZip.ZipEntry
}

/**
 * The legal archive shape after pre-extraction validation: exactly one manifest
 * + one DB, plus the resource file/dir entries (all under `resources/`). Payload
 * coverage against the parsed manifest is a later stage ({@link ./layout}) — it
 * needs the manifest, which cannot be read until after these metadata gates pass.
 */
export interface ArchiveShape {
  readonly manifest: NormalizedEntry
  readonly db: NormalizedEntry
  readonly resourceFiles: readonly NormalizedEntry[]
  readonly resourceDirs: readonly NormalizedEntry[]
  /** Sum of every entry's declared uncompressed size — the disk-preflight input. */
  readonly declaredTotalBytes: number
}

/** An open archive handle: the catalogued entries plus the live zip for later streaming. */
export interface OpenArchive {
  readonly zip: InstanceType<typeof StreamZip>
  readonly entries: readonly RawEntry[]
  close(): Promise<void>
}

function unixModeOf(attr: number): number {
  // External file attributes carry the unix mode in the high 16 bits. DOS-origin
  // archives leave it 0, in which case there is no symlink/special signal.
  return (attr >>> 16) & 0xffff
}

/**
 * Open a ZIP and catalog every central-directory record into an array. Rejects
 * with {@link ArchiveAdmissionError} `zip-unreadable` if the file is not a
 * readable ZIP. The returned handle MUST be closed by the caller.
 *
 * OPEN-HANDLE ROBUSTNESS: a constructor throw and any pre-`ready` `'error'`
 * event both reject through the SAME normalized path; an `'error'` that fires
 * AFTER `ready` (while the resolved caller is streaming) is ignored here so it
 * cannot yank the handle out from under the caller — the caller's own
 * `zip.stream` callback surfaces such errors, and `close()` stays idempotent.
 */
export function openArchive(archivePath: string): Promise<OpenArchive> {
  return new Promise((resolve, reject) => {
    let settled = false
    let zip: InstanceType<typeof StreamZip>
    try {
      zip = new StreamZip({ file: archivePath, storeEntries: false, skipEntryNameValidation: true })
    } catch {
      // Constant detail: a library error can echo attacker-controlled names/paths.
      reject(new ArchiveAdmissionError('zip-unreadable', 'archive could not be opened'))
      return
    }
    const entries: RawEntry[] = []
    zip.on('entry', (entry) => {
      entries.push({
        rawName: entry.name,
        isDirectory: entry.isDirectory,
        uncompressedSize: entry.size,
        compressedSize: entry.compressedSize,
        unixMode: unixModeOf(entry.attr),
        encrypted: entry.encrypted,
        zipEntry: entry
      })
    })
    zip.on('ready', () => {
      settled = true
      // Closure-guarded so calling close() more than once is a genuine no-op
      // (a second zip.close on an already-closed handle would otherwise error).
      let closed = false
      resolve({
        zip,
        entries,
        close: () =>
          closed
            ? Promise.resolve()
            : new Promise<void>((res) => {
                closed = true
                zip.close(() => res())
              })
      })
    })
    zip.on('error', () => {
      if (settled) return // post-ready error: the streaming caller owns it; don't close the handle here.
      settled = true
      zip.close(() => {})
      // Constant detail: a library error can echo attacker-controlled names/paths.
      reject(new ArchiveAdmissionError('zip-unreadable', 'archive could not be read'))
    })
  })
}

function stripTrailingSlash(name: string): string {
  return name.endsWith('/') ? name.slice(0, -1) : name
}

/**
 * Every ceiling must be a positive safe integer — a bad ceiling is a CONTRACT
 * violation (misconfiguration), not an archive rejection, so it throws
 * `RangeError` rather than being reported as `ArchiveAdmissionError`.
 */
function validateCeilings(ceilings: CatalogCeilings): void {
  for (const [key, value] of Object.entries(ceilings)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`validateArchiveShape: ceiling ${key} must be a positive safe integer, got ${value}`)
    }
  }
}

function compareSegments(a: readonly string[], b: readonly string[]): number {
  const shared = Math.min(a.length, b.length)
  for (let i = 0; i < shared; i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return a.length - b.length
}

function isStrictPrefix(prefix: readonly string[], of: readonly string[]): boolean {
  if (prefix.length >= of.length) return false
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== of[i]) return false
  }
  return true
}

/**
 * Reject a regular FILE entry that is an ancestor (path prefix) of another entry
 * — e.g. `resources/a` (file) plus `resources/a/b` — BEFORE extraction, rather
 * than letting it surface as an incidental `mkdir`/`wx` collision. Directory
 * ancestors remain legal. Uses collision-key segments so the check is case/NFC
 * aware and consistent with the duplicate namespace.
 */
function assertNoFileAncestors(entries: readonly NormalizedEntry[]): void {
  const indexed = entries
    .map((entry) => ({ entry, segments: toRelativeSegments(portableCollisionKey(entry.path)) }))
    .sort((a, b) => compareSegments(a.segments, b.segments))
  const stack: Array<{ entry: NormalizedEntry; segments: string[] }> = []
  for (const cur of indexed) {
    while (stack.length > 0 && !isStrictPrefix(stack[stack.length - 1].segments, cur.segments)) {
      stack.pop()
    }
    const ancestor = stack[stack.length - 1]
    if (ancestor && !ancestor.entry.isDirectory) {
      throw new ArchiveAdmissionError(
        'entry-collision',
        `file entry ${renderUntrustedName(ancestor.entry.path)} is an ancestor of ${renderUntrustedName(cur.entry.path)}`
      )
    }
    stack.push(cur)
  }
}

/**
 * Validate every catalogued entry on its metadata alone (no I/O) and classify the
 * archive into its legal shape. Throws {@link ArchiveAdmissionError} on the first
 * violation. Order is deterministic: entry-count ceiling → per-entry facts
 * (metadata/special/byte/ratio/name/aggregate) → cross-entry collisions →
 * ancestor-file aliases → layout.
 */
export function validateArchiveShape(entries: readonly RawEntry[], ceilings: CatalogCeilings): ArchiveShape {
  validateCeilings(ceilings)

  if (entries.length > ceilings.maxArchiveEntries) {
    throw new ArchiveAdmissionError('ceiling-entries', `${entries.length} > ${ceilings.maxArchiveEntries}`)
  }

  const relativeLimits = { maxLength: ceilings.maxPathLength, maxDepth: ceilings.maxPathDepth }
  const normalized: NormalizedEntry[] = []
  const collisionKeys = new Set<string>()
  // Remaining-budget arithmetic: decrement a bounded counter instead of summing
  // (a naive Number sum over up to 100k × 8 GiB entries would lose precision).
  let remainingTotal = ceilings.maxTotalUncompressedBytes

  for (const raw of entries) {
    const label = renderUntrustedName(raw.rawName)

    // Byte metadata must be finite, safe, non-negative integers (a zip64 value
    // beyond 2^53 fails `isSafeInteger` and is rejected here, not silently used).
    if (!Number.isSafeInteger(raw.uncompressedSize) || raw.uncompressedSize < 0) {
      throw new ArchiveAdmissionError('entry-metadata', `${label}: bad uncompressed size`)
    }
    if (!Number.isSafeInteger(raw.compressedSize) || raw.compressedSize < 0) {
      throw new ArchiveAdmissionError('entry-metadata', `${label}: bad compressed size`)
    }

    // Symlink/special or encrypted entries never extract. A 0 unix mode is a
    // DOS-origin archive with no type bits — treated as a regular node.
    if (raw.encrypted) {
      throw new ArchiveAdmissionError('entry-special', `${label}: encrypted entry`)
    }
    if (raw.unixMode !== 0) {
      const type = raw.unixMode & S_IFMT
      if (type !== S_IFREG && type !== S_IFDIR) {
        throw new ArchiveAdmissionError(
          'entry-special',
          `${label}: non-regular entry (mode ${raw.unixMode.toString(8)})`
        )
      }
      // The unix type bit must agree with the name-derived directory flag — a file
      // carrying S_IFDIR (or a directory carrying S_IFREG) is a type confusion.
      if ((type === S_IFDIR) !== raw.isDirectory) {
        throw new ArchiveAdmissionError('entry-special', `${label}: unix mode inconsistent with directory flag`)
      }
    }

    // A directory carries no bytes; a regular-file name must not end with a slash.
    if (raw.isDirectory && raw.uncompressedSize !== 0) {
      throw new ArchiveAdmissionError('entry-metadata', `${label}: directory entry declares nonzero bytes`)
    }
    if (!raw.isDirectory && raw.rawName.endsWith('/')) {
      throw new ArchiveAdmissionError('entry-name', `${label}: file entry name ends with a slash`)
    }

    if (raw.uncompressedSize > ceilings.maxEntryUncompressedBytes) {
      throw new ArchiveAdmissionError(
        'ceiling-entry-bytes',
        `${label}: ${raw.uncompressedSize} > ${ceilings.maxEntryUncompressedBytes}`
      )
    }

    // Exact bigint ratio gate (no floating division): reject when
    // uncompressed > compressed * maxRatio. Zero-compressed with positive
    // uncompressed (0 * ratio = 0 < positive) is therefore rejected too.
    if (BigInt(raw.uncompressedSize) > BigInt(raw.compressedSize) * BigInt(ceilings.maxCompressionRatio)) {
      throw new ArchiveAdmissionError(
        'ceiling-ratio',
        `${label}: uncompressed ${raw.uncompressedSize} vs compressed ${raw.compressedSize}`
      )
    }

    const path = stripTrailingSlash(raw.rawName)
    if (!isSafeRelativeSubpath(path, relativeLimits)) {
      throw new ArchiveAdmissionError('entry-name', `unportable entry name: ${label}`)
    }

    remainingTotal -= raw.uncompressedSize
    if (remainingTotal < 0) {
      throw new ArchiveAdmissionError('ceiling-total-bytes', `> ${ceilings.maxTotalUncompressedBytes}`)
    }

    // ONE case/NFC collision namespace over normalized paths — this rejects
    // duplicate names, case/NFC aliases, AND a directory entry aliasing a file
    // (both resolve to the same key).
    const key = portableCollisionKey(path)
    if (collisionKeys.has(key)) {
      throw new ArchiveAdmissionError('entry-collision', `duplicate/aliasing entry: ${label}`)
    }
    collisionKeys.add(key)

    normalized.push({
      path,
      isDirectory: raw.isDirectory,
      uncompressedSize: raw.uncompressedSize,
      zipEntry: raw.zipEntry
    })
  }

  assertNoFileAncestors(normalized)
  return classifyShape(normalized, ceilings, ceilings.maxTotalUncompressedBytes - remainingTotal)
}

function isUnderResources(path: string): boolean {
  return path.startsWith(RESOURCES_PREFIX)
}

/** Partition normalized entries into the frozen layout, rejecting any misplaced/undeclared node. */
function classifyShape(
  entries: readonly NormalizedEntry[],
  ceilings: CatalogCeilings,
  declaredTotalBytes: number
): ArchiveShape {
  let manifest: NormalizedEntry | undefined
  let db: NormalizedEntry | undefined
  const resourceFiles: NormalizedEntry[] = []
  const resourceDirs: NormalizedEntry[] = []
  const resourcesRoot = stripTrailingSlash(RESOURCES_PREFIX)

  for (const entry of entries) {
    if (entry.isDirectory) {
      // The only legal directories are the `resources/` root and its descendants.
      if (entry.path === resourcesRoot || isUnderResources(entry.path)) {
        resourceDirs.push(entry)
        continue
      }
      throw new ArchiveAdmissionError('layout', `undeclared directory entry: ${renderUntrustedName(entry.path)}`)
    }

    if (entry.path === MANIFEST_ENTRY) {
      if (manifest) throw new ArchiveAdmissionError('layout', 'more than one manifest.json')
      manifest = entry
      continue
    }
    if (entry.path === DB_ENTRY) {
      if (db) throw new ArchiveAdmissionError('layout', 'more than one backup.sqlite')
      db = entry
      continue
    }
    if (isUnderResources(entry.path)) {
      resourceFiles.push(entry)
      continue
    }
    // A regular file that is neither of the two fixed entries nor under
    // `resources/` has no place in the layout.
    throw new ArchiveAdmissionError('layout', `misplaced archive file: ${renderUntrustedName(entry.path)}`)
  }

  if (!manifest) throw new ArchiveAdmissionError('layout', 'missing manifest.json')
  if (!db) throw new ArchiveAdmissionError('layout', 'missing backup.sqlite')

  // Bound `manifest.json` BEFORE it is ever read/parsed (§5.3). The pre-parse cap
  // is what lets the manifest schema leave its arrays length-unbounded.
  if (manifest.uncompressedSize > ceilings.maxManifestBytes) {
    throw new ArchiveAdmissionError(
      'ceiling-manifest-bytes',
      `${manifest.uncompressedSize} > ${ceilings.maxManifestBytes}`
    )
  }

  return { manifest, db, resourceFiles, resourceDirs, declaredTotalBytes }
}

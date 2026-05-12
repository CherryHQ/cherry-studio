/**
 * Entry creation — `createInternal` for Cherry-owned files and `ensureExternal`
 * for user-provided absolute paths.
 *
 * Pure functions taking `FileManagerDeps` as the first argument. Each source
 * variant resolves to a normalized `{ name, ext, bytes }` triple, then writes
 * via `atomicWriteFile` and inserts the row through `fileEntryService.create`.
 * On DB failure the just-written physical file is best-effort unlinked so the
 * `{userData}/Data/Files/` tree never carries orphan internal blobs from a failed
 * create flow.
 */

import { realpath } from 'node:fs/promises'

import { application } from '@application'
import { loggerService } from '@logger'
import { atomicWriteFile, copy as fsCopy, download, remove as fsRemove, stat as fsStat } from '@main/utils/file/fs'
import type { FileEntry } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import mime from 'mime'
import { v7 as uuidv7 } from 'uuid'

import type { CreateInternalEntryParams, EnsureExternalEntryParams } from '../../FileManager'
import { canonicalizeExternalPath } from '../../utils/pathResolver'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/create')

/**
 * Mirror of `fs.ts:bestEffortUnlinkTmp` for createInternal's two cleanup
 * sites: ENOENT is the desired post-state and stays silent, every other
 * errno surfaces a `warn` so oncall can find a stranded blob after the
 * abort. The original error is rethrown by the caller; this helper only
 * exists for observability.
 *
 * Replaces the previous `.catch(() => undefined)` pattern, which silenced
 * EACCES / EBUSY / EIO equally with ENOENT — exactly the class of failure
 * `fs.errno-warn.test.ts` was built to guard against.
 */
async function bestEffortCleanup(physical: FilePath, context: string): Promise<void> {
  try {
    await fsRemove(physical)
  } catch (cleanupErr) {
    const code = (cleanupErr as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      logger.warn(`${context}: cleanup unlink failed; physical blob may remain on disk`, {
        physical,
        code,
        err: cleanupErr
      })
    }
  }
}

interface NormalisedSource {
  name: string
  ext: string | null
  writeTo(target: FilePath): Promise<void>
}

const BASE64_DATA_URI = /^data:([^;,]+);base64,(.+)$/

function normaliseSource(params: CreateInternalEntryParams): NormalisedSource {
  if (params.source === 'bytes') {
    const data = params.data
    return {
      name: params.name,
      ext: params.ext,
      writeTo: (target) => atomicWriteFile(target, data)
    }
  }
  if (params.source === 'base64') {
    const match = BASE64_DATA_URI.exec(params.data)
    if (!match) {
      throw new Error('createInternal(base64): data URI is not in the expected `data:<mime>;base64,<payload>` form')
    }
    const mimeType = match[1]
    const payload = match[2]
    const ext = mime.getExtension(mimeType)
    const bytes = Buffer.from(payload, 'base64')
    return {
      name: params.name ?? `Pasted ${new Date().toISOString().slice(0, 10)}`,
      ext: ext ?? null,
      writeTo: (target) => atomicWriteFile(target, new Uint8Array(bytes))
    }
  }
  if (params.source === 'path') {
    const src = params.path
    return {
      name: basenameWithoutExt(src),
      ext: extWithoutDot(src),
      writeTo: (target) => fsCopy(src, target)
    }
  }
  // url
  const url = params.url
  return {
    name: urlTail(url),
    ext: extWithoutDot(url),
    writeTo: (target) => download(url, target)
  }
}

function basenameWithoutExt(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function extWithoutDot(p: string): string | null {
  const base = p.split(/[\\/]/).pop() ?? p
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return base.slice(dot + 1).toLowerCase()
}

function urlTail(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').pop() ?? ''
    const dot = last.lastIndexOf('.')
    return dot > 0 ? last.slice(0, dot) : last || u.hostname
  } catch {
    return url
  }
}

/**
 * Create a Cherry-owned (internal) FileEntry. The physical file lives at
 * `{userData}/Data/Files/{newId}{.ext}`. DB-insert failure best-effort unlinks
 * the just-written physical file to avoid orphan blobs.
 */
export async function createInternal(deps: FileManagerDeps, params: CreateInternalEntryParams): Promise<FileEntry> {
  const source = normaliseSource(params)
  const id = uuidv7()
  const filename = `${id}${source.ext ? `.${source.ext}` : ''}`
  const physical = application.getPath('feature.files.data', filename) as FilePath
  await source.writeTo(physical)
  let stats
  try {
    stats = await fsStat(physical)
  } catch (err) {
    await bestEffortCleanup(physical, 'createInternal:stat-failed')
    throw err
  }
  try {
    return await deps.fileEntryService.create({
      id,
      origin: 'internal',
      name: source.name,
      ext: source.ext,
      size: stats.size,
      externalPath: null
    })
  } catch (err) {
    logger.warn('createInternal: DB insert failed; unlinking physical file', { id, err })
    await bestEffortCleanup(physical, 'createInternal:db-insert-failed')
    throw err
  }
}

/**
 * Ensure an entry exists for a user-provided absolute path. Pure upsert keyed
 * by canonicalized externalPath. Path existence is verified via `fs.stat`
 * before insert; ENOENT propagates.
 */
export async function ensureExternal(deps: FileManagerDeps, params: EnsureExternalEntryParams): Promise<FileEntry> {
  const canonical = canonicalizeExternalPath(params.externalPath)
  const existing = await deps.fileEntryService.findByExternalPath(canonical)
  if (existing) return existing
  // Every downstream derivation must consume the canonical path, not the
  // raw `params.externalPath`. On macOS APFS the raw input can arrive in
  // NFD form while `canonical` is NFC; deriving `name` / `ext` from raw
  // would persist NFD-encoded values alongside an NFC `externalPath`, so
  // a later strict-equality check like `path.basename(canonical) === entry.name`
  // would silently diverge. Same risk for trailing-separator / `..`
  // noise in the raw input.
  // `canonical` is `CanonicalExternalPath`; the schema-side S5 refine now
  // makes the BO's `externalPath` `FilePath & CanonicalExternalPath`, but
  // here we only hold the factory-side `CanonicalExternalPath`. The cast
  // to `FilePath` is the sanctioned service-boundary upcast — the
  // canonicalize pipeline already enforces the absolute-shape gate that
  // `FilePath` represents at the type level.
  await fsStat(canonical as unknown as FilePath)
  // Case-insensitive peer lookup is index-backed via the
  // `fe_external_path_lower_unique_idx` functional UNIQUE on `lower(externalPath)`.
  // The same index hard-rejects an INSERT that would collide with an existing
  // peer's lowercased form, so we MUST resolve the collision at the
  // application layer before attempting the INSERT — otherwise a legitimate
  // distinct-file reference on a case-sensitive filesystem (Linux ext4 /
  // case-sensitive APFS volume) would surface as an opaque SQLITE_CONSTRAINT.
  //
  // Disambiguation strategy: `fs.realpath`. On case-insensitive filesystems
  // (macOS APFS default, Windows NTFS default) the FS itself folds case,
  // so `realpath('/foo/A.txt')` and `realpath('/foo/a.txt')` return the same
  // on-disk canonical string → same logical file, reuse the existing peer.
  // On case-sensitive filesystems the two paths resolve to distinct strings
  // (or one ENOENTs) → genuine distinct files, throw with peer info so the
  // caller can decide (rename / surface to user). This is the `fs.realpath`
  // upgrade pre-announced in `canonicalizeExternalPath`'s JSDoc.
  //
  // SELECT failure (transient DB lock, connection drop) propagates; the
  // subsequent INSERT would fail at the same boundary with a more
  // diagnosable stack, so wrapping in try/catch here only hides the real
  // error one stack frame earlier.
  const peers = await deps.fileEntryService.findCaseInsensitivePeers(canonical)
  if (peers.length > 0) {
    const reusable = await resolveCaseCollisionPeer(canonical as FilePath, peers)
    if (reusable) {
      logger.info('ensureExternal: reusing case-collision peer (fs.realpath confirmed same FS entry)', {
        newPath: canonical,
        peerId: reusable.id,
        peerPath: (reusable as { externalPath: string }).externalPath
      })
      return reusable
    }
    // No peer is the same FS entity. On a case-sensitive filesystem these
    // are legitimately distinct files, but the DB unique constraint forbids
    // the insert. Throw with full peer detail so the caller can act
    // (rename one of the colliding paths, or surface the conflict to the
    // user). This is a deliberate departure from the previous "warn-only"
    // contract — the application-layer hard guarantee on lowered-path
    // uniqueness is what option (c) brings.
    throw new Error(
      `ensureExternal: case-collision with existing entries — fs.realpath confirms different FS entities. ` +
        `New: ${canonical}; conflicting peers: ${peers
          .map((p) => `${p.id}=${(p as { externalPath: string }).externalPath}`)
          .join(', ')}`
    )
  }
  // `name` and `ext` are pure projections of `canonical` — derived here,
  // not accepted from callers. Doc-stated invariant: "external `name` is a
  // pure projection of `externalPath`" (file-manager-architecture §1.5 +
  // architecture §3.3) is now enforced by the IPC type lacking a `name`
  // override field. Phase 2 consumers that want a different display name
  // must `rename` after `ensureExternalEntry` returns.
  const name = defaultNameFromPath(canonical)
  const ext = extWithoutDot(canonical)
  const inserted = await deps.fileEntryService.create({
    origin: 'external',
    name,
    ext,
    size: null,
    externalPath: canonical
  })
  // Reverse-index hook: subsequent watcher / opportunistic ops events for
  // `canonical` should reach this entry id. The fs.stat above succeeded —
  // record a fresh 'present' observation so any imminent UI query short-
  // circuits the cold-stat path.
  deps.danglingCache.addEntry(inserted.id, canonical as FilePath)
  deps.danglingCache.onFsEvent(canonical as FilePath, 'present', 'ops')
  return inserted
}

function defaultNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * For an `ensureExternal` call whose canonical path matches one or more
 * existing peers case-insensitively, find the peer (if any) that refers to
 * the same on-disk file by comparing `fs.realpath` outputs.
 *
 * `fs.realpath` is the platform-correct probe for "are these two paths the
 * same FS entity": on case-insensitive filesystems it folds case to the
 * on-disk canonical form, so two case-different inputs return identical
 * strings; on case-sensitive filesystems each input resolves to its own
 * exact path. Symlinks are resolved through both, which is the right
 * semantic for "same logical file".
 *
 * A peer whose `externalPath` no longer exists on disk (`ENOENT` /
 * `ENOTDIR`) cannot be FS-disambiguated, so it does NOT win the reuse
 * race — the caller will throw and the user can resolve the conflict
 * (e.g. by permanentDeleting the dangling row first). Any other realpath
 * error propagates so transient permission / IO failures surface clearly.
 *
 * Returns the matching peer, or `null` when no peer is the same FS entity.
 */
async function resolveCaseCollisionPeer(newCanonical: FilePath, peers: FileEntry[]): Promise<FileEntry | null> {
  // The caller's `fsStat(newCanonical)` already succeeded a moment ago, so a
  // realpath failure here means the file was raced away or a symlink target
  // became unreachable between calls. We let the error propagate unchanged
  // so the caller sees the real FS errno rather than a confusing "no peer
  // matched" rejection later.
  const newReal = await realpath(newCanonical)
  for (const peer of peers) {
    if (peer.origin !== 'external') continue
    try {
      const peerReal = await realpath(peer.externalPath)
      if (peerReal === newReal) return peer
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      throw err
    }
  }
  return null
}

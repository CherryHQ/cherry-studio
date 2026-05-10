/**
 * Entry creation — `createInternal` for Cherry-owned files and `ensureExternal`
 * for user-provided absolute paths.
 *
 * Pure functions taking `FileManagerDeps` as the first argument. Each source
 * variant resolves to a normalized `{ name, ext, bytes }` triple, then writes
 * via `atomicWriteFile` and inserts the row through `fileEntryService.create`.
 * On DB failure the just-written physical file is best-effort unlinked so the
 * `{userData}/Files/` tree never carries orphan internal blobs from a failed
 * create flow.
 */

import { application } from '@application'
import { canonicalizeExternalPath } from '@data/utils/pathResolver'
import { loggerService } from '@logger'
import { atomicWriteFile, copy as fsCopy, download, remove as fsRemove, stat as fsStat } from '@main/utils/file/fs'
import type { FileEntry } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'
import mime from 'mime'
import { v7 as uuidv7 } from 'uuid'

import type { CreateInternalEntryParams, EnsureExternalEntryParams } from '../../FileManager'
import type { FileManagerDeps } from '../deps'

const logger = loggerService.withContext('internal/entry/create')

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
 * `{userData}/Files/{newId}{.ext}`. DB-insert failure best-effort unlinks
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
    await fsRemove(physical).catch(() => undefined)
    throw err
  }
  try {
    return await deps.fileEntryService.create({
      id: id as FileEntry['id'],
      origin: 'internal',
      name: source.name,
      ext: source.ext,
      size: stats.size,
      externalPath: null
    })
  } catch (err) {
    logger.warn('createInternal: DB insert failed; unlinking physical file', { id, err: (err as Error).message })
    await fsRemove(physical).catch(() => undefined)
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
  await fsStat(params.externalPath as FilePath)
  try {
    const peers = await deps.fileEntryService.findCaseInsensitivePeers(canonical)
    if (peers.length > 0) {
      logger.warn('ensureExternal: case-insensitive duplicate-suspect peers detected', {
        path: canonical,
        peerIds: peers.map((p) => p.id)
      })
    }
  } catch {
    // best-effort
  }
  const name = params.name ?? defaultNameFromPath(params.externalPath)
  const ext = extWithoutDot(params.externalPath)
  return deps.fileEntryService.create({
    origin: 'external',
    name,
    ext,
    size: null,
    externalPath: canonical
  })
}

function defaultNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? p
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

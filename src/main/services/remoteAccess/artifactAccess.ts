import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import mime from 'mime'

import { readChunkByPath } from '@main/services/file'
import { isOutsidePath, lstat, realpath } from '@main/utils/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { parseDataUrl } from '@shared/utils/dataUrl'

import { clipText, reportedArtifacts } from './messageProjection'
import { type MethodInput, RemoteRequestError } from './protocol'

export function artifactSource(part: CherryMessagePart, artifactIndex: number) {
  if (part.type === 'file' && artifactIndex === 0) {
    const entryId = readCherryMeta(part)?.fileEntryId
    if (entryId) return { kind: 'entry' as const, entryId }
    if (part.url.startsWith('data:'))
      return { kind: 'inline' as const, url: part.url, name: part.filename ?? '', mediaType: part.mediaType }
    if (part.url.startsWith('file:')) return { kind: 'path' as const, path: fileURLToPath(part.url) }
  }
  const artifact = reportedArtifacts(part)?.artifacts[artifactIndex]
  if (artifact) return { kind: 'path' as const, path: artifact.path }
  throw new RemoteRequestError('ARTIFACT_UNAVAILABLE')
}

function validateOffset(input: MethodInput<'artifacts.read'>, totalBytes: number, revision: string) {
  if (input.revision && input.revision !== revision) throw new RemoteRequestError('CONTENT_CHANGED', true)
  if (input.offset > totalBytes) throw new RemoteRequestError('INVALID_REQUEST')
}

function artifactPage(
  input: MethodInput<'artifacts.read'>,
  content: Uint8Array,
  metadata: { name: string; mediaType: string; totalBytes: number; revision: string }
) {
  const end = input.offset + content.byteLength
  return {
    partIndex: input.partIndex,
    artifactIndex: input.artifactIndex,
    name: clipText(metadata.name.replace(/.*[\\/]/, ''), 512).text,
    mediaType: clipText(metadata.mediaType, 128).text,
    totalBytes: metadata.totalBytes,
    revision: metadata.revision,
    encoding: 'base64',
    data: Buffer.from(content).toString('base64'),
    offset: input.offset,
    nextOffset: end < metadata.totalBytes ? end : null
  }
}

export function readInlineArtifact(
  source: { url: string; name: string; mediaType: string },
  input: MethodInput<'artifacts.read'>
) {
  const parsed = parseDataUrl(source.url)
  if (!parsed) throw new RemoteRequestError('ARTIFACT_UNAVAILABLE')
  const bytes = parsed.isBase64 ? Buffer.from(parsed.data, 'base64') : Buffer.from(decodeURIComponent(parsed.data))
  const revision = createHash('sha256').update(bytes).digest('hex')
  validateOffset(input, bytes.length, revision)
  return artifactPage(input, bytes.subarray(input.offset, input.offset + input.limitBytes), {
    name: source.name,
    mediaType: parsed.mediaType ?? source.mediaType,
    totalBytes: bytes.length,
    revision
  })
}

async function resolveArtifactPath(root: string, declaredPath: string) {
  const canonicalRoot = await realpath(AbsoluteFilePathSchema.parse(root))
  const target = await realpath(AbsoluteFilePathSchema.parse(path.resolve(root, declaredPath)))
  if (isOutsidePath(path.relative(canonicalRoot, target))) throw new RemoteRequestError('ARTIFACT_UNAVAILABLE')
  return target
}

function fileRevision(target: string, metadata: { size: number; modifiedAt: number; createdAt: number }) {
  return createHash('sha256')
    .update(JSON.stringify([target, metadata.size, metadata.modifiedAt, metadata.createdAt]))
    .digest('hex')
}

export async function readArtifactFile(
  root: string,
  declaredPath: string,
  input: MethodInput<'artifacts.read'>,
  displayName = path.basename(declaredPath)
) {
  try {
    const target = await resolveArtifactPath(root, declaredPath)
    const before = await lstat(target)
    if (!before.isFile) throw new RemoteRequestError('ARTIFACT_UNAVAILABLE')
    const revision = fileRevision(target, before)
    validateOffset(input, before.size, revision)
    const result = await readChunkByPath(target, input.offset, Math.min(input.limitBytes, before.size - input.offset))
    const after = await lstat(target)
    if (
      (await resolveArtifactPath(root, declaredPath)) !== target ||
      fileRevision(target, after) !== revision ||
      result.version.size !== before.size ||
      result.version.mtime !== before.modifiedAt ||
      result.content.byteLength !== Math.min(input.limitBytes, before.size - input.offset)
    )
      throw new RemoteRequestError('CONTENT_CHANGED', true)
    return artifactPage(input, result.content, {
      name: displayName,
      mediaType: mime.getType(target) ?? 'application/octet-stream',
      totalBytes: before.size,
      revision
    })
  } catch (error) {
    if (error instanceof RemoteRequestError) throw error
    throw new RemoteRequestError('ARTIFACT_UNAVAILABLE')
  }
}

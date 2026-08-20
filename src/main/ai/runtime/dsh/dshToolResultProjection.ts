import { createHash } from 'node:crypto'
import path from 'node:path'

import { assertAgentStoragePath, ensureAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { mimeToExt, prepareAtomicWrite } from '@main/utils/file'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { AbsoluteFilePathSchema } from '@shared/types/file'

interface DshToolResultProjectionOptions {
  agentsDataRoot: string
  toolResultRoot: string
  signal?: AbortSignal
}

type PreparedContent =
  | { type: 'text'; text: string }
  | { type: 'binary'; kind: 'image' | 'audio' | 'resource'; bytes: Buffer; mimeType: string; uri?: string }
  | { type: 'resource_link'; name: string; uri: string; mimeType?: string; title?: string; description?: string }

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

function normalizedMimeType(mimeType: string | undefined): string {
  const normalized = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  return normalized && MEDIA_TYPE_PATTERN.test(normalized) ? normalized : 'application/octet-stream'
}

function decodeBase64(data: string, label: string, remainingBytes: number, toolName: string): Buffer {
  if (!data || data.length % 4 !== 0 || !BASE64_PATTERN.test(data)) {
    throw new Error(`${label} contains invalid base64 data`)
  }

  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const decodedBytes = (data.length / 4) * 3 - padding
  if (decodedBytes > remainingBytes) {
    throw new Error(`${toolName} returned more than ${MAX_FILE_SIZE_BYTES} bytes of binary content`)
  }

  const bytes = Buffer.from(data, 'base64')
  if (bytes.byteLength !== decodedBytes || bytes.toString('base64') !== data) {
    throw new Error(`${label} contains non-canonical base64 data`)
  }
  return bytes
}

function prepareContent(content: CallToolResult['content'], toolName: string): PreparedContent[] {
  const prepared: PreparedContent[] = []
  let totalBinaryBytes = 0

  for (const [index, value] of content.entries()) {
    switch (value.type) {
      case 'text':
        prepared.push({ type: 'text', text: value.text })
        break
      case 'image':
      case 'audio': {
        const bytes = decodeBase64(
          value.data,
          `${toolName} ${value.type} block ${index + 1}`,
          MAX_FILE_SIZE_BYTES - totalBinaryBytes,
          toolName
        )
        totalBinaryBytes += bytes.byteLength
        prepared.push({
          type: 'binary',
          kind: value.type,
          bytes,
          mimeType: normalizedMimeType(value.mimeType)
        })
        break
      }
      case 'resource':
        if ('text' in value.resource) {
          prepared.push({ type: 'text', text: value.resource.text })
        } else {
          const bytes = decodeBase64(
            value.resource.blob,
            `${toolName} resource block ${index + 1}`,
            MAX_FILE_SIZE_BYTES - totalBinaryBytes,
            toolName
          )
          totalBinaryBytes += bytes.byteLength
          prepared.push({
            type: 'binary',
            kind: 'resource',
            bytes,
            mimeType: normalizedMimeType(value.resource.mimeType),
            uri: value.resource.uri
          })
        }
        break
      case 'resource_link':
        prepared.push({
          type: 'resource_link',
          name: value.name,
          uri: value.uri,
          ...(value.mimeType ? { mimeType: value.mimeType } : {}),
          ...(value.title ? { title: value.title } : {}),
          ...(value.description ? { description: value.description } : {})
        })
        break
    }
  }

  return prepared
}

function extensionForMimeType(mimeType: string): string {
  const extension = mimeToExt(mimeType)?.toLowerCase()
  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'bin'
}

function resourceLinkText(content: Extract<PreparedContent, { type: 'resource_link' }>): string {
  const fields = [`name=${JSON.stringify(content.name)}`, `uri=${JSON.stringify(content.uri)}`]
  if (content.mimeType) fields.push(`mimeType=${JSON.stringify(content.mimeType)}`)
  if (content.title) fields.push(`title=${JSON.stringify(content.title)}`)
  if (content.description) fields.push(`description=${JSON.stringify(content.description)}`)
  return `[resource link: ${fields.join(', ')}]`
}

async function materializeBinary(
  content: Extract<PreparedContent, { type: 'binary' }>,
  options: DshToolResultProjectionOptions
): Promise<string> {
  options.signal?.throwIfAborted()
  const digest = createHash('sha256').update(content.bytes).digest('hex')
  const bucket = path.join(options.toolResultRoot, digest.slice(0, 2))
  await ensureAgentStorageDirectory(options.agentsDataRoot, bucket)

  const target = path.join(bucket, `${digest}.${extensionForMimeType(content.mimeType)}`)
  await assertAgentStoragePath(options.agentsDataRoot, target)
  const prepared = await prepareAtomicWrite(AbsoluteFilePathSchema.parse(target), content.bytes, { mode: 0o600 })
  try {
    options.signal?.throwIfAborted()
    await prepared.commit()
  } catch (error) {
    await prepared.abort()
    throw error
  }
  return target
}

/** Project MCP content into DSH text while materializing binary blocks under managed Agent storage. */
export async function projectDshToolResult(
  content: CallToolResult['content'],
  toolName: string,
  options: DshToolResultProjectionOptions
): Promise<string> {
  options.signal?.throwIfAborted()
  const prepared = prepareContent(content, toolName)
  const parts: string[] = []
  const paths = new Map<string, string>()

  for (const value of prepared) {
    options.signal?.throwIfAborted()
    if (value.type === 'text') {
      parts.push(value.text)
      continue
    }
    if (value.type === 'resource_link') {
      parts.push(resourceLinkText(value))
      continue
    }

    const digest = createHash('sha256').update(value.bytes).digest('hex')
    const key = `${digest}.${extensionForMimeType(value.mimeType)}`
    let savedPath = paths.get(key)
    if (!savedPath) {
      savedPath = await materializeBinary(value, options)
      paths.set(key, savedPath)
    }
    const renderedPath = JSON.stringify(savedPath)
    if (value.kind === 'image') {
      parts.push(`[image: ${value.mimeType}, saved to ${renderedPath}; use read_image to inspect]`)
    } else if (value.kind === 'audio') {
      parts.push(`[audio: ${value.mimeType}, saved to ${renderedPath}]`)
    } else {
      parts.push(`[resource: ${value.mimeType}, uri=${JSON.stringify(value.uri)}, saved to ${renderedPath}]`)
    }
  }

  return parts.join('\n') || `(${toolName} returned no text content)`
}

/** Extract only textual error details; error results must never materialize binary content. */
export function dshToolResultErrorText(content: CallToolResult['content'], toolName: string): string {
  const parts = content.flatMap((value) => {
    if (value.type === 'text') return [value.text]
    if (value.type === 'resource' && 'text' in value.resource) return [value.resource.text]
    return []
  })
  return parts.join('\n') || `${toolName} failed without text content`
}

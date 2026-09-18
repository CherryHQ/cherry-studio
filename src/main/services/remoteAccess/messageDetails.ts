import { createHash } from 'node:crypto'

import type { CherryMessagePart } from '@shared/data/types/message'

import { partDetails } from './messageProjection'
import { type MethodInput, RemoteRequestError } from './protocol'

type ContentPage = { offset: number; limitBytes: number; revision?: string }

export function contentPage(value: unknown, input: ContentPage) {
  const encoding = typeof value === 'string' ? 'text' : 'json'
  const bytes = Buffer.from(typeof value === 'string' ? value : (JSON.stringify(value) ?? 'null'))
  const revision = createHash('sha256').update(bytes).digest('hex')
  if (input.revision && input.revision !== revision) throw new RemoteRequestError('CONTENT_CHANGED', true)
  if (input.offset > bytes.length || (input.offset < bytes.length && (bytes[input.offset] & 0xc0) === 0x80))
    throw new RemoteRequestError('INVALID_REQUEST')
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    bytes.subarray(input.offset, input.offset + input.limitBytes),
    { stream: true }
  )
  const end = input.offset + Buffer.byteLength(text)
  return {
    encoding,
    text,
    revision,
    offset: input.offset,
    totalBytes: bytes.length,
    nextOffset: end < bytes.length ? end : null
  }
}

export function listPartDetails(parts: CherryMessagePart[], input: MethodInput<'messages.parts.list'>) {
  const offset = input.cursor === undefined ? 0 : Number(input.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RemoteRequestError('INVALID_REQUEST')
  const items = parts.slice(offset, offset + input.limit).map((part, index) => {
    const { fields, ...metadata } = partDetails(part)
    return {
      partIndex: offset + index,
      ...metadata,
      fields: Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .map(([name]) => name)
    }
  })
  return { items, nextCursor: offset + items.length < parts.length ? String(offset + items.length) : null }
}

export function getPartContent(parts: CherryMessagePart[], input: MethodInput<'messages.parts.get'>) {
  const part = parts[input.partIndex]
  if (!part) throw new RemoteRequestError('NOT_FOUND')
  const detail = partDetails(part)
  if (!Object.hasOwn(detail.fields, input.field)) throw new RemoteRequestError('NOT_FOUND')
  const value: unknown = detail.fields[input.field]
  if (value === undefined) throw new RemoteRequestError('NOT_FOUND')
  return { partIndex: input.partIndex, field: input.field, ...contentPage(value, input) }
}

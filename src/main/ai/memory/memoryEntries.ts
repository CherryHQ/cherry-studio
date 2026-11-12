import * as z from 'zod'

import { MemoryError } from './memoryFiles'

const marker = '<!-- cherry-memory-entry:'
const identifier = z.string().min(1).max(256)
const sourceSchema = z.strictObject({
  kind: z.enum(['chat', 'agent']),
  conversationId: identifier,
  messageId: identifier,
  sourceVersion: identifier
})
const entrySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: identifier,
    status: z.enum(['active', 'expired', 'forgotten']),
    sources: z.array(sourceSchema),
    text: z.string(),
    derivedFrom: z.array(identifier),
    validFrom: z.iso.datetime().optional(),
    validTo: z.iso.datetime().optional(),
    supersededBy: identifier.optional()
  })
  .refine((entry) => entry.status !== 'forgotten' || entry.text === '')

export type MemoryEntry = z.infer<typeof entrySchema>
export type MemoryPart = string | MemoryEntry

export function memorySourceKey(source: MemoryEntry['sources'][number]): string {
  return JSON.stringify([source.kind, source.conversationId, source.messageId])
}

/** The reserved marker opts into strict parsing; ordinary Markdown is kept byte-for-byte. */
export function parseMemoryEntries(content: string): MemoryPart[] {
  const parts: MemoryPart[] = []
  const ids = new Set<string>()
  let offset = 0
  while (offset < content.length) {
    const start = content.indexOf(marker, offset)
    if (start === -1) {
      parts.push(content.slice(offset))
      break
    }
    if (start > offset) parts.push(content.slice(offset, start))
    const end = content.indexOf('\n-->', start)
    if (!content.startsWith(`${marker}v1\n`, start) || end === -1) invalidEntries()
    let entry: MemoryEntry
    try {
      entry = entrySchema.parse(JSON.parse(content.slice(start + `${marker}v1\n`.length, end)))
    } catch {
      return invalidEntries()
    }
    if (ids.has(entry.id)) invalidEntries()
    ids.add(entry.id)
    parts.push(entry)
    offset = end + '\n-->'.length
  }
  return parts
}

export function serializeMemoryEntries(parts: readonly MemoryPart[]): string {
  const content = parts
    .map((part) =>
      typeof part === 'string'
        ? part
        : `${marker}v1\n${JSON.stringify(entrySchema.parse(part)).replaceAll('<', '\\u003c')}\n-->`
    )
    .join('')
  parseMemoryEntries(content)
  return content
}

export function entriesIn(parts: readonly MemoryPart[]): MemoryEntry[] {
  return parts.filter((part): part is MemoryEntry => typeof part !== 'string')
}

export function forgottenEntry(entry: MemoryEntry): MemoryEntry {
  return {
    schemaVersion: 1,
    id: entry.id,
    status: 'forgotten',
    sources: entry.sources,
    text: '',
    derivedFrom: entry.derivedFrom
  }
}

export function invalidEntries(): never {
  throw new MemoryError('conflict', 'Memory entry metadata is invalid or requires a trusted state operation')
}

export type MemoryUse = 'current' | 'historical' | 'extraction'

/** Scope-wide policy: source versions never change the suppression identity. */
export function memoryModelView(
  files: ReadonlyMap<string, string>,
  target: string,
  purpose: MemoryUse,
  extractionSources?: readonly MemoryEntry['sources'][number][]
): string | null {
  const parsed = new Map([...files].map(([name, text]) => [name, parseMemoryEntries(text)]))
  const entries = [...parsed.values()].flatMap(entriesIn)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  if (byId.size !== entries.length) invalidEntries()
  for (const entry of entries) {
    if (entry.derivedFrom.some((id) => !byId.has(id))) invalidEntries()
  }
  const protectedEntries = entries.filter((entry) => entry.status !== 'active')
  if (
    purpose === 'extraction' &&
    protectedEntries.length &&
    (!extractionSources || protectedEntries.some((entry) => !entry.sources.length))
  )
    invalidEntries()
  const excluded = new Set(
    entries
      .filter((entry) => entry.status === 'forgotten' || (purpose !== 'historical' && entry.status === 'expired'))
      .map((entry) => entry.id)
  )
  const sources = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const entry of entries) {
      if (excluded.has(entry.id)) for (const source of entry.sources) sources.add(memorySourceKey(source))
    }
    for (const entry of entries) {
      if (
        !excluded.has(entry.id) &&
        (entry.sources.some((source) => sources.has(memorySourceKey(source))) ||
          entry.derivedFrom.some((id) => excluded.has(id)))
      ) {
        excluded.add(entry.id)
        changed = true
      }
    }
  }
  if (purpose === 'extraction' && extractionSources?.some((source) => sources.has(memorySourceKey(source))))
    invalidEntries()
  const parts = parsed.get(target)
  if (!parts) return null
  if (protectedEntries.length && parts.some((part) => typeof part === 'string' && part.trim())) invalidEntries()
  return parts
    .map((part) => {
      if (typeof part === 'string') return part
      if (excluded.has(part.id)) return ''
      return (
        JSON.stringify({ status: part.status, text: part.text, validFrom: part.validFrom, validTo: part.validTo }) +
        '\n'
      )
    })
    .join('')
}

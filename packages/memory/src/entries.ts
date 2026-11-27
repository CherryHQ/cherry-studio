import * as z from 'zod'

import { MemoryError } from './files'

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
    clearedAt: z.number().int().nonnegative().optional(),
    supersededBy: identifier.optional(),
    retirement: z
      .strictObject({
        reason: z.enum(['changed', 'corrected', 'qualified']),
        replacement: z.string().min(1).max(2000),
        recordedAt: z.iso.datetime(),
        sources: z.array(sourceSchema).min(1).max(12)
      })
      .optional()
  })
  .refine((entry) => entry.status !== 'forgotten' || entry.text === '')
  .refine((entry) => entry.clearedAt === undefined || entry.status === 'forgotten')
  .refine(
    (entry) => !entry.retirement || (entry.status === 'expired' && !entry.sources.length && !entry.derivedFrom.length)
  )

export type MemoryEntry = z.infer<typeof entrySchema>
export type MemoryPart = string | MemoryEntry

export type MemoryRevision = { quote: string; text: string } & Omit<
  NonNullable<MemoryEntry['retirement']>,
  'replacement'
>

export function isMemoryRevision(entry: MemoryEntry): boolean {
  return entry.status === 'expired' && !!entry.retirement
}

/** A later explicit change may make a previously retired value current again. */
export function retiredMemoryFacts(entries: readonly MemoryEntry[]): Set<string> {
  const retired = new Map<string, number>()
  const replaced = new Map<string, number>()
  for (const entry of entries) {
    if (!isMemoryRevision(entry)) continue
    const revision = entry.retirement!
    const at = Date.parse(revision.recordedAt)
    retired.set(entry.text, Math.max(retired.get(entry.text) ?? -Infinity, at))
    replaced.set(revision.replacement, Math.max(replaced.get(revision.replacement) ?? -Infinity, at))
  }
  return new Set([...retired].filter(([text, at]) => at >= (replaced.get(text) ?? -Infinity)).map(([text]) => text))
}

export function memoryFactText(line: string): string {
  const text = line.trim().replace(/^[-*] /, '')
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'string' ? parsed : text
  } catch {
    return text
  }
}

export function matchesMemoryQuote(line: string, quote: string): boolean {
  const fact = memoryFactText(line)
  return line.trim() === quote || fact === quote || fact === memoryFactText(quote)
}

export function reviseMemory(
  content: string,
  revisions: readonly MemoryRevision[],
  createId: () => string,
  additions: readonly string[] = []
): string {
  const parts = parseMemoryEntries(content)
  if (entriesIn(parts).some((entry) => !isMemoryRevision(entry) && entry.clearedAt === undefined)) invalidEntries()
  const retired: MemoryEntry[] = []
  for (const revision of revisions) {
    if (!revision.quote.trim() || !revision.text.trim() || revision.quote === revision.text) invalidEntries()
    let matches = 0
    let replacedText = ''
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]
      if (typeof part !== 'string') continue
      parts[index] = part
        .split('\n')
        .map((line) => {
          if (!matchesMemoryQuote(line, revision.quote)) return line
          replacedText = memoryFactText(line)
          matches++
          return `- ${JSON.stringify(revision.text)}`
        })
        .join('\n')
    }
    if (matches !== 1) invalidEntries()
    retired.push({
      schemaVersion: 1,
      id: createId(),
      status: 'expired',
      sources: [],
      derivedFrom: [],
      text: replacedText,
      retirement: {
        reason: revision.reason,
        replacement: revision.text,
        recordedAt: revision.recordedAt,
        sources: revision.sources
      }
    })
  }
  const body = parts.filter((part): part is string => typeof part === 'string').join('')
  const separator = additions.length && body && !body.endsWith('\n') ? '\n' : ''
  return serializeMemoryEntries([
    ...parts,
    separator,
    ...additions.map((text) => `- ${JSON.stringify(text)}\n`),
    ...retired
  ])
}

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
        : `${marker}v1\n${JSON.stringify(entrySchema.parse(part)).replace(/</g, '\\u003c')}\n-->`
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
  extractionSources?: readonly MemoryEntry['sources'][number][],
  earliestSourceAt?: number
): string | null {
  const parsed = new Map([...files].map(([name, text]) => [name, parseMemoryEntries(text)]))
  const entries = [...parsed.values()].flatMap(entriesIn)
  const retiredFacts = retiredMemoryFacts(entries)
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  if (byId.size !== entries.length) invalidEntries()
  for (const entry of entries) {
    if (entry.derivedFrom.some((id) => !byId.has(id))) invalidEntries()
  }
  const protectedEntries = entries.filter((entry) => entry.status !== 'active' && !isMemoryRevision(entry))
  if (
    purpose === 'extraction' &&
    protectedEntries.length &&
    (!extractionSources?.length ||
      protectedEntries.some((entry) =>
        entry.clearedAt !== undefined
          ? earliestSourceAt === undefined || earliestSourceAt <= entry.clearedAt
          : !entry.sources.length
      ))
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
  if (
    protectedEntries.some((entry) => entry.clearedAt === undefined) &&
    parts.some((part) => typeof part === 'string' && part.trim())
  )
    invalidEntries()
  return parts
    .map((part) => {
      if (typeof part === 'string')
        return purpose === 'current'
          ? part
              .split('\n')
              .filter((line) => !retiredFacts.has(memoryFactText(line)))
              .join('\n')
          : part
      if (excluded.has(part.id)) return ''
      return (
        JSON.stringify({
          status: part.status,
          text: part.text,
          validFrom: part.validFrom,
          validTo: part.validTo,
          retirement: part.retirement
        }) + '\n'
      )
    })
    .join('')
}

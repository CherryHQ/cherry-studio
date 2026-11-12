import { isDeepStrictEqual } from 'node:util'

import type { SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk'
import * as z from 'zod'

const uuidSchema = z.uuid()
type References = Record<string, string | string[]>

function references(
  metadata: unknown,
  identities: ReadonlySet<string>,
  dropped: ReadonlySet<string> = new Set()
): References {
  if (metadata == null) return {}
  if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('history_corrupt')
  const result: References = {}
  const root = metadata as Record<string, unknown>
  for (const [name, fields] of [
    ['preservedSegment', ['headUuid', 'anchorUuid', 'tailUuid']],
    ['preservedMessages', ['anchorUuid', 'uuids', 'allUuids']]
  ] as const) {
    if (!(name in root)) continue
    const value = root[name]
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('history_corrupt')
    const object = value as Record<string, unknown>
    for (const field of fields) {
      if (!(field in object) && (field === 'allUuids' || dropped.has(`${name}.${field}`))) continue
      const item = object[field]
      const arrayField = field === 'uuids' || field === 'allUuids'
      if (arrayField && (!Array.isArray(item) || (field === 'uuids' && !item.length)))
        throw new Error('history_corrupt')
      const values = arrayField ? (item as unknown[]) : [item]
      for (const ref of values) {
        if (!uuidSchema.safeParse(ref).success) throw new Error('history_corrupt')
        if (!identities.has(ref as string)) throw new Error('unsupported_checkpoint')
      }
      if (field === 'uuids' && new Set(values).size !== values.length) throw new Error('history_corrupt')
      result[`${name}.${field}`] = arrayField ? (values as string[]) : (values[0] as string)
    }
  }
  return result
}

export function validateForkClosure(
  source: SessionStoreEntry[],
  output: SessionStoreEntry[],
  sessionId: string
): Map<string, string> {
  function identities(entries: SessionStoreEntry[]): Set<string> {
    const ids = new Set<string>()
    for (const entry of entries) {
      if (entry.uuid === undefined || entry.uuid === null) continue
      if (!uuidSchema.safeParse(entry.uuid).success || ids.has(entry.uuid)) throw new Error('history_corrupt')
      ids.add(entry.uuid)
    }
    return ids
  }
  const sourceIds = identities(source)
  const outputIds = identities(output)
  const mapping = new Map<string, string>()
  const mappedIds = new Set<string>()
  for (const entry of output) {
    if (entry.forkedFrom === undefined) continue
    const from = entry.forkedFrom
    if (
      !from ||
      typeof from !== 'object' ||
      !('sessionId' in from) ||
      !('messageUuid' in from) ||
      from.sessionId !== sessionId ||
      typeof from.messageUuid !== 'string' ||
      !sourceIds.has(from.messageUuid) ||
      !entry.uuid ||
      mapping.has(from.messageUuid) ||
      mappedIds.has(entry.uuid)
    )
      throw new Error('history_corrupt')
    mapping.set(from.messageUuid, entry.uuid)
    mappedIds.add(entry.uuid)
  }
  const sourceRefs = new Map(source.map((entry) => [entry, references(entry.compactMetadata, sourceIds)]))
  const sourceById = new Map(source.filter((entry) => entry.uuid).map((entry) => [entry.uuid, entry]))
  const reverse = new Map([...mapping].map(([from, to]) => [to, from]))
  const outputRefs = new Map(
    output.map((entry) => {
      const original = sourceRefs.get(sourceById.get(reverse.get(entry.uuid!))!) ?? {}
      return [entry.uuid, references(entry.compactMetadata, outputIds, new Set(Object.keys(original)))]
    })
  )
  for (const entry of source) {
    const refs = sourceRefs.get(entry) ?? {}
    if (!Object.keys(refs).length) continue
    if (!entry.uuid || !mapping.has(entry.uuid)) throw new Error('history_corrupt')
    const copied = outputRefs.get(mapping.get(entry.uuid)) ?? {}
    for (const [key, value] of Object.entries(refs)) {
      const target = copied[key]
      if (target === undefined) throw new Error('unsupported_checkpoint')
      const values = Array.isArray(value) ? value : [value]
      const targets = Array.isArray(target) ? target : [target]
      if (Array.isArray(value) !== Array.isArray(target) || values.length !== targets.length)
        throw new Error('unsupported_checkpoint')
      for (const [index, ref] of values.entries()) {
        const mapped = mapping.get(ref)
        if (!mapped) throw new Error('history_corrupt')
        if (targets[index] !== mapped) throw new Error('unsupported_checkpoint')
      }
    }
  }
  const replacements = (entries: SessionStoreEntry[]) =>
    entries
      .filter((entry) => entry.type === 'content-replacement')
      .flatMap((entry) => (Array.isArray(entry.replacements) ? entry.replacements : []))
  const original = replacements(source)
  const copied = replacements(output)
  if (original.length !== copied.length) throw new Error('unsupported_checkpoint')
  for (const [index, value] of original.entries()) {
    if (!value || typeof value !== 'object' || !copied[index] || typeof copied[index] !== 'object')
      throw new Error('history_corrupt')
    const { messageUuid, ...payload } = value as Record<string, unknown>
    const { messageUuid: target, ...copiedPayload } = copied[index] as Record<string, unknown>
    if (typeof messageUuid !== 'string') throw new Error('history_corrupt')
    if (!mapping.has(messageUuid)) throw new Error('unsupported_checkpoint')
    if (target !== mapping.get(messageUuid) || !isDeepStrictEqual(payload, copiedPayload))
      throw new Error('unsupported_checkpoint')
  }
  return mapping
}

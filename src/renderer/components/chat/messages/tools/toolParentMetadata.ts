import type { CherryMessagePart } from '@shared/data/types/message'

const METADATA_FIELDS = ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata'] as const

interface HistoricalToolMetadataFields {
  providerMetadata?: unknown
  callProviderMetadata?: unknown
  resultProviderMetadata?: unknown
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Persisted provider namespaces can contain opaque legacy fields; this guard checks only their object container.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMetadataRecord(
  part: CherryMessagePart,
  field: (typeof METADATA_FIELDS)[number]
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Container validation leaves historical provider fields untyped; parent readers check the fields they consume.
): Record<string, unknown> | undefined {
  // SAFETY: Historical parts may carry these fields outside the SDK union; the object container is checked below.
  const value = (part as HistoricalToolMetadataFields)[field]

  return isRecord(value) ? value : undefined
}

/** Metadata namespaces that may carry parent linkage: claude's own, then the runtime-neutral one. */
const PARENT_METADATA_NAMESPACES = ['claude-code', 'cherry'] as const

function getParentMetadata(
  part: CherryMessagePart
): { parentToolCallId?: unknown; parentToolUseId?: unknown } | undefined {
  for (const field of METADATA_FIELDS) {
    const metadata = getMetadataRecord(part, field)

    if (!metadata) continue

    for (const namespace of PARENT_METADATA_NAMESPACES) {
      const entry = metadata[namespace]

      if (isRecord(entry) && (entry.parentToolCallId !== undefined || entry.parentToolUseId !== undefined)) {
        return entry
      }
    }
  }

  return undefined
}

export function getPartParentToolCallId(part: CherryMessagePart): string | undefined {
  const direct = 'parentToolUseId' in part ? part.parentToolUseId : undefined

  if (typeof direct === 'string' && direct) return direct

  const parent = getParentMetadata(part)
  const parentToolCallId = parent?.parentToolCallId ?? parent?.parentToolUseId

  return typeof parentToolCallId === 'string' && parentToolCallId ? parentToolCallId : undefined
}

export function hasPartParentToolCallId(part: CherryMessagePart): boolean {
  return !!getPartParentToolCallId(part)
}

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This edit preserves opaque provider namespaces and removes only the two legacy parent-link fields.
function stripParentFields(metadata: Record<string, unknown>): Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Copy-on-write metadata must retain unvalidated namespace values without normalizing or serializing them.
  let next: Record<string, unknown> | undefined

  for (const namespace of PARENT_METADATA_NAMESPACES) {
    const entry = metadata[namespace]

    if (!isRecord(entry)) continue
    const nextEntry = { ...entry }
    delete nextEntry.parentToolCallId
    delete nextEntry.parentToolUseId
    next = { ...(next ?? metadata), [namespace]: nextEntry }
  }

  return next ?? metadata
}

export function stripPartParentToolMetadata(part: CherryMessagePart): CherryMessagePart {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: Only legacy parent metadata is edited; required SDK fields and opaque extensions are retained.
  const source = part as typeof part & Record<string, unknown>
  let next: typeof source | undefined

  if ('parentToolUseId' in source) {
    next = { ...source }
    delete next.parentToolUseId
  }

  for (const field of METADATA_FIELDS) {
    const metadata = getMetadataRecord(part, field)

    if (!metadata || !PARENT_METADATA_NAMESPACES.some((namespace) => isRecord(metadata[namespace]))) continue
    next ??= { ...source }
    // SAFETY: Data/step parts may lack these legacy fields; every field in this view is optional and its value remains unknown.
    const historicalFields = next as HistoricalToolMetadataFields
    historicalFields[field] = stripParentFields(metadata)
  }

  return next ?? source
}

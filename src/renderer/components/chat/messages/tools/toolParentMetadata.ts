import type { CherryMessagePart } from '@shared/data/types/message'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMetadataRecord(part: CherryMessagePart, field: string): Record<string, unknown> | undefined {
  const value = (part as unknown as Record<string, unknown>)[field]
  return isRecord(value) ? value : undefined
}

/** Metadata namespaces that may carry parent linkage: claude's own, then the runtime-neutral one. */
const PARENT_METADATA_NAMESPACES = ['claude-code', 'cherry'] as const

function getParentMetadata(part: CherryMessagePart): Record<string, unknown> | undefined {
  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata']) {
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
  const direct = (part as unknown as { parentToolUseId?: unknown }).parentToolUseId
  if (typeof direct === 'string' && direct) return direct

  const parent = getParentMetadata(part)
  const parentToolCallId = parent?.parentToolCallId ?? parent?.parentToolUseId
  return typeof parentToolCallId === 'string' && parentToolCallId ? parentToolCallId : undefined
}

export function hasPartParentToolCallId(part: CherryMessagePart): boolean {
  return !!getPartParentToolCallId(part)
}

function stripParentFields(metadata: Record<string, unknown>): Record<string, unknown> {
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
  const source = part as unknown as Record<string, unknown>
  let next: Record<string, unknown> | undefined

  if ('parentToolUseId' in source) {
    next = { ...source }
    delete next.parentToolUseId
  }

  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata']) {
    const metadata = getMetadataRecord(part, field)
    if (!metadata || !PARENT_METADATA_NAMESPACES.some((namespace) => isRecord(metadata[namespace]))) continue
    next ??= { ...source }
    next[field] = stripParentFields(metadata)
  }

  return (next ?? source) as unknown as CherryMessagePart
}

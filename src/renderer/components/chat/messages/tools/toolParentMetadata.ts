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

/** The launch root tool-call id stamped onto a SendMessage receipt by the adapter. */
export function getPartLaunchToolCallId(part: CherryMessagePart): string | undefined {
  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata']) {
    const metadata = getMetadataRecord(part, field)
    const entry = metadata?.cherry
    if (isRecord(entry) && typeof entry.launchToolCallId === 'string') return entry.launchToolCallId
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

/** The SendMessage call id that resumed this part's round, when the runtime tagged it. */
export function getPartResumeMarker(part: CherryMessagePart): string | undefined {
  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata']) {
    const metadata = getMetadataRecord(part, field)
    const entry = metadata?.cherry
    if (isRecord(entry) && typeof entry.resumedViaCallId === 'string') return entry.resumedViaCallId
  }
  return undefined
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

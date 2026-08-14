import type { CherryMessagePart } from '@shared/data/types/message'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getMetadataRecord(part: CherryMessagePart, field: string): Record<string, unknown> | undefined {
  const value = (part as unknown as Record<string, unknown>)[field]
  return isRecord(value) ? value : undefined
}

function getClaudeCodeMetadata(part: CherryMessagePart): Record<string, unknown> | undefined {
  for (const field of ['providerMetadata', 'callProviderMetadata', 'resultProviderMetadata']) {
    const metadata = getMetadataRecord(part, field)
    const claudeCode = metadata?.['claude-code']
    if (isRecord(claudeCode)) return claudeCode
  }
  return undefined
}

export function getPartParentToolCallId(part: CherryMessagePart): string | undefined {
  const direct = (part as unknown as { parentToolUseId?: unknown }).parentToolUseId
  if (typeof direct === 'string' && direct) return direct

  const claudeCode = getClaudeCodeMetadata(part)
  const parentToolCallId = claudeCode?.parentToolCallId ?? claudeCode?.parentToolUseId
  return typeof parentToolCallId === 'string' && parentToolCallId ? parentToolCallId : undefined
}

export function hasPartParentToolCallId(part: CherryMessagePart): boolean {
  return !!getPartParentToolCallId(part)
}

function stripParentFields(metadata: Record<string, unknown>): Record<string, unknown> {
  const claudeCode = metadata['claude-code']
  if (!isRecord(claudeCode)) return metadata

  const nextClaudeCode = { ...claudeCode }
  delete nextClaudeCode.parentToolCallId
  delete nextClaudeCode.parentToolUseId

  return {
    ...metadata,
    'claude-code': nextClaudeCode
  }
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
    if (!metadata || !isRecord(metadata['claude-code'])) continue
    next ??= { ...source }
    next[field] = stripParentFields(metadata)
  }

  return (next ?? source) as unknown as CherryMessagePart
}

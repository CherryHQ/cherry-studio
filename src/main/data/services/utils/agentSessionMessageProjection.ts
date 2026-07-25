import type { CherryMessagePart } from '@shared/data/types/message'
import type { DeferredToolResultRef } from '@shared/data/types/uiParts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function omitClaudeCodeRawPayload(metadata: unknown): unknown {
  if (!isRecord(metadata)) return metadata
  const claudeCode = metadata['claude-code']
  if (!isRecord(claudeCode) || (!('rawInput' in claudeCode) && !('rawResult' in claudeCode))) return metadata

  const projectedClaudeCode = { ...claudeCode }
  delete projectedClaudeCode.rawInput
  delete projectedClaudeCode.rawResult
  return {
    ...metadata,
    'claude-code': projectedClaudeCode
  }
}

export function withDeferredToolResultRef(
  metadata: unknown,
  deferredToolResult: DeferredToolResultRef
): Record<string, unknown> {
  const source = isRecord(metadata) ? metadata : {}
  const cherry = isRecord(source.cherry) ? source.cherry : {}
  return {
    ...source,
    cherry: {
      ...cherry,
      deferredToolResult
    }
  }
}

export function projectAgentMessagePartForRenderer(part: CherryMessagePart, messageId?: string): CherryMessagePart {
  const source = part as unknown as Record<string, unknown>
  const callProviderMetadata = omitClaudeCodeRawPayload(source.callProviderMetadata)
  let resultProviderMetadata = omitClaudeCodeRawPayload(source.resultProviderMetadata)
  const toolCallId = typeof source.toolCallId === 'string' && source.toolCallId ? source.toolCallId : undefined
  const isErrorResult = source.state === 'output-error'
  const resultKind = isErrorResult ? 'error' : 'output'
  const shouldDeferResult = !!messageId && !!toolCallId && (isErrorResult || 'output' in source)

  if (shouldDeferResult) {
    resultProviderMetadata = withDeferredToolResultRef(resultProviderMetadata, {
      messageId,
      toolCallId,
      kind: resultKind
    })
  }

  if (
    (!shouldDeferResult || (!('output' in source) && !isErrorResult)) &&
    callProviderMetadata === source.callProviderMetadata &&
    resultProviderMetadata === source.resultProviderMetadata
  ) {
    return part
  }

  return {
    ...source,
    ...(shouldDeferResult && 'output' in source ? { output: '' } : {}),
    ...(shouldDeferResult && isErrorResult ? { errorText: '' } : {}),
    ...(callProviderMetadata !== source.callProviderMetadata ? { callProviderMetadata } : {}),
    ...(resultProviderMetadata !== source.resultProviderMetadata ? { resultProviderMetadata } : {})
  } as unknown as CherryMessagePart
}

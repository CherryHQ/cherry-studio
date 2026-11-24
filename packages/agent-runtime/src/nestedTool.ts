import type { RuntimeMessage } from './contracts'

export interface NestedToolRecord {
  id: string
  name: string
  parentToolCallId?: string
  arguments?: unknown
  argumentsBytes?: number
  result?: unknown
  resultBytes?: number
  status: 'ok' | 'error' | 'unfinished'
  error?: string
}

/** Retained native evidence, including explicit absence of legacy or over-budget payloads. */
export function projectNestedTool(record: NestedToolRecord): RuntimeMessage['parts'][number] {
  const metadata = {
    pi: {
      parentToolCallId: record.parentToolCallId ?? '',
      nested: true,
      argumentsOmitted: record.arguments === undefined,
      resultOmitted: record.result === undefined
    }
  }
  const base = {
    type: 'dynamic-tool' as const,
    toolName: record.name,
    toolCallId: record.id,
    input: record.arguments,
    callProviderMetadata: metadata
  }
  return record.status === 'ok'
    ? {
        ...base,
        state: 'output-available',
        output: record.result ?? { content: [{ type: 'text', text: 'Tool completed; result was not retained.' }] }
      }
    : {
        ...base,
        state: 'output-error',
        errorText:
          record.error || (record.status === 'unfinished' ? 'Tool execution was interrupted.' : 'Tool failed.'),
        ...(record.result !== undefined && {
          resultProviderMetadata: { pi: { result: JSON.parse(JSON.stringify(record.result)) } }
        })
      }
}

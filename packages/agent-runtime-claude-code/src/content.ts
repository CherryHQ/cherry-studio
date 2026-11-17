import type { SDKAssistantMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import type { RuntimeMessage } from '@cherrystudio/agent-runtime'

export type NativeBlock =
  | SDKAssistantMessage['message']['content'][number]
  | Exclude<SDKUserMessage['message']['content'], string>[number]
type Part = RuntimeMessage['parts'][number]
type Metadata = NonNullable<Extract<Part, { type: 'text' }>['providerMetadata']>
export type ToolResult = { toolUseId: string; output: unknown; errorText?: string }
export type ProjectedBlock = { type: NativeBlock['type']; part: Part } | { result: ToolResult }

export function json(value: unknown): Metadata[string][string] {
  return JSON.parse(JSON.stringify(value)) as Metadata[string][string]
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function textPart(text: string, partial: boolean, citations?: unknown): Part {
  return {
    type: 'text',
    text,
    state: partial ? 'streaming' : 'done',
    ...(citations != null && { providerMetadata: { anthropic: { citations: json(citations) } } })
  }
}

function reasoningPart(text: string, partial: boolean, metadata: Metadata['anthropic']): Part {
  return { type: 'reasoning', text, state: partial ? 'streaming' : 'done', providerMetadata: { anthropic: metadata } }
}

function toolPart(
  type: Extract<NativeBlock, { id: string }>['type'],
  id: string,
  name: string,
  input: unknown,
  partial: boolean,
  serverName?: string
): Part {
  return {
    type: 'dynamic-tool',
    toolCallId: id,
    toolName: name,
    input: input ?? {},
    state: partial ? 'input-streaming' : 'input-available',
    callProviderMetadata: { anthropic: { type, ...(serverName !== undefined && { serverName }) } }
  }
}

function toolResult(toolUseId: string, output: unknown, isError = false): ToolResult {
  const errorType = object(output)?.type
  const failed = isError || (typeof errorType === 'string' && errorType.endsWith('_error'))
  const errorText = !failed
    ? undefined
    : typeof output === 'string'
      ? output
      : Array.isArray(output)
        ? output
            .filter((part: unknown) => object(part)?.type === 'text')
            .map((part: unknown) => object(part)?.text)
            .join('\n')
        : JSON.stringify(output)
  return { toolUseId, output, errorText }
}

function filePart(mediaType: string, url: string): Part {
  return { type: 'file', mediaType, url }
}

export function projectBlock(block: NativeBlock, partial: boolean): ProjectedBlock | undefined {
  const type = block.type
  switch (block.type) {
    case 'text':
      return { type, part: textPart(block.text, partial, block.citations) }
    case 'thinking':
      return { type, part: reasoningPart(block.thinking, partial, { signature: block.signature }) }
    case 'redacted_thinking':
      return { type, part: reasoningPart('', partial, { redactedData: block.data }) }
    case 'tool_use':
    case 'server_tool_use':
    case 'mcp_tool_use':
      return {
        type,
        part: toolPart(
          block.type,
          block.id,
          block.name,
          block.input,
          partial,
          'server_name' in block ? block.server_name : undefined
        )
      }
    case 'tool_result':
    case 'mcp_tool_result':
    case 'web_search_tool_result':
    case 'web_fetch_tool_result':
    case 'advisor_tool_result':
    case 'code_execution_tool_result':
    case 'bash_code_execution_tool_result':
    case 'text_editor_code_execution_tool_result':
    case 'tool_search_tool_result':
      return {
        type: block.type,
        result: toolResult(block.tool_use_id, block.content ?? '', 'is_error' in block && block.is_error === true)
      }
    case 'image':
    case 'document': {
      const source = block.source
      const mediaType =
        'media_type' in source ? source.media_type : block.type === 'image' ? 'image/*' : 'application/pdf'
      switch (source.type) {
        case 'url':
          return { type, part: filePart(mediaType, source.url) }
        case 'base64':
          return { type, part: filePart(mediaType, `data:${mediaType};base64,${source.data}`) }
        case 'text':
          return {
            type,
            part: filePart(mediaType, `data:${mediaType};base64,${Buffer.from(source.data).toString('base64')}`)
          }
        case 'content':
          return undefined
        default: {
          const exhaustive: never = source
          void exhaustive
          return undefined
        }
      }
    }
    // These native references/control blocks have no resolved public display part.
    case 'search_result':
    case 'container_upload':
    case 'compaction':
      return undefined
    default: {
      const exhaustive: never = block
      void exhaustive
      return undefined
    }
  }
}

/** Decode only fields the projection consumes; do not assert an archive payload is a complete SDK message. */
export function decodeArchiveContent(
  value: unknown,
  partial: boolean
):
  | {
      id?: string
      blocks: (ProjectedBlock | undefined)[]
    }
  | undefined {
  const body = object(value)
  if (!body) return undefined
  const content = typeof body.content === 'string' ? [{ type: 'text', text: body.content }] : body.content
  if (!Array.isArray(content)) return undefined
  return {
    id: typeof body.id === 'string' ? body.id : undefined,
    blocks: content.map((value: unknown): ProjectedBlock | undefined => {
      const block = object(value)
      if (!block) return undefined
      switch (block.type) {
        case 'text':
          return typeof block.text === 'string'
            ? { type: block.type, part: textPart(block.text, partial, block.citations) }
            : undefined
        case 'thinking':
          return typeof block.thinking === 'string'
            ? {
                type: block.type,
                part: reasoningPart(
                  block.thinking,
                  partial,
                  typeof block.signature === 'string' ? { signature: block.signature } : {}
                )
              }
            : undefined
        case 'redacted_thinking':
          return typeof block.data === 'string'
            ? { type: block.type, part: reasoningPart('', partial, { redactedData: block.data }) }
            : undefined
        case 'tool_use':
        case 'server_tool_use':
        case 'mcp_tool_use':
          return typeof block.id === 'string' && typeof block.name === 'string'
            ? {
                type: block.type,
                part: toolPart(
                  block.type,
                  block.id,
                  block.name,
                  block.input,
                  partial,
                  typeof block.server_name === 'string' ? block.server_name : undefined
                )
              }
            : undefined
        case 'tool_result':
        case 'mcp_tool_result':
        case 'web_search_tool_result':
        case 'web_fetch_tool_result':
        case 'advisor_tool_result':
        case 'code_execution_tool_result':
        case 'bash_code_execution_tool_result':
        case 'text_editor_code_execution_tool_result':
        case 'tool_search_tool_result':
          return typeof block.tool_use_id === 'string'
            ? { result: toolResult(block.tool_use_id, block.content ?? '', block.is_error === true) }
            : undefined
        case 'image':
        case 'document': {
          const source = object(block.source)
          if (!source) return undefined
          const mediaType =
            typeof source.media_type === 'string'
              ? source.media_type
              : block.type === 'image'
                ? 'image/*'
                : 'application/pdf'
          if (source.type === 'url' && typeof source.url === 'string')
            return { type: block.type, part: filePart(mediaType, source.url) }
          if ((source.type === 'base64' || source.type === 'text') && typeof source.data === 'string') {
            const data = source.type === 'base64' ? source.data : Buffer.from(source.data).toString('base64')
            return { type: block.type, part: filePart(mediaType, `data:${mediaType};base64,${data}`) }
          }
          return undefined
        }
        case 'search_result':
        case 'container_upload':
        case 'compaction':
          return undefined
        default:
          return undefined
      }
    })
  }
}

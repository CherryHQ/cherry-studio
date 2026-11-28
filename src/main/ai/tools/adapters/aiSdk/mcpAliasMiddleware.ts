import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware, ToolSet } from 'ai'

import { resolveRequestToolName } from './toolNameAlias'

/** Canonicalize before the SDK creates streaming UI parts or approval records. */
export function createMcpAliasMiddleware(inline: ToolSet, catalog: ToolSet): LanguageModelMiddleware {
  const allowed = new Set(Object.keys(catalog))
  const directName = (name: string): string => {
    if (inline[name]) return name
    try {
      const resolved = resolveRequestToolName(name, allowed, (key) => catalog[key])
      return inline[resolved] ? resolved : name
    } catch {
      // Repair reports the request-scoped reason; never choose an ambiguous server here.
      return name
    }
  }
  const canonicalCall = <T extends { toolName: string; input: string }>(call: T): T => {
    const toolName = directName(call.toolName)
    if (toolName !== 'tool_invoke') return toolName === call.toolName ? call : { ...call, toolName }
    try {
      const input: unknown = JSON.parse(call.input)
      if (!input || typeof input !== 'object' || !('name' in input) || typeof input.name !== 'string') return call
      const name = resolveRequestToolName(input.name, allowed, (key) => catalog[key])
      return name === input.name ? call : { ...call, input: JSON.stringify({ ...input, name }) }
    } catch {
      return call
    }
  }
  return {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      const result = await doGenerate()
      return {
        ...result,
        content: result.content.map((part) => (part.type === 'tool-call' ? canonicalCall(part) : part))
      }
    },
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
            transform(part, controller) {
              if (part.type === 'tool-input-start') {
                controller.enqueue({ ...part, toolName: directName(part.toolName) })
              } else if (part.type === 'tool-call') {
                controller.enqueue(canonicalCall(part))
              } else {
                controller.enqueue(part)
              }
            }
          })
        )
      }
    }
  }
}

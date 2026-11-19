import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { DynamicToolUIPart } from 'ai'
import * as z from 'zod'

import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { REPORT_ARTIFACTS_TOOL_NAME, reportArtifactsInputSchema } from '@shared/ai/builtinTools'
import { PI_TOOL_CALL_TOOL_NAME, PI_TOOL_EXEC_TOOL_NAME, PI_TOOL_SEARCH_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { Serializable } from '@shared/types/serializable'

/** pi transport tag consumed by the renderer's tool-part routing (D8). */
export const PI_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.pi.transport

const CHERRY_SERVER_NAMES = new Map<string, string>(
  Object.values(CHERRY_MCP_SERVER).map((name) => [name.replaceAll('-', '_'), name])
)

const nestedCallsSchema = z.object({
  nestedCalls: z.object({
    calls: z.array(
      z.object({ id: z.string(), name: z.string(), status: z.string(), arguments: z.unknown().optional() })
    )
  })
})

const toolContentSchema = z.looseObject({ content: z.array(z.unknown()) })
const textContentSchema = z.array(z.object({ type: z.literal('text'), text: z.string() }))

export function resolvePiMcpToolMetadata(
  definition: ToolDefinition | undefined,
  snapshots: ReadonlyMap<string, Pick<McpServer, 'id' | 'name'> | undefined>
) {
  if (!definition?.namespace?.name.startsWith('mcp__')) return undefined
  const separator = definition.label.indexOf('/')
  if (separator < 0) return undefined
  const serverId = definition.label.slice(0, separator)
  const server = [...snapshots.values()].find((candidate) => candidate?.id === serverId)
  return {
    type: 'mcp' as const,
    name: definition.label.slice(separator + 1),
    serverId,
    serverName: server?.name ?? serverId
  }
}

function toolProviderMetadata(toolName: string, nativeTool?: ReturnType<typeof resolvePiMcpToolMetadata>) {
  const parsed = parseFunctionCallToolName(toolName)
  const serverName = parsed ? (CHERRY_SERVER_NAMES.get(parsed.serverPart) ?? parsed.serverPart) : undefined
  return {
    cherry: {
      transport: PI_TRANSPORT,
      tool:
        nativeTool ??
        (parsed
          ? {
              type: 'mcp' as const,
              name: parsed.toolPart,
              serverId: serverName,
              serverName
            }
          : { type: 'builtin' as const, name: toolName })
    },
    pi: { toolName }
  }
}

/** Cherry tool display metadata; content accumulation belongs to the runtime adapter. */
export class PiMessageMetadata {
  constructor(private readonly resolveToolMetadata?: (name: string) => ReturnType<typeof resolvePiMcpToolMetadata>) {}

  decorate(message: CherryUIMessage): CherryUIMessage {
    const artifacts: CherryUIMessage['parts'] = []
    const existingCalls = new Set(
      message.parts.flatMap((part) => (part.type === 'dynamic-tool' ? [part.toolCallId] : []))
    )
    for (const part of message.parts) {
      if (part.type !== 'dynamic-tool') continue
      const result =
        part.state === 'output-available'
          ? part.output
          : part.state === 'output-error'
            ? part.resultProviderMetadata?.pi?.result
            : undefined
      const nested = nestedCallsSchema.safeParse(result)
      if (!nested.success) continue
      for (const call of nested.data.nestedCalls.calls) {
        if (call.status !== 'ok' || existingCalls.has(call.id)) continue
        const metadata = toolProviderMetadata(call.name, this.resolveToolMetadata?.(call.name))
        const tool = metadata.cherry.tool
        if (tool.type !== 'mcp' || tool.serverName !== 'cherry-tools' || tool.name !== REPORT_ARTIFACTS_TOOL_NAME)
          continue
        const input = reportArtifactsInputSchema.safeParse(call.arguments)
        if (!input.success) continue
        existingCalls.add(call.id)
        artifacts.push({
          type: 'dynamic-tool',
          toolName: call.name,
          toolCallId: call.id,
          state: 'output-available',
          input: input.data,
          output: null,
          providerExecuted: true,
          callProviderMetadata: metadata,
          resultProviderMetadata: metadata
        })
      }
    }
    return {
      ...message,
      parts: [
        ...message.parts.map((part) => (part.type === 'dynamic-tool' ? this.decorateToolPart(part) : part)),
        ...artifacts
      ]
    }
  }

  private decorateToolPart(part: DynamicToolUIPart): DynamicToolUIPart {
    const metadata = toolProviderMetadata(part.toolName, this.resolveToolMetadata?.(part.toolName))
    const decoration = {
      providerExecuted: true,
      callProviderMetadata: { ...metadata, pi: { ...part.callProviderMetadata?.pi, ...metadata.pi } }
    }
    if (part.state !== 'output-available') return { ...part, ...decoration }

    const toolName = part.toolName
    const result = part.output
    const toolResult = hasToolContent(result) ? result : undefined
    let output = result ?? null
    if (toolResult) {
      if (toolName === PI_TOOL_EXEC_TOOL_NAME) output = unwrapMcpContent(toolResult)
      else if (toolName === PI_TOOL_SEARCH_TOOL_NAME || toolName === 'tool_exec') {
        output = toolResult.details ?? toolResult
      } else if (toolName.startsWith('mcp__')) {
        const mcpResult = toolResult.structuredContent
        // The automation card renders the REPL's content blocks; its structuredContent is metadata only.
        if (toolName.startsWith('mcp__automation__')) {
          output = mcpResult ?? toolResult
        } else {
          const structuredContent =
            typeof mcpResult === 'object' && mcpResult !== null && 'structuredContent' in mcpResult
              ? mcpResult.structuredContent
              : undefined
          output = structuredContent ?? unwrapMcpContent(toolResult)
        }
      } else {
        output = toolName === PI_TOOL_CALL_TOOL_NAME ? unwrapMcpContent(toolResult) : toolResult
      }
    }
    return { ...part, ...decoration, output, resultProviderMetadata: metadata }
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native Pi events and saved tool outputs have no validated result type; only claim the consumed content envelope.
function hasToolContent(result: unknown): result is z.infer<typeof toolContentSchema> {
  return toolContentSchema.safeParse(result).success
}

/** Unwrap all-text MCP results so tool cards and citation resolution see the same shape across runtimes. */
function unwrapMcpContent({ content }: z.infer<typeof toolContentSchema>): Serializable | unknown[] {
  const parsed = textContentSchema.safeParse(content)
  if (!parsed.success) return content
  const text = parsed.data.map((block) => block.text).join('\n')
  try {
    // SAFETY: Native JSON parsing validates the grammar and constructs only serializable values.
    return JSON.parse(text) as Serializable
  } catch {
    return text
  }
}

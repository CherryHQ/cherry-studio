import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent'

import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { PI_TOOL_CALL_TOOL_NAME, PI_TOOL_EXEC_TOOL_NAME, PI_TOOL_SEARCH_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { CherryUIMessage } from '@shared/data/types/message'

/** pi transport tag consumed by the renderer's tool-part routing (D8). */
export const PI_TRANSPORT = AGENT_RUNTIME_CAPABILITIES.pi.transport

const CHERRY_SERVER_NAMES = new Map<string, string>(
  Object.values(CHERRY_MCP_SERVER).map((name) => [name.replaceAll('-', '_'), name])
)

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
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type !== 'dynamic-tool') return part
        const metadata = toolProviderMetadata(part.toolName, this.resolveToolMetadata?.(part.toolName))
        const decoration = {
          providerExecuted: true,
          callProviderMetadata: metadata
        }
        return part.state === 'output-available'
          ? {
              ...part,
              ...decoration,
              output: projectPiToolOutput(part.toolName, part.output),
              resultProviderMetadata: metadata
            }
          : { ...part, ...decoration }
      })
    }
  }
}

type PiToolContent = AgentToolResult<unknown>['content'][number]

function isTextContent(block: PiToolContent): block is Extract<PiToolContent, { type: 'text' }> {
  return block.type === 'text'
}

/** pi types `tool_execution_end`'s `result` as `any`, and its builtins may return a bare string. */
function asToolResult(result: unknown): AgentToolResult<unknown> | undefined {
  const candidate = result as AgentToolResult<unknown> | undefined
  return candidate && Array.isArray(candidate.content) ? candidate : undefined
}

function projectPiToolOutput(toolName: string, result: unknown): unknown {
  const toolResult = asToolResult(result)
  if (!toolResult) return result ?? null
  if (toolName === PI_TOOL_EXEC_TOOL_NAME) return unwrapMcpContent(toolResult)
  if (toolName === PI_TOOL_SEARCH_TOOL_NAME || toolName === 'tool_exec') {
    return toolResult.details ?? toolResult
  }
  if (toolName.startsWith('mcp__')) {
    const mcpResult = toolResult.structuredContent as { structuredContent?: unknown } | undefined
    // The automation card renders the REPL's content blocks; its structuredContent is metadata only.
    if (toolName.startsWith('mcp__automation__')) return mcpResult ?? toolResult
    return mcpResult?.structuredContent ?? unwrapMcpContent(toolResult)
  }
  return toolName === PI_TOOL_CALL_TOOL_NAME ? unwrapMcpContent(toolResult) : toolResult
}

/** Unwrap all-text MCP results so tool cards and citation resolution see the same shape across runtimes. */
function unwrapMcpContent({ content }: AgentToolResult<unknown>): unknown {
  if (!content.every(isTextContent)) return content
  const text = content.map((block) => block.text).join('\n')
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

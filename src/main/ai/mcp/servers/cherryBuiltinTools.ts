/**
 * In-process MCP server exposing Cherry Studio's builtin tools to Claude Code.
 *
 * Wraps the same `webLookup` / painting cores the AI-SDK builtin tools use, so
 * Claude Code's web search/fetch and image generation run identical logic against
 * the user's configured `WebSearchService` provider and painting model. Injected by
 * `settingsBuilder` as an `sdk`-type MCP server; Claude calls these tools as
 * `mcp__cherry-tools__web_search`, `…__web_fetch`, `…__report_artifacts`, and
 * `…__generate_image`.
 *
 * These stateless builtins carry no per-agent authorization, so their handlers take
 * only `(args, signal)`. Domain tools that act on behalf of the session's agent are
 * split into sibling providers this server merely aggregates and dispatches to by
 * protocol — it stays unaware of their domain logic:
 * - {@link CherryAutonomyTools} (`…__cron`, `…__notify`, `…__config`) — schedules,
 *   notifies, and self-configures the agent.
 * - {@link CherryKnowledgeTools} (`…__kb_search`, `…__kb_read`, `…__kb_list`,
 *   `…__kb_manage`) — owns knowledge-base exposure and per-call scope authorization.
 *
 * Both act on the session's agent via the {@link CherryAgentContext} passed at
 * construction.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { buildGenerateImageToolSchema, type GenerateImageToolInput } from '@main/ai/tools/generateImageTool'
import {
  type ConfiguredPaintingModel,
  GENERATE_IMAGE_DESCRIPTION,
  generateImageFromPrompt,
  isPaintingError,
  paintingModelOutput,
  resolveConfiguredPaintingModel
} from '@main/ai/tools/painting'
import {
  fetchWeb,
  searchWeb,
  WEB_FETCH_DESCRIPTION,
  WEB_SEARCH_DESCRIPTION,
  webLookupModelOutput
} from '@main/ai/tools/webLookup'
import { isAbortError } from '@main/utils/error'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import {
  GENERATE_IMAGE_TOOL_NAME,
  REPORT_ARTIFACTS_DESCRIPTION,
  REPORT_ARTIFACTS_TOOL_NAME,
  reportArtifactsInputSchema,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  webFetchInputSchema,
  webSearchInputSchema
} from '@shared/ai/builtinTools'
import * as z from 'zod'

import { type CherryAgentContext, CherryAutonomyTools } from './cherryAutonomyTools'
import { CherryKnowledgeTools } from './cherryKnowledgeTools'

export type { CherryAgentContext }

const logger = loggerService.withContext('McpServer:CherryBuiltinTools')

type McpImageBlock = { data: string; mimeType: string }
type ToolModelOutput =
  | { type: 'text'; value: string }
  | { type: 'json'; value: unknown }
  // `value` is the model-facing summary; `images` are inline image content blocks (base64) so the
  // agent transcript carries the actual picture — the renderer's agent card shows them inline, and
  // the model can see what it produced. Only generate_image uses this.
  | { type: 'text+images'; value: string; images: McpImageBlock[] }

interface ToolHandler {
  description: string
  inputSchema: z.ZodType
  // `signal` is honoured only by handlers whose core supports cancellation (web → WebSearchService).
  run: (args: unknown, signal: AbortSignal) => Promise<ToolModelOutput>
}

const HANDLERS: Record<string, ToolHandler> = {
  [WEB_SEARCH_TOOL_NAME]: {
    description: WEB_SEARCH_DESCRIPTION,
    inputSchema: webSearchInputSchema,
    run: async (args, signal) => {
      const { query } = webSearchInputSchema.parse(args)
      return webLookupModelOutput(await searchWeb(query, signal))
    }
  },
  [WEB_FETCH_TOOL_NAME]: {
    description: WEB_FETCH_DESCRIPTION,
    inputSchema: webFetchInputSchema,
    run: async (args, signal) => {
      const { urls } = webFetchInputSchema.parse(args)
      return webLookupModelOutput(await fetchWeb(urls, signal))
    }
  },
  // Pure declaration tool: the model reports its final deliverable file(s). The value lives in the
  // tool *input* — a data contract for a consumer (a renderer artifacts card) that lands in a
  // separate change; the handler only confirms.
  [REPORT_ARTIFACTS_TOOL_NAME]: {
    description: REPORT_ARTIFACTS_DESCRIPTION,
    inputSchema: reportArtifactsInputSchema,
    run: async (args) => {
      const { artifacts } = reportArtifactsInputSchema.parse(args)
      return { type: 'text', value: `Recorded ${artifacts.length} artifact(s).` }
    }
  }
}

function createGenerateImageHandler(configuredModel: ConfiguredPaintingModel | null): ToolHandler {
  const inputSchema = buildGenerateImageToolSchema(configuredModel?.support)
  return {
    description: GENERATE_IMAGE_DESCRIPTION,
    inputSchema,
    run: async (args, signal) => {
      const input = inputSchema.parse(args) as GenerateImageToolInput
      const result = await generateImageFromPrompt(input, signal, configuredModel)
      const text = paintingModelOutput(result).value
      // On failure `result` is the model-facing note — text only, no image to attach.
      if (isPaintingError(result)) return { type: 'text', value: text }
      const images = await readGeneratedImages(result, signal)
      return images.length > 0 ? { type: 'text+images', value: text, images } : { type: 'text', value: text }
    }
  }
}

function resolveHandlers(): Record<string, ToolHandler> {
  return {
    ...HANDLERS,
    [GENERATE_IMAGE_TOOL_NAME]: createGenerateImageHandler(resolveConfiguredPaintingModel())
  }
}

function resolveHandler(name: string): ToolHandler | undefined {
  return name === GENERATE_IMAGE_TOOL_NAME
    ? createGenerateImageHandler(resolveConfiguredPaintingModel())
    : HANDLERS[name]
}

/**
 * Read the just-persisted generated images back as base64 image content blocks. Unlike the AI-SDK
 * builtin (whose renderer resolves the returned FileEntry ids to `file://` URLs), MCP tool results
 * only carry `content[]` to the agent renderer — the structured id array is dropped at the SDK
 * boundary — so the picture must ride along as inline base64. A read failure drops that one image
 * rather than failing the whole generation.
 */
async function readGeneratedImages(files: { id: string }[], signal: AbortSignal): Promise<McpImageBlock[]> {
  const fileManager = application.get('FileManager')
  const blocks: McpImageBlock[] = []
  for (const file of files) {
    if (signal.aborted) break
    try {
      const { content, mime } = await fileManager.read(file.id, { encoding: 'base64' })
      blocks.push({ data: content, mimeType: mime })
    } catch (error) {
      logger.warn('Failed to read generated image for inline rendering', { id: file.id, error })
    }
  }
  return blocks
}

/** Drop the `$schema` marker so strict MCP clients don't reject the advertised input schema. */
function toMcpInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

function toMcpResult(output: ToolModelOutput): CallToolResult {
  if (output.type === 'text+images') {
    return {
      content: [
        { type: 'text', text: output.value },
        ...output.images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }))
      ]
    }
  }
  const text = output.type === 'text' ? output.value : JSON.stringify(output.value)
  return { content: [{ type: 'text', text }] }
}

/** List the stateless builtin tools (web / report / image); domain tools live in their providers. */
export function listCherryBuiltinTools(): Tool[] {
  return Object.entries(resolveHandlers()).map(([name, handler]) => ({
    name,
    description: handler.description,
    inputSchema: toMcpInputSchema(handler.inputSchema)
  }))
}

export async function callCherryBuiltinTool(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
  const handler = resolveHandler(name)
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  try {
    return toMcpResult(await handler.run(args ?? {}, signal))
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error('cherry-tools call failed', normalizedError, { tool: name })
    const message = normalizedError.message
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
  }
}

export class CherryBuiltinToolsServer {
  public mcpServer: McpServer

  constructor(agentContext: CherryAgentContext) {
    const autonomy = new CherryAutonomyTools(agentContext)
    const knowledge = new CherryKnowledgeTools(agentContext)
    this.mcpServer = new McpServer({ name: 'cherry-tools', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...listCherryBuiltinTools(), ...knowledge.tools(), ...autonomy.tools()]
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name } = request.params
      if (autonomy.handles(name)) {
        return autonomy.call(name, (request.params.arguments ?? {}) as Record<string, string | undefined>)
      }
      if (knowledge.handles(name)) {
        return knowledge.call(name, request.params.arguments)
      }
      return callCherryBuiltinTool(name, request.params.arguments, extra.signal)
    })
  }
}

export default CherryBuiltinToolsServer

/**
 * In-process MCP server exposing Cherry Studio's builtin tools to Claude Code.
 *
 * Wraps the same `webLookup` / `knowledgeLookup` cores the AI-SDK builtin tools
 * use, so Claude Code's web search/fetch and knowledge-base tools run identical
 * logic against the user's configured `WebSearchService` provider and knowledge
 * bases. Injected by `settingsBuilder` as an `sdk`-type MCP server; Claude calls
 * these tools as `mcp__cherry-tools__web_search`, `…__web_fetch`, `…__kb_search`,
 * `…__kb_read`, `…__kb_list`, `…__kb_manage`, `…__report_artifacts`, and
 * `…__generate_image`.
 *
 * KB scope comes from the agent's bound knowledge bases (`CherryAgentContext.
 * getKnowledgeBaseIds()`), mirroring the assistant path: the kb_* tools are exposed
 * only when the agent has at least one bound base, and their lookups are scoped
 * to those bases. The live binding is re-read for each tool listing and builtin
 * tool call so narrowing the scope takes effect without waiting for a running
 * session to rebuild. An agent with no bound bases sees no kb_* tools at all. The
 * destructive `kb_manage` tool relies on Claude Code's own per-call permission
 * prompt for approval (the AI-SDK path uses the tool's `needsApproval` instead).
 *
 * The server also hosts the agent autonomy tools (`…__cron`, `…__notify`,
 * `…__config` — see `cherryAutonomyTools.ts`), which act on behalf of the
 * session's agent via the {@link CherryAgentContext} passed at construction.
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { buildGenerateImageToolSchema, type GenerateImageToolInput } from '@main/ai/tools/generateImageTool'
import {
  KNOWLEDGE_LIST_DESCRIPTION,
  KNOWLEDGE_MANAGE_DESCRIPTION,
  KNOWLEDGE_READ_DESCRIPTION,
  KNOWLEDGE_SEARCH_DESCRIPTION,
  knowledgeListModelOutput,
  knowledgeManageModelOutput,
  knowledgeReadModelOutput,
  knowledgeSearchModelOutput,
  listOrOutlineKnowledge,
  manageKnowledge,
  readOrGrepConcept,
  searchKnowledge
} from '@main/ai/tools/knowledgeLookup'
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
  KB_LIST_TOOL_NAME,
  KB_MANAGE_TOOL_NAME,
  KB_READ_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbListInputSchema,
  kbManageInputSchema,
  kbReadInputSchema,
  kbSearchInputSchema,
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
  /** This handler is unavailable unless the agent has at least one bound knowledge base. */
  requiresKnowledgeScope?: true
  // `signal` is honoured only by handlers whose core supports cancellation (web → WebSearchService).
  // The kb handlers ignore it: KnowledgeService exposes no AbortSignal plumbing (see knowledgeLookup).
  // `allowedIds` scopes the kb handlers to the agent's bound knowledge bases (non-kb handlers ignore it).
  run: (args: unknown, signal: AbortSignal, allowedIds: string[]) => Promise<ToolModelOutput>
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
  // kb handlers take no `signal`: KnowledgeService has no cancellation plumbing (see knowledgeLookup).
  [KB_SEARCH_TOOL_NAME]: {
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    inputSchema: kbSearchInputSchema,
    requiresKnowledgeScope: true,
    run: async (args, _signal, allowedIds) => {
      const { query, baseIds } = kbSearchInputSchema.parse(args)
      return knowledgeSearchModelOutput(await searchKnowledge(query, baseIds, allowedIds))
    }
  },
  // kb_read has two modes (read the document / grep it for `pattern`); readOrGrepConcept routes by `pattern`.
  [KB_READ_TOOL_NAME]: {
    description: KNOWLEDGE_READ_DESCRIPTION,
    inputSchema: kbReadInputSchema,
    requiresKnowledgeScope: true,
    run: async (args, _signal, allowedIds) => {
      const input = kbReadInputSchema.parse(args)
      return knowledgeReadModelOutput(await readOrGrepConcept(input, allowedIds))
    }
  },
  // kb_list has two modes (list the bases / outline one base); listOrOutlineKnowledge routes by `baseId`.
  [KB_LIST_TOOL_NAME]: {
    description: KNOWLEDGE_LIST_DESCRIPTION,
    inputSchema: kbListInputSchema,
    requiresKnowledgeScope: true,
    run: async (args, _signal, allowedIds) => {
      const input = kbListInputSchema.parse(args)
      return knowledgeListModelOutput(await listOrOutlineKnowledge(input, allowedIds), input)
    }
  },
  [KB_MANAGE_TOOL_NAME]: {
    description: KNOWLEDGE_MANAGE_DESCRIPTION,
    inputSchema: kbManageInputSchema,
    requiresKnowledgeScope: true,
    run: async (args, _signal, allowedIds) => {
      const input = kbManageInputSchema.parse(args)
      return knowledgeManageModelOutput(await manageKnowledge(input, allowedIds))
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

/**
 * List the builtin tools available for the given knowledge scope. When `allowedIds`
 * is empty the agent has no knowledge access, so the kb_* tools are filtered out
 * (mirrors the assistant path, where an empty binding hides the knowledge tools).
 */
export function listCherryBuiltinTools(allowedIds: string[]): Tool[] {
  const hasKnowledgeScope = allowedIds.length > 0
  return Object.entries(resolveHandlers())
    .filter(([, handler]) => hasKnowledgeScope || !handler.requiresKnowledgeScope)
    .map(([name, handler]) => ({
      name,
      description: handler.description,
      inputSchema: toMcpInputSchema(handler.inputSchema)
    }))
}

export async function callCherryBuiltinTool(
  name: string,
  args: unknown,
  signal: AbortSignal,
  allowedIds: string[]
): Promise<CallToolResult> {
  const handler = resolveHandler(name)
  if (!handler) {
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
  }
  // Defense in depth: kb_* tools are hidden from list when the binding is empty,
  // but reject a direct call too so an unscoped kb lookup can never run.
  if (handler.requiresKnowledgeScope && allowedIds.length === 0) {
    logger.warn('Rejected direct knowledge tool call without a bound knowledge base', { tool: name })
    return { content: [{ type: 'text', text: `Tool unavailable: ${name} (no knowledge base bound)` }], isError: true }
  }
  try {
    return toMcpResult(await handler.run(args ?? {}, signal, allowedIds))
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
    this.mcpServer = new McpServer({ name: 'cherry-tools', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...listCherryBuiltinTools(agentContext.getKnowledgeBaseIds()), ...autonomy.tools()]
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name } = request.params
      if (autonomy.handles(name)) {
        return autonomy.call(name, (request.params.arguments ?? {}) as Record<string, string | undefined>)
      }
      return callCherryBuiltinTool(name, request.params.arguments, extra.signal, agentContext.getKnowledgeBaseIds())
    })
  }
}

export default CherryBuiltinToolsServer

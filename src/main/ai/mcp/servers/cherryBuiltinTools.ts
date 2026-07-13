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
 * KB scope is unscoped (`allowedIds: []`) because agents have no per-assistant
 * knowledge selection — the agent sees all of the user's knowledge bases. The
 * destructive `kb_manage` tool relies on Claude Code's own per-call permission
 * prompt for approval (the AI-SDK path uses the tool's `needsApproval` instead).
 *
 * The server also hosts the agent autonomy tools (`…__cron`, `…__notify`,
 * `…__config` — see `cherryAutonomyTools.ts`), which act on behalf of the
 * session's agent via the {@link CherryAgentContext} passed at construction.
 */

import { application } from '@application'
import { loggerService } from '@logger'
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
  GENERATE_IMAGE_DESCRIPTION,
  generateImageFromPrompt,
  isPaintingError,
  paintingModelOutput
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
  generateImageInputSchema,
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
  // `signal` is honoured only by handlers whose core supports cancellation (web → WebSearchService).
  // The kb handlers ignore it: KnowledgeService exposes no AbortSignal plumbing (see knowledgeLookup).
  run: (args: unknown, signal: AbortSignal) => Promise<ToolModelOutput>
}

// Agents have no per-assistant knowledge scope, so KB lookups run unscoped.
const KB_ALLOWED_IDS: string[] = []

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
    run: async (args) => {
      const { query, baseIds } = kbSearchInputSchema.parse(args)
      return knowledgeSearchModelOutput(await searchKnowledge(query, baseIds, KB_ALLOWED_IDS))
    }
  },
  // kb_read has two modes (read the document / grep it for `pattern`); readOrGrepConcept routes by `pattern`.
  [KB_READ_TOOL_NAME]: {
    description: KNOWLEDGE_READ_DESCRIPTION,
    inputSchema: kbReadInputSchema,
    run: async (args) => {
      const input = kbReadInputSchema.parse(args)
      return knowledgeReadModelOutput(await readOrGrepConcept(input, KB_ALLOWED_IDS))
    }
  },
  // kb_list has two modes (list the bases / outline one base); listOrOutlineKnowledge routes by `baseId`.
  [KB_LIST_TOOL_NAME]: {
    description: KNOWLEDGE_LIST_DESCRIPTION,
    inputSchema: kbListInputSchema,
    run: async (args) => {
      const input = kbListInputSchema.parse(args)
      return knowledgeListModelOutput(await listOrOutlineKnowledge(input, KB_ALLOWED_IDS), input)
    }
  },
  [KB_MANAGE_TOOL_NAME]: {
    description: KNOWLEDGE_MANAGE_DESCRIPTION,
    inputSchema: kbManageInputSchema,
    run: async (args) => {
      const input = kbManageInputSchema.parse(args)
      return knowledgeManageModelOutput(await manageKnowledge(input, KB_ALLOWED_IDS))
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
  },
  [GENERATE_IMAGE_TOOL_NAME]: {
    description: GENERATE_IMAGE_DESCRIPTION,
    inputSchema: generateImageInputSchema,
    run: async (args, signal) => {
      const input = generateImageInputSchema.parse(args)
      const result = await generateImageFromPrompt(input, signal)
      const text = paintingModelOutput(result).value
      // On failure `result` is the model-facing note — text only, no image to attach.
      if (isPaintingError(result)) return { type: 'text', value: text }
      const images = await readGeneratedImages(result, signal)
      return images.length > 0 ? { type: 'text+images', value: text, images } : { type: 'text', value: text }
    }
  }
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

export function listCherryBuiltinTools(): Tool[] {
  return Object.entries(HANDLERS).map(([name, handler]) => ({
    name,
    description: handler.description,
    inputSchema: toMcpInputSchema(handler.inputSchema)
  }))
}

export async function callCherryBuiltinTool(name: string, args: unknown, signal: AbortSignal): Promise<CallToolResult> {
  const handler = HANDLERS[name]
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
    this.mcpServer = new McpServer({ name: 'cherry-tools', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...listCherryBuiltinTools(), ...autonomy.tools()]
    }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name } = request.params
      if (autonomy.handles(name)) {
        return autonomy.call(name, (request.params.arguments ?? {}) as Record<string, string | undefined>)
      }
      return callCherryBuiltinTool(name, request.params.arguments, extra.signal)
    })
  }
}

export default CherryBuiltinToolsServer

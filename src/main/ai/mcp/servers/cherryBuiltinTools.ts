/**
 * In-process MCP server exposing Cherry Studio's builtin tools to Claude Code.
 *
 * Wraps the same `webLookup` / `knowledgeLookup` cores the AI-SDK builtin tools
 * use, so Claude Code's web search/fetch and knowledge-base tools run identical
 * logic against the user's configured `WebSearchService` provider and knowledge
 * bases. Injected by `settingsBuilder` as an `sdk`-type MCP server; Claude calls
 * these five tools as `mcp__cherry-tools__web_search`, `…__web_fetch`,
 * `…__kb_search`, `…__kb_list`, and `…__report_artifacts`.
 *
 * KB scope is unscoped (`allowedIds: []`) because agents have no per-assistant
 * knowledge selection — the agent sees all of the user's knowledge bases.
 */

import { loggerService } from '@logger'
import {
  KNOWLEDGE_LIST_DESCRIPTION,
  KNOWLEDGE_SEARCH_DESCRIPTION,
  knowledgeListModelOutput,
  knowledgeSearchModelOutput,
  listKnowledgeBases,
  searchKnowledge
} from '@main/ai/tools/knowledgeLookup'
import {
  fetchWeb,
  searchWeb,
  WEB_FETCH_DESCRIPTION,
  WEB_SEARCH_DESCRIPTION,
  webLookupModelOutput
} from '@main/ai/tools/webLookup'
import { isAbortError } from '@main/services/webSearch/utils/errors'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import {
  KB_LIST_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  kbListInputSchema,
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

const logger = loggerService.withContext('McpServer:CherryBuiltinTools')

type ToolModelOutput = { type: 'text'; value: string } | { type: 'json'; value: unknown }

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
  [KB_LIST_TOOL_NAME]: {
    description: KNOWLEDGE_LIST_DESCRIPTION,
    inputSchema: kbListInputSchema,
    run: async (args) => {
      const input = kbListInputSchema.parse(args)
      return knowledgeListModelOutput(await listKnowledgeBases(input.query, input.groupId, KB_ALLOWED_IDS), input)
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

/** Drop the `$schema` marker so strict MCP clients don't reject the advertised input schema. */
function toMcpInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

function toMcpResult(output: ToolModelOutput): CallToolResult {
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

  constructor() {
    this.mcpServer = new McpServer({ name: 'cherry-tools', version: '1.0.0' }, { capabilities: { tools: {} } })
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listCherryBuiltinTools() }))
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      callCherryBuiltinTool(request.params.name, request.params.arguments, extra.signal)
    )
  }
}

export default CherryBuiltinToolsServer

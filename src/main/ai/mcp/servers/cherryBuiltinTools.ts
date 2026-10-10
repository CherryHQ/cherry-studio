/**
 * In-process `cherry-tools` MCP server exposing Cherry Studio's builtin tools to agent runtimes.
 *
 * Wraps the same `webLookup` / painting cores the AI-SDK builtin tools use, so the
 * agent's web search/fetch and image generation run identical logic against the user's
 * configured `WebSearchService` provider and painting model. Claude calls these tools as
 * `mcp__cherry-tools__web_search`, `…__web_fetch`, `…__report_artifacts`, and
 * `…__generate_image`.
 *
 * Domain tools that act on behalf of the session's agent live in sibling providers this
 * server merely registers — it stays unaware of their domain logic:
 * - {@link registerAutonomyTools} (`…__cron`, `…__notify`, `…__config`, `…__background_task`,
 *   `…__session_*`) — schedules, notifies, delegates, self-configures the agent, and runs fully
 *   detached background tasks.
 * - {@link registerKnowledgeTools} (`…__kb_search`, `…__kb_read`, `…__kb_list`,
 *   `…__kb_manage`) — owns knowledge-base exposure and per-call scope authorization.
 * - {@link registerCliTools} (`…__cli_list`, `…__cli_search`, `…__cli_install`) —
 *   delegates live discovery and approved installation to BinaryManager.
 * - {@link registerDocumentTools} (`…__to_markdown`) — converts workspace, agent-data, and
 *   session-attachment documents with Cherry's bundled converter and writes agent-private
 *   temporary Markdown.
 *
 * The factory runs once per connection, so runtime-dependent tool surfaces (the painting
 * model's generate_image schema, kb_* visibility, notify recipients) are decided there.
 */

import type { ImageContent } from '@modelcontextprotocol/server'
import { McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import { type CherryDocumentContext, registerDocumentTools } from '@main/ai/mcp/servers/cherryDocumentTools'
import { modelOutputToMcpResult } from '@main/ai/mcp/toolResult'
import { buildGenerateImageToolSchema, type GenerateImageToolInput } from '@main/ai/tools/generateImageTool'
import {
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

import { type AutonomyToolsContext, registerAutonomyTools } from './cherryAutonomyTools'
import { registerCliTools } from './cherryCliTools'
import { type KnowledgeToolsContext, registerKnowledgeTools } from './cherryKnowledgeTools'

export type CherryToolsOptions = AutonomyToolsContext & KnowledgeToolsContext & CherryDocumentContext

const logger = loggerService.withContext('McpServer:CherryBuiltinTools')

/**
 * Read the just-persisted generated images back as base64 image content blocks. Unlike the AI-SDK
 * builtin (whose renderer resolves the returned FileEntry ids to `file://` URLs), MCP tool results
 * only carry `content[]` to the agent renderer — the structured id array is dropped at the SDK
 * boundary — so the picture must ride along as inline base64. A read failure drops that one image
 * rather than failing the whole generation.
 */
async function readGeneratedImages(files: { id: string }[], signal: AbortSignal): Promise<ImageContent[]> {
  const fileManager = application.get('FileManager')
  const blocks: ImageContent[] = []
  for (const file of files) {
    if (signal.aborted) break
    try {
      const { content, mime } = await fileManager.read(file.id, { encoding: 'base64' })
      blocks.push({ type: 'image', data: content, mimeType: mime })
    } catch (error) {
      logger.warn('Failed to read generated image for inline rendering', { id: file.id, error })
    }
  }
  return blocks
}

function registerBuiltinTools(server: McpServer): void {
  server.registerTool(
    WEB_SEARCH_TOOL_NAME,
    { description: WEB_SEARCH_DESCRIPTION, inputSchema: webSearchInputSchema },
    async ({ query }, ctx) => modelOutputToMcpResult(webLookupModelOutput(await searchWeb(query, ctx.mcpReq.signal)))
  )
  server.registerTool(
    WEB_FETCH_TOOL_NAME,
    { description: WEB_FETCH_DESCRIPTION, inputSchema: webFetchInputSchema },
    async ({ urls }, ctx) => modelOutputToMcpResult(webLookupModelOutput(await fetchWeb(urls, ctx.mcpReq.signal)))
  )
  // Pure declaration tool: the model reports its final deliverable file(s). The value lives in the
  // tool *input* — a data contract for a renderer artifacts card; the handler only confirms.
  server.registerTool(
    REPORT_ARTIFACTS_TOOL_NAME,
    { description: REPORT_ARTIFACTS_DESCRIPTION, inputSchema: reportArtifactsInputSchema },
    async ({ artifacts }) => ({ content: [{ type: 'text', text: `Recorded ${artifacts.length} artifact(s).` }] })
  )

  const configuredModel = resolveConfiguredPaintingModel()
  server.registerTool(
    GENERATE_IMAGE_TOOL_NAME,
    { description: GENERATE_IMAGE_DESCRIPTION, inputSchema: buildGenerateImageToolSchema(configuredModel?.support) },
    async (input, ctx) => {
      const signal = ctx.mcpReq.signal
      const result = await generateImageFromPrompt(input as GenerateImageToolInput, signal, configuredModel)
      const text = paintingModelOutput(result).value
      // On failure `result` is the model-facing note — text only, no image to attach.
      const images = isPaintingError(result) ? [] : await readGeneratedImages(result, signal)
      return { content: [{ type: 'text', text }, ...images] }
    }
  )
}

export function createCherryToolsServer(options: CherryToolsOptions): McpServer {
  const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
  registerBuiltinTools(server)
  registerKnowledgeTools(server, options)
  registerAutonomyTools(server, options)
  registerCliTools(server)
  registerDocumentTools(server, options)
  return server
}

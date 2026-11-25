import { CallToolResultSchema } from '@modelcontextprotocol/core'
import { getToolName, isToolUIPart } from 'ai'
import * as z from 'zod'

import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { mcpServerService } from '@data/services/McpServerService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { resolvePersistedToolOutput } from '@main/ai/messages/persistedToolOutput'
import {
  isMcpResourceAccessDisabled,
  resolveServersForAssistant
} from '@main/ai/tools/adapters/aiSdk/mcp/resolveAssistantMcpTools'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import { blobRefsOf, isPersistedToolOutput } from '@shared/ai/transport'
import type { InputFor } from '@shared/ipc/types'
import { McpAppResultMetadataSchema } from '@shared/types/mcpApp'
import { getEffectiveMcpMode } from '@shared/utils/mcp'

import { prepareMcpAppResource } from './mcpAppResource'
import { getMcpAppResourceUri, isMcpToolVisibleTo } from './mcpAppTool'
import { buildMcpToolWireId } from './mcpToolId'

const appToolOutputSchema = CallToolResultSchema.and(z.object({ metadata: McpAppResultMetadataSchema }))
const appToolInputSchema = z.record(z.string(), z.unknown())
const MAX_APP_RESULT_BYTES = 4 * 1024 * 1024

export async function loadMcpApp({ topicId, messageId, toolCallId }: InputFor<'mcp.app.open'>, signal: AbortSignal) {
  const message = messageService.getById(messageId)
  if (message.topicId !== topicId || message.role !== 'assistant') throw new Error('MCP App result is unavailable')
  const part = message.data.parts?.find((part) => isToolUIPart(part) && part.toolCallId === toolCallId)
  if (!part || !isToolUIPart(part) || part.state !== 'output-available' || part.preliminary) {
    throw new Error('MCP App result is unavailable')
  }
  let output = part.output
  if (isPersistedToolOutput(output)) {
    const chars = blobRefsOf(output.$persistedToolOutput).reduce((sum, blob) => sum + blob.totalChars, 0)
    if (chars > MAX_APP_RESULT_BYTES) throw new Error('MCP App result is unavailable')
    output = await resolvePersistedToolOutput(output, { allowExcerpt: false })
  }
  const { metadata, content, structuredContent, _meta, isError } = appToolOutputSchema.parse(output)
  const args = metadata.appInput
  if (isError || Buffer.byteLength(JSON.stringify([args, content, structuredContent, _meta])) > MAX_APP_RESULT_BYTES) {
    throw new Error('MCP App result is unavailable')
  }

  const app = metadata.app
  const assistantId = topicService.getById(topicId).assistantId
  if (!assistantId) throw new Error('MCP App source is unavailable')
  const runtime = application.get('McpRuntimeService')
  const verifySource = () => {
    if (topicService.getById(topicId).assistantId !== assistantId) throw new Error('MCP App source changed')
    const assistant = assistantDataService.getById(assistantId)
    const mode = getEffectiveMcpMode(assistant)
    const server = mcpServerService.getById(app.serverId)
    if (
      mode === 'disabled' ||
      !resolveServersForAssistant(assistant, mode).some((source) => source.id === server.id) ||
      !server.isActive ||
      runtime.getServerKey(server) !== app.serverKey ||
      isMcpResourceAccessDisabled(server) ||
      isMcpToolDisabledBySource(server, { name: app.toolName })
    ) {
      throw new Error('MCP App source is unavailable')
    }
    const partName = getToolName(part)
    const wireName = partName === 'tool_invoke' ? appToolInputSchema.parse(part.input).name : partName
    const expected = buildMcpToolWireId({ serverId: server.id, serverName: server.name, toolName: app.toolName })
    if (wireName !== expected) throw new Error('MCP App tool identity changed')
    return server
  }

  verifySource()
  const tools = await runtime.listTools(app.serverId, 'refresh')
  const tool = tools.find((tool) => tool.name === app.toolName)
  if (!tool || !isMcpToolVisibleTo(tool, 'model') || getMcpAppResourceUri(tool) !== app.resourceUri) {
    throw new Error('MCP App declaration changed')
  }
  signal.throwIfAborted()
  verifySource()
  const { contents } = await runtime.getResource({
    serverId: app.serverId,
    uri: app.resourceUri,
    signal,
    cacheMode: 'refresh'
  })
  verifySource()
  return {
    assistantId,
    topicId,
    serverId: app.serverId,
    verifySource,
    resource: prepareMcpAppResource(contents, app.resourceUri),
    args,
    result: { content, structuredContent, _meta }
  }
}

/**
 * Gateway Middleware
 *
 * Handles API Gateway features:
 * - Model group routing: /{groupName}/v1/... routes use the group's configured model
 * - Endpoint access control based on enabledEndpoints configuration
 * - Model injection for simplified external app integration
 */

import { buildFunctionCallToolName } from '@main/utils/mcp'
import type { MCPTool } from '@types'
import type { NextFunction, Request, Response } from 'express'

import { loggerService } from '../../services/LoggerService'
import { reduxService } from '../../services/ReduxService'
import { config } from '../config'
import { mcpApiService } from '../services/mcp'
import { getMCPServersFromRedux } from '../utils/mcp'

const logger = loggerService.withContext('GatewayMiddleware')

type AssistantConfig = {
  id: string
  name: string
  prompt?: string
  model?: { id: string; provider: string }
  defaultModel?: { id: string; provider: string }
  settings?: {
    streamOutput?: boolean
    enableTemperature?: boolean
    temperature?: number
    enableTopP?: boolean
    topP?: number
    enableMaxTokens?: boolean
    maxTokens?: number
  }
  mcpServers?: Array<{ id: string }>
  allowed_tools?: string[]
}

type ToolDefinition = {
  name: string
  description?: string
  inputSchema: MCPTool['inputSchema']
}

const getEndpointFormat = (endpoint: string): 'openai' | 'anthropic' | 'responses' | null => {
  if (endpoint.startsWith('/v1/chat/completions')) return 'openai'
  if (endpoint.startsWith('/v1/messages')) return 'anthropic'
  if (endpoint.startsWith('/v1/responses')) return 'responses'
  return null
}

const buildAssistantModelId = (assistant: AssistantConfig): string | null => {
  const model = assistant.model ?? assistant.defaultModel
  if (!model?.provider || !model?.id) {
    return null
  }
  return `${model.provider}:${model.id}`
}

const applyAssistantMessageOverrides = (
  body: Record<string, any>,
  assistant: AssistantConfig,
  format: 'openai' | 'anthropic' | 'responses'
): Record<string, any> => {
  const nextBody = { ...body }
  const prompt = assistant.prompt ?? ''

  if (format === 'openai') {
    const messages = Array.isArray(nextBody.messages) ? nextBody.messages : []
    const filtered = messages.filter((message) => message?.role !== 'system' && message?.role !== 'developer')
    if (prompt.trim().length > 0) {
      filtered.unshift({ role: 'system', content: prompt })
    }
    nextBody.messages = filtered
  } else if (format === 'responses') {
    nextBody.instructions = prompt
  } else {
    nextBody.system = prompt
  }

  return nextBody
}

const applyAssistantParameterOverrides = (
  body: Record<string, any>,
  assistant: AssistantConfig,
  format: 'openai' | 'anthropic' | 'responses'
): Record<string, any> => {
  const nextBody = { ...body }
  const settings = assistant.settings ?? {}

  if (typeof settings.streamOutput === 'boolean') {
    nextBody.stream = settings.streamOutput
  }

  if (settings.enableTemperature && typeof settings.temperature === 'number') {
    nextBody.temperature = settings.temperature
  } else if ('temperature' in nextBody) {
    delete nextBody.temperature
  }

  if (settings.enableTopP && typeof settings.topP === 'number') {
    nextBody.top_p = settings.topP
  } else if ('top_p' in nextBody) {
    delete nextBody.top_p
  }

  if (settings.enableMaxTokens && typeof settings.maxTokens === 'number') {
    if (format === 'responses') {
      nextBody.max_output_tokens = settings.maxTokens
      delete nextBody.max_tokens
    } else {
      nextBody.max_tokens = settings.maxTokens
      if ('max_output_tokens' in nextBody) {
        delete nextBody.max_output_tokens
      }
    }
  } else {
    if ('max_tokens' in nextBody) {
      delete nextBody.max_tokens
    }
    if ('max_output_tokens' in nextBody) {
      delete nextBody.max_output_tokens
    }
  }

  delete nextBody.tool_choice

  return nextBody
}

const mapToolsForOpenAI = (tools: ToolDefinition[]) =>
  tools.map((toolDef) => ({
    type: 'function',
    function: {
      name: toolDef.name,
      description: toolDef.description || '',
      parameters: toolDef.inputSchema
    }
  }))

const mapToolsForResponses = (tools: ToolDefinition[]) =>
  tools.map((toolDef) => ({
    type: 'function',
    name: toolDef.name,
    description: toolDef.description || '',
    parameters: toolDef.inputSchema
  }))

const mapToolsForAnthropic = (tools: ToolDefinition[]) =>
  tools.map((toolDef) => ({
    name: toolDef.name,
    description: toolDef.description || '',
    input_schema: toolDef.inputSchema
  }))

const buildAssistantTools = async (assistant: AssistantConfig): Promise<ToolDefinition[]> => {
  const serverIds = assistant.mcpServers?.map((server) => server.id).filter(Boolean) ?? []
  if (serverIds.length === 0) {
    return []
  }

  const allowedTools = Array.isArray(assistant.allowed_tools) ? new Set(assistant.allowed_tools) : null
  const servers = await getMCPServersFromRedux()
  const tools: ToolDefinition[] = []

  for (const serverId of serverIds) {
    const server = servers.find((entry) => entry.id === serverId)
    if (!server || !server.isActive) {
      continue
    }

    const info = await mcpApiService.getServerInfo(serverId)
    if (!info?.tools || !Array.isArray(info.tools)) {
      continue
    }

    for (const tool of info.tools as Array<{
      name: string
      description?: string
      inputSchema?: MCPTool['inputSchema']
    }>) {
      if (!tool?.name || !tool.inputSchema) {
        continue
      }

      if (server.disabledTools?.includes(tool.name)) {
        continue
      }

      const toolName = buildFunctionCallToolName(info.name, tool.name)
      if (allowedTools && !allowedTools.has(toolName)) {
        continue
      }

      tools.push({
        name: toolName,
        description: tool.description,
        inputSchema: tool.inputSchema
      })
    }
  }

  return tools
}

const resolveAssistantById = async (assistantId: string): Promise<AssistantConfig | null> => {
  const assistants = (await reduxService.select('state.assistants.assistants')) as AssistantConfig[] | null
  return assistants?.find((assistant) => assistant.id === assistantId) ?? null
}

/**
 * Gateway middleware for model group routing
 *
 * This middleware:
 * 1. Extracts group name from URL path if present
 * 2. Looks up the group by matching name directly
 * 3. Injects the group's model into the request
 * 4. Checks if the endpoint is enabled
 */
export const gatewayMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const gatewayConfig = await config.get()
    const groupName = req.params.groupId // URL param is named groupId for backward compat

    // If groupName is provided, look up the model group by name
    if (groupName) {
      const group = gatewayConfig.modelGroups.find((g) => g.name === groupName)

      if (!group) {
        logger.warn('Model group not found', { groupName })
        res.status(404).json({
          error: {
            type: 'not_found',
            message: `Model group '${groupName}' not found`
          }
        })
        return
      }

      const endpoint = req.path.startsWith('/') ? req.path : `/${req.path}`
      const endpointFormat = getEndpointFormat(endpoint)

      if (group.mode === 'assistant' && group.assistantId) {
        if (!endpointFormat) {
          res.status(400).json({
            error: {
              type: 'invalid_request_error',
              message: `Unsupported endpoint ${endpoint}`
            }
          })
          return
        }

        const assistant = await resolveAssistantById(group.assistantId)
        if (!assistant) {
          res.status(400).json({
            error: {
              type: 'invalid_request_error',
              message: `Assistant '${group.assistantId}' not found`
            }
          })
          return
        }

        const modelId = buildAssistantModelId(assistant)
        if (!modelId) {
          res.status(400).json({
            error: {
              type: 'invalid_request_error',
              message: `Assistant '${group.assistantId}' is missing a model`
            }
          })
          return
        }

        let nextBody = {
          ...req.body,
          model: modelId
        }

        nextBody = applyAssistantMessageOverrides(nextBody, assistant, endpointFormat)
        nextBody = applyAssistantParameterOverrides(nextBody, assistant, endpointFormat)

        const tools = await buildAssistantTools(assistant)
        if (endpointFormat === 'openai') {
          nextBody.tools = tools.length > 0 ? mapToolsForOpenAI(tools) : undefined
        } else if (endpointFormat === 'responses') {
          nextBody.tools = tools.length > 0 ? mapToolsForResponses(tools) : undefined
        } else {
          nextBody.tools = tools.length > 0 ? mapToolsForAnthropic(tools) : undefined
        }

        req.body = nextBody

        logger.debug('Injected assistant preset into request', {
          groupName,
          assistantId: assistant.id,
          model: modelId,
          toolCount: tools.length
        })
      } else {
        // Inject the group's model into the request
        req.body = {
          ...req.body,
          model: `${group.providerId}:${group.modelId}`
        }

        logger.debug('Injected model from group', {
          groupName,
          model: `${group.providerId}:${group.modelId}`
        })
      }
    }

    // Get the endpoint path (for group routes, use the part after groupName)
    const endpoint = groupName ? req.path.replace(`/${groupName}`, '') : req.path
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

    // Check if endpoint is enabled (skip for /v1/models which is always enabled)
    if (!normalizedEndpoint.startsWith('/v1/models')) {
      if (!gatewayConfig.enabledEndpoints.some((e) => normalizedEndpoint.startsWith(e))) {
        res.status(404).json({
          error: {
            type: 'not_found',
            message: `Endpoint ${endpoint} is not enabled`
          }
        })
        return
      }
    }

    next()
  } catch (error) {
    next(error)
  }
}

export default gatewayMiddleware

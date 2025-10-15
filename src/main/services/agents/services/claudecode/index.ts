// src/main/services/agents/services/claudecode/index.ts
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import {
  CanUseTool,
  McpHttpServerConfig,
  Options,
  PermissionUpdate,
  query,
  SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import { validateModelId } from '@main/apiServer/utils'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { app } from 'electron'
import { isEmpty } from 'lodash'

import { GetAgentSessionResponse } from '../..'
import { AgentServiceInterface, AgentStream, AgentStreamEvent } from '../../interfaces/AgentStreamInterface'
import { promptForToolApproval } from './tool-permissions'
import { ClaudeStreamState, transformSDKMessageToStreamParts } from './transform'

const require_ = createRequire(import.meta.url)
const logger = loggerService.withContext('ClaudeCodeService')

class ClaudeCodeStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
}

class ClaudeCodeService implements AgentServiceInterface {
  private claudeExecutablePath: string

  constructor() {
    // Resolve Claude Code CLI robustly (works in dev and in asar)
    this.claudeExecutablePath = require_.resolve('@anthropic-ai/claude-agent-sdk/cli.js')
    if (app.isPackaged) {
      this.claudeExecutablePath = this.claudeExecutablePath.replace(/\.asar([\\/])/, '.asar.unpacked$1')
    }
  }

  async invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController,
    lastAgentSessionId?: string
  ): Promise<AgentStream> {
    const aiStream = new ClaudeCodeStream()

    // Validate session accessible paths and make sure it exists as a directory
    const cwd = session.accessible_paths[0]
    if (!cwd) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error('No accessible paths defined for the agent session')
      })
      return aiStream
    }

    // Validate model info
    const modelInfo = await validateModelId(session.model)
    if (!modelInfo.valid) {
      aiStream.emit('data', {
        type: 'error',
        error: new Error(`Invalid model ID '${session.model}': ${JSON.stringify(modelInfo.error)}`)
      })
      return aiStream
    }

    const validateModelInfo: (m: typeof modelInfo) => boolean = (m) => {
      const { provider, modelEndpointType } = m
      if (!provider) return false
      if (isEmpty(provider.apiKey?.trim())) return false

      const isAnthropicType = provider.type === 'anthropic'
      const isAnthropicEndpoint = modelEndpointType === 'anthropic'
      const hasValidApiHost = !isEmpty(provider.anthropicApiHost?.trim())

      return !(!isAnthropicType && !isAnthropicEndpoint && !hasValidApiHost)
    }

    if (!modelInfo.provider || !validateModelInfo(modelInfo)) {
      logger.error('Anthropic provider configuration is missing', {
        modelInfo
      })

      aiStream.emit('data', {
        type: 'error',
        error: new Error(`Invalid provider type '${modelInfo.provider?.type}'. Expected 'anthropic' provider type.`)
      })
      return aiStream
    }

    const apiConfig = await apiConfigService.get()
    const loginShellEnv = await getLoginShellEnvironment()
    const loginShellEnvWithoutProxies = Object.fromEntries(
      Object.entries(loginShellEnv).filter(([key]) => !key.toLowerCase().endsWith('_proxy'))
    ) as Record<string, string>

    const env = {
      ...loginShellEnvWithoutProxies,
      // TODO: fix the proxy api server
      // ANTHROPIC_API_KEY: apiConfig.apiKey,
      // ANTHROPIC_AUTH_TOKEN: apiConfig.apiKey,
      // ANTHROPIC_BASE_URL: `http://${apiConfig.host}:${apiConfig.port}/${modelInfo.provider.id}`,
      ANTHROPIC_API_KEY: modelInfo.provider.apiKey,
      ANTHROPIC_AUTH_TOKEN: modelInfo.provider.apiKey,
      ANTHROPIC_BASE_URL: modelInfo.provider.anthropicApiHost?.trim() || modelInfo.provider.apiHost,
      ANTHROPIC_MODEL: modelInfo.modelId,
      ANTHROPIC_SMALL_FAST_MODEL: modelInfo.modelId,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1'
    }

    const errorChunks: string[] = []

    const canUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }
    ) => {
      return promptForToolApproval(toolName, input)
    }

    // Build SDK options from parameters
    const options: Options = {
      abortController,
      cwd,
      env,
      // model: modelInfo.modelId,
      pathToClaudeCodeExecutable: this.claudeExecutablePath,
      stderr: (chunk: string) => {
        logger.warn('claude stderr', { chunk })
        errorChunks.push(chunk)
      },
      systemPrompt: session.instructions
        ? {
            type: 'preset',
            preset: 'claude_code',
            append: session.instructions
          }
        : { type: 'preset', preset: 'claude_code' },
      settingSources: ['project'],
      includePartialMessages: true,
      permissionMode: session.configuration?.permission_mode,
      maxTurns: session.configuration?.max_turns,
      allowedTools: session.allowed_tools,
      canUseTool: canUseTool as CanUseTool
    }

    if (session.accessible_paths.length > 1) {
      options.additionalDirectories = session.accessible_paths.slice(1)
    }

    if (session.mcps && session.mcps.length > 0) {
      // mcp configs
      const mcpList: Record<string, McpHttpServerConfig> = {}
      for (const mcpId of session.mcps) {
        mcpList[mcpId] = {
          type: 'http',
          url: `http://${apiConfig.host}:${apiConfig.port}/v1/mcps/${mcpId}/mcp`,
          headers: {
            Authorization: `Bearer ${apiConfig.apiKey}`
          }
        }
      }
      options.mcpServers = mcpList
      options.strictMcpConfig = true
    }

    if (lastAgentSessionId) {
      options.resume = lastAgentSessionId
      // TODO: use fork session when we support branching sessions
      // options.forkSession = true
    }

    logger.info('Starting Claude Code SDK query', {
      prompt,
      cwd: options.cwd,
      model: options.model,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      allowedTools: options.allowedTools,
      resume: options.resume
    })

    // Start async processing on the next tick so listeners can subscribe first
    setImmediate(() => {
      this.processSDKQuery(prompt, options, aiStream, errorChunks).catch((error) => {
        logger.error('Unhandled Claude Code stream error', {
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        })
        aiStream.emit('data', {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error))
        })
      })
    })

    return aiStream
  }

  private async *userMessages(prompt: string) {
    {
      yield {
        type: 'user' as const,
        parent_tool_use_id: null,
        session_id: '',
        message: {
          role: 'user' as const,
          content: prompt
        }
      }
    }
  }

  /**
   * Process SDK query and emit stream events
   */
  private async processSDKQuery(
    prompt: string,
    options: Options,
    stream: ClaudeCodeStream,
    errorChunks: string[]
  ): Promise<void> {
    const jsonOutput: SDKMessage[] = []
    let hasCompleted = false
    const startTime = Date.now()

    const streamState = new ClaudeStreamState()
    try {
      // Process streaming responses using SDK query
      for await (const message of query({
        prompt: this.userMessages(prompt),
        options
      })) {
        if (hasCompleted) break

        jsonOutput.push(message)

        if (message.type === 'assistant' || message.type === 'user') {
          logger.silly('claude response', {
            message,
            content: JSON.stringify(message.message.content)
          })
        } else if (message.type === 'stream_event') {
          logger.silly('Claude stream event', {
            message,
            event: JSON.stringify(message.event)
          })
        } else {
          logger.silly('Claude response', {
            message,
            event: JSON.stringify(message)
          })
        }

        // Transform SDKMessage to UIMessageChunks
        const chunks = transformSDKMessageToStreamParts(message, streamState)
        for (const chunk of chunks) {
          stream.emit('data', {
            type: 'chunk',
            chunk
          })
        }
      }

      // Successfully completed
      hasCompleted = true
      const duration = Date.now() - startTime

      logger.debug('SDK query completed successfully', {
        duration,
        messageCount: jsonOutput.length
      })

      // Emit completion event
      stream.emit('data', {
        type: 'complete'
      })
    } catch (error) {
      if (hasCompleted) return
      hasCompleted = true

      const duration = Date.now() - startTime

      // Check if this is an abort error
      const errorObj = error as any
      const isAborted =
        errorObj?.name === 'AbortError' ||
        errorObj?.message?.includes('aborted') ||
        options.abortController?.signal.aborted

      if (isAborted) {
        logger.info('SDK query aborted by client disconnect', { duration })
        // Simply cleanup and return - don't emit error events
        stream.emit('data', {
          type: 'cancelled',
          error: new Error('Request aborted by client')
        })
        return
      }

      errorChunks.push(errorObj instanceof Error ? errorObj.message : String(errorObj))
      const errorMessage = errorChunks.join('\n\n')
      logger.error('SDK query failed', {
        duration,
        error: errorObj instanceof Error ? { name: errorObj.name, message: errorObj.message } : String(errorObj),
        stderr: errorChunks
      })
      // Emit error event
      stream.emit('data', {
        type: 'error',
        error: new Error(errorMessage)
      })
    }
  }
}

export default ClaudeCodeService

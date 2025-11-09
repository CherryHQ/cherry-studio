// src/main/services/agents/services/claudecode/index.ts
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import type { CanUseTool, McpHttpServerConfig, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'
import { config as apiConfigService } from '@main/apiServer/config'
import { validateModelId } from '@main/apiServer/utils'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { app } from 'electron'

import type { GetAgentSessionResponse } from '../..'
import type { AgentServiceInterface, AgentStream, AgentStreamEvent } from '../../interfaces/AgentStreamInterface'
import { sessionService } from '../SessionService'
import { promptForToolApproval } from './tool-permissions'
import { ClaudeStreamState, transformSDKMessageToStreamParts } from './transform'

const require_ = createRequire(import.meta.url)
const logger = loggerService.withContext('ClaudeCodeService')
const DEFAULT_AUTO_ALLOW_TOOLS = new Set(['Read', 'Glob', 'Grep'])
const shouldAutoApproveTools = process.env.CHERRY_AUTO_ALLOW_TOOLS === '1'
const NO_RESUME_COMMANDS = ['/clear']

type UserInputMessage = {
  type: 'user'
  parent_tool_use_id: string | null
  session_id: string
  message: {
    role: 'user'
    content: string
  }
}

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
    if (
      (modelInfo.provider?.type !== 'anthropic' &&
        (modelInfo.provider?.anthropicApiHost === undefined || modelInfo.provider.anthropicApiHost.trim() === '')) ||
      modelInfo.provider.apiKey === ''
    ) {
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
      ANTHROPIC_DEFAULT_OPUS_MODEL: modelInfo.modelId,
      ANTHROPIC_DEFAULT_SONNET_MODEL: modelInfo.modelId,
      // TODO: support set small model in UI
      ANTHROPIC_DEFAULT_HAIKU_MODEL: modelInfo.modelId,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1'
    }

    const errorChunks: string[] = []

    const sessionAllowedTools = new Set<string>(session.allowed_tools ?? [])
    const autoAllowTools = new Set<string>([...DEFAULT_AUTO_ALLOW_TOOLS, ...sessionAllowedTools])
    const normalizeToolName = (name: string) => (name.startsWith('builtin_') ? name.slice('builtin_'.length) : name)

    const canUseTool: CanUseTool = async (toolName, input, options) => {
      logger.info('Handling tool permission check', {
        toolName,
        suggestionCount: options.suggestions?.length ?? 0
      })

      if (shouldAutoApproveTools) {
        logger.debug('Auto-approving tool due to CHERRY_AUTO_ALLOW_TOOLS flag', { toolName })
        return { behavior: 'allow', updatedInput: input }
      }

      if (options.signal.aborted) {
        logger.debug('Permission request signal already aborted; denying tool', { toolName })
        return {
          behavior: 'deny',
          message: 'Tool request was cancelled before prompting the user'
        }
      }

      const normalizedToolName = normalizeToolName(toolName)
      if (autoAllowTools.has(toolName) || autoAllowTools.has(normalizedToolName)) {
        logger.debug('Auto-allowing tool from allowed list', {
          toolName,
          normalizedToolName
        })
        return { behavior: 'allow', updatedInput: input }
      }

      return promptForToolApproval(toolName, input, options)
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
      canUseTool
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

    if (lastAgentSessionId && !NO_RESUME_COMMANDS.some((cmd) => prompt.includes(cmd))) {
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

    const { stream: userInputStream, close: closeUserStream } = this.createUserMessageStream(
      prompt,
      abortController.signal
    )

    // Start async processing on the next tick so listeners can subscribe first
    setImmediate(() => {
      this.processSDKQuery(
        userInputStream,
        closeUserStream,
        options,
        aiStream,
        errorChunks,
        session.agent_id,
        session.id
      ).catch((error) => {
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

  private createUserMessageStream(initialPrompt: string, abortSignal: AbortSignal) {
    const queue: Array<UserInputMessage | null> = []
    const waiters: Array<(value: UserInputMessage | null) => void> = []
    let closed = false

    const flushWaiters = (value: UserInputMessage | null) => {
      const resolve = waiters.shift()
      if (resolve) {
        resolve(value)
        return true
      }
      return false
    }

    const enqueue = (value: UserInputMessage | null) => {
      if (closed) return
      if (value === null) {
        closed = true
      }
      if (!flushWaiters(value)) {
        queue.push(value)
      }
    }

    const close = () => {
      if (closed) return
      enqueue(null)
    }

    const onAbort = () => {
      close()
    }

    if (abortSignal.aborted) {
      close()
    } else {
      abortSignal.addEventListener('abort', onAbort, { once: true })
    }

    const iterator = (async function* () {
      try {
        while (true) {
          let value: UserInputMessage | null
          if (queue.length > 0) {
            value = queue.shift() ?? null
          } else if (closed) {
            break
          } else {
            // Wait for next message or close signal
            value = await new Promise<UserInputMessage | null>((resolve) => {
              waiters.push(resolve)
            })
          }

          if (value === null) {
            break
          }

          yield value
        }
      } finally {
        closed = true
        abortSignal.removeEventListener('abort', onAbort)
        while (waiters.length > 0) {
          const resolve = waiters.shift()
          resolve?.(null)
        }
      }
    })()

    enqueue({
      type: 'user',
      parent_tool_use_id: null,
      session_id: '',
      message: {
        role: 'user',
        content: initialPrompt
      }
    })

    return {
      stream: iterator,
      enqueue,
      close
    }
  }

  /**
   * Process SDK query and emit stream events
   */
  private async processSDKQuery(
    promptStream: AsyncIterable<UserInputMessage>,
    closePromptStream: () => void,
    options: Options,
    stream: ClaudeCodeStream,
    errorChunks: string[],
    agentId: string,
    sessionId: string
  ): Promise<void> {
    const jsonOutput: SDKMessage[] = []
    let hasCompleted = false
    const startTime = Date.now()
    const streamState = new ClaudeStreamState()

    try {
      for await (const message of query({ prompt: promptStream, options })) {
        if (hasCompleted) break

        jsonOutput.push(message)

        // Handle init message - merge builtin and SDK slash_commands
        if (message.type === 'system' && message.subtype === 'init') {
          const sdkSlashCommands = message.slash_commands || []
          logger.info('Received init message with slash commands', {
            sessionId,
            commands: sdkSlashCommands
          })

          try {
            // Get builtin + local slash commands from BaseService
            const existingCommands = await sessionService.listSlashCommands('claude-code', agentId)

            // Convert SDK slash_commands (string[]) to SlashCommand[] format
            // Ensure all commands start with '/'
            const sdkCommands = sdkSlashCommands.map((cmd) => {
              const normalizedCmd = cmd.startsWith('/') ? cmd : `/${cmd}`
              return {
                command: normalizedCmd,
                description: undefined
              }
            })

            // Merge: existing commands (builtin + local) + SDK commands, deduplicate by command name
            const commandMap = new Map<string, { command: string; description?: string }>()

            for (const cmd of existingCommands) {
              commandMap.set(cmd.command, cmd)
            }

            for (const cmd of sdkCommands) {
              if (!commandMap.has(cmd.command)) {
                commandMap.set(cmd.command, cmd)
              }
            }

            const mergedCommands = Array.from(commandMap.values())

            // Update session in database
            await sessionService.updateSession(agentId, sessionId, {
              slash_commands: mergedCommands
            })

            logger.info('Updated session with merged slash commands', {
              sessionId,
              existingCount: existingCommands.length,
              sdkCount: sdkCommands.length,
              totalCount: mergedCommands.length
            })
          } catch (error) {
            logger.error('Failed to update session slash_commands', {
              sessionId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        if (message.type === 'assistant' || message.type === 'user') {
          logger.silly('claude response', {
            message,
            content: JSON.stringify(message.message.content)
          })
        } else if (message.type === 'stream_event') {
          // logger.silly('Claude stream event', {
          //   message,
          //   event: JSON.stringify(message.event)
          // })
        } else {
          logger.silly('Claude response', {
            message,
            event: JSON.stringify(message)
          })
        }

        const chunks = transformSDKMessageToStreamParts(message, streamState)
        for (const chunk of chunks) {
          stream.emit('data', {
            type: 'chunk',
            chunk
          })

          // Close prompt stream when SDK signals completion or error
          if (chunk.type === 'finish' || chunk.type === 'error') {
            logger.info('Closing prompt stream as SDK signaled completion', {
              chunkType: chunk.type,
              reason: chunk.type === 'finish' ? 'finished' : 'error_occurred'
            })
            closePromptStream()
            logger.info('Prompt stream closed successfully')
          }
        }

      }

      const duration = Date.now() - startTime

      logger.debug('SDK query completed successfully', {
        duration,
        messageCount: jsonOutput.length
      })

      stream.emit('data', {
        type: 'complete'
      })
    } catch (error) {
      if (hasCompleted) return
      hasCompleted = true

      const duration = Date.now() - startTime
      const errorObj = error as any
      const isAborted =
        errorObj?.name === 'AbortError' ||
        errorObj?.message?.includes('aborted') ||
        options.abortController?.signal.aborted

      if (isAborted) {
        logger.info('SDK query aborted by client disconnect', { duration })
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

      stream.emit('data', {
        type: 'error',
        error: new Error(errorMessage)
      })
    } finally {
      closePromptStream()
    }
  }
}

export default ClaudeCodeService

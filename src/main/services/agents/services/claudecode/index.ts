// src/main/services/agents/services/claudecode/index.ts
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { Options, query, SDKMessage } from '@anthropic-ai/claude-code'
import { loggerService } from '@logger'
// import { config as apiConfig } from '@main/apiServer/config'
import { validateModelId } from '@main/apiServer/utils'

import { GetAgentSessionResponse } from '../..'
import { AgentServiceInterface, AgentStream, AgentStreamEvent } from '../../interfaces/AgentStreamInterface'
import { transformSDKMessageToUIChunk } from './transform'

const require_ = createRequire(import.meta.url)
const logger = loggerService.withContext('ClaudeCodeService')

interface ClaudeCodeResult {
  success: boolean
  stdout: string
  stderr: string
  jsonOutput: any[]
  error?: Error
  exitCode?: number
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
    this.claudeExecutablePath = require_.resolve('@anthropic-ai/claude-code/cli.js')
  }

  async invoke(prompt: string, session: GetAgentSessionResponse, lastAgentSessionId?: string): Promise<AgentStream> {
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
    if (modelInfo.provider?.type !== 'anthropic' || modelInfo.provider.apiKey === '') {
      aiStream.emit('data', {
        type: 'error',
        error: new Error(`Invalid provider type '${modelInfo.provider?.type}'. Expected 'anthropic' provider type.`)
      })
      return aiStream
    }

    // TODO: use cherry studio api server config instead of direct provider config to provide more flexibility (e.g. custom headers, proxy, statistics, etc).
    // const cfg = await apiConfig.get()
    // process.env.ANTHROPIC_AUTH_TOKEN = cfg.apiKey
    // process.env.ANTHROPIC_BASE_URL = `http://${cfg.host}:${cfg.port}`
    process.env.ANTHROPIC_AUTH_TOKEN = modelInfo.provider.apiKey
    process.env.ANTHROPIC_BASE_URL = modelInfo.provider.apiHost

    // Build SDK options from parameters
    const options: Options = {
      cwd,
      pathToClaudeCodeExecutable: this.claudeExecutablePath,
      stderr: (chunk: string) => {
        logger.info('claude stderr', { chunk })
      },
      permissionMode: session.configuration?.permission_mode,
      maxTurns: session.configuration?.max_turns
    }

    if (lastAgentSessionId) {
      options.resume = lastAgentSessionId
    }

    logger.info('Starting Claude Code SDK query', {
      prompt,
      options
    })

    // Start async processing
    this.processSDKQuery(prompt, options, aiStream)

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
  private async processSDKQuery(prompt: string, options: Options, stream: ClaudeCodeStream): Promise<void> {
    const jsonOutput: SDKMessage[] = []
    let hasCompleted = false
    const startTime = Date.now()

    try {
      // Process streaming responses using SDK query
      for await (const message of query({
        prompt: this.userMessages(prompt),
        options
      })) {
        if (hasCompleted) break

        jsonOutput.push(message)
        logger.silly('claude response', { message })
        if (message.type === 'assistant' || message.type === 'user') {
          logger.silly('message content', {
            message: JSON.stringify({ role: message.message.role, content: message.message.content })
          })
        }

        // Transform SDKMessage to UIMessageChunks
        const chunks = transformSDKMessageToUIChunk(message)
        for (const chunk of chunks) {
          stream.emit('data', {
            type: 'chunk',
            chunk,
            rawAgentMessage: message
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

      const result: ClaudeCodeResult = {
        success: true,
        stdout: '',
        stderr: '',
        jsonOutput,
        exitCode: 0
      }

      // Emit completion event
      stream.emit('data', {
        type: 'complete',
        agentResult: {
          ...result,
          rawSDKMessages: jsonOutput,
          agentType: 'claude-code'
        }
      })
    } catch (error) {
      if (hasCompleted) return
      hasCompleted = true

      const duration = Date.now() - startTime
      logger.error('SDK query error:', {
        error: error instanceof Error ? error.message : String(error),
        duration,
        messageCount: jsonOutput.length
      })

      const result: ClaudeCodeResult = {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        jsonOutput,
        error: error instanceof Error ? error : new Error(String(error)),
        exitCode: 1
      }

      // Emit error event
      stream.emit('data', {
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error))
      })

      // Emit completion with error result
      stream.emit('data', {
        type: 'complete',
        agentResult: {
          ...result,
          rawSDKMessages: jsonOutput,
          agentType: 'claude-code'
        }
      })
    }
  }
}

export default ClaudeCodeService

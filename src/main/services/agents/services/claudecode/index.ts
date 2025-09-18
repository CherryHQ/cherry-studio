// src/main/services/agents/services/claudecode/index.ts
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { Options, query, SDKMessage } from '@anthropic-ai/claude-code'
import { loggerService } from '@logger'

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

  invoke(prompt: string, cwd: string, session_id?: string, base?: Options): AgentStream {
    const aiStream = new ClaudeCodeStream()

    // Build SDK options from parameters
    const options: Options = {
      cwd,
      pathToClaudeCodeExecutable: this.claudeExecutablePath,
      stderr: (chunk: string) => {
        logger.info('claude stderr', { chunk })
      },
      ...base
    }

    if (session_id) {
      options.resume = session_id
    }

    logger.info('Starting Claude Code SDK query', {
      prompt,
      options: { cwd, maxTurns: options.maxTurns, permissionMode: options.permissionMode }
    })

    // Start async processing
    this.processSDKQuery(prompt, options, aiStream)

    return aiStream
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
        prompt,
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

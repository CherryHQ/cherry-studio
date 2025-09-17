// src/main/services/agents/services/claudecode/index.ts
import { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { Options, SDKMessage } from '@anthropic-ai/claude-code'
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

    // Spawn process with same parameters as invoke
    const args: string[] = [this.claudeExecutablePath, '--output-format', 'stream-json', '--verbose']

    if (session_id) {
      args.push('--resume', session_id)
    }
    if (base?.maxTurns) {
      args.push('--max-turns', base.maxTurns.toString())
    }
    if (base?.permissionMode) {
      args.push('--permission-mode', base.permissionMode)
    }

    args.push('--print', prompt)

    logger.info('Spawning Claude Code streaming process', { args, cwd })

    const p = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: false
    })

    logger.info('Streaming process created', { pid: p.pid })

    // Close stdin immediately
    if (p.stdin) {
      p.stdin.end()
      logger.debug('Closed stdin for streaming process')
    }

    this.setupStreamingHandlers(p, aiStream)

    return aiStream
  }

  /**
   * Set up process event handlers for streaming output
   */
  private setupStreamingHandlers(process: ChildProcess, stream: ClaudeCodeStream): void {
    let stdoutData = ''
    let stderrData = ''
    const jsonOutput: any[] = []
    let hasCompleted = false
    let stdoutBuffer = ''

    const startTime = Date.now()

    const emitChunks = (sdkMessage: SDKMessage) => {
      jsonOutput.push(sdkMessage)
      const chunks = transformSDKMessageToUIChunk(sdkMessage)
      for (const chunk of chunks) {
        stream.emit('data', {
          type: 'chunk',
          chunk,
          rawAgentMessage: sdkMessage // Store Claude Code specific SDKMessage as generic agent message
        })
      }
    }

    // Handle stdout with streaming events
    if (process.stdout) {
      process.stdout.setEncoding('utf8')
      process.stdout.on('data', (data: string) => {
        stdoutData += data
        stdoutBuffer += data
        logger.debug('Streaming stdout chunk:', { length: data.length })

        let newlineIndex = stdoutBuffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex)
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
          const trimmed = line.trim()
          if (trimmed) {
            try {
              const parsed = JSON.parse(trimmed) as SDKMessage
              emitChunks(parsed)
              logger.debug('Parsed JSON line', { parsed })
            } catch (error) {
              logger.debug('Non-JSON line', { line: trimmed })
            }
          }
          newlineIndex = stdoutBuffer.indexOf('\n')
        }
      })

      process.stdout.on('end', () => {
        const trimmed = stdoutBuffer.trim()
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed) as SDKMessage
            emitChunks(parsed)
            logger.debug('Parsed JSON line on stream end', { parsed })
          } catch (error) {
            logger.debug('Non-JSON remainder on stdout end', { line: trimmed })
          }
        }
        logger.debug('Streaming stdout ended')
      })
    }

    // Handle stderr
    if (process.stderr) {
      process.stderr.setEncoding('utf8')
      process.stderr.on('data', (data: string) => {
        stderrData += data
        const message = data.trim()
        if (!message) return
        logger.warn('Streaming stderr chunk:', { data: message })
        stream.emit('data', {
          type: 'error',
          error: new Error(message)
        })
      })

      process.stderr.on('end', () => {
        logger.debug('Streaming stderr ended')
      })
    }

    // Handle process completion
    const completeProcess = (code: number | null, signal: NodeJS.Signals | null, error?: Error) => {
      if (hasCompleted) return
      hasCompleted = true

      const duration = Date.now() - startTime
      const success = !error && code === 0

      logger.info('Streaming process completed', {
        code,
        signal,
        success,
        duration,
        stdoutLength: stdoutData.length,
        stderrLength: stderrData.length,
        jsonItems: jsonOutput.length,
        error: error?.message
      })

      const result: ClaudeCodeResult = {
        success,
        stdout: stdoutData,
        stderr: stderrData,
        jsonOutput,
        exitCode: code || undefined,
        error
      }

      // Emit completion event with agent-specific result
      stream.emit('data', {
        type: 'complete',
        agentResult: {
          ...result,
          rawSDKMessages: jsonOutput, // Claude Code specific: all collected SDK messages
          agentType: 'claude-code' // Identify the agent type
        }
      })
    }

    // Handle process exit
    process.on('exit', (code, signal) => {
      completeProcess(code, signal)
    })

    // Handle process errors
    process.on('error', (error) => {
      const duration = Date.now() - startTime
      logger.error('Streaming process error:', {
        error: error.message,
        duration,
        stdoutLength: stdoutData.length,
        stderrLength: stderrData.length
      })

      completeProcess(null, null, error)
    })

    // Handle close event as a fallback
    process.on('close', (code, signal) => {
      logger.debug('Streaming process closed', { code, signal })
      completeProcess(code, signal)
    })

    // Set timeout to prevent hanging
    const timeout = setTimeout(() => {
      if (!hasCompleted) {
        logger.error('Streaming process timeout after 600 seconds', {
          pid: process.pid,
          stdoutLength: stdoutData.length,
          stderrLength: stderrData.length,
          jsonItems: jsonOutput.length
        })
        process.kill('SIGTERM')
        completeProcess(null, null, new Error('Process timeout after 600 seconds'))
      }
    }, 600 * 1000)

    // Clear timeout when process ends
    process.on('exit', () => clearTimeout(timeout))
    process.on('error', () => clearTimeout(timeout))
  }

}

export default ClaudeCodeService

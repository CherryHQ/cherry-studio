// src/main/services/agents/services/claudecode/index.ts
import { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { Options, SDKMessage } from '@anthropic-ai/claude-code'
import { loggerService } from '@logger'
import { UIMessageChunk } from 'ai'

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

interface ClaudeCodeStreamEvent {
  type: 'message' | 'error' | 'complete'
  data?: any
  error?: Error
  result?: ClaudeCodeResult
}

class ClaudeCodeStream extends EventEmitter {
  declare emit: (event: 'data', data: ClaudeCodeStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: ClaudeCodeStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: ClaudeCodeStreamEvent) => void) => this
}

// AI SDK compatible stream events
interface AISDKStreamEvent {
  type: 'chunk' | 'error' | 'complete'
  chunk?: UIMessageChunk
  error?: Error
  result?: ClaudeCodeResult
}

class AISDKStream extends EventEmitter {
  declare emit: (event: 'data', data: AISDKStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AISDKStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AISDKStreamEvent) => void) => this
}

class ClaudeCodeService {
  private claudeExecutablePath: string

  constructor() {
    // Resolve Claude Code CLI robustly (works in dev and in asar)
    this.claudeExecutablePath = require_.resolve('@anthropic-ai/claude-code/cli.js')
  }

  async invoke(prompt: string, cwd: string, session_id?: string, base?: Options): Promise<ClaudeCodeResult> {
    // Ensure Electron behaves like Node for any child process that resolves to process.execPath
    // process.env.ELECTRON_RUN_AS_NODE = '1'

    const args: string[] = [this.claudeExecutablePath, '--output-format', 'stream-json', '--verbose', 'cwd', cwd]

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

    logger.info('Spawning Claude Code process', { args, cwd })

    const p = spawn(process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: false
    })

    // Log process creation
    logger.info('Process created', { pid: p.pid })

    // Close stdin immediately since we're passing the prompt via --print
    if (p.stdin) {
      p.stdin.end()
      logger.debug('Closed stdin')
    }

    return this.setupProcessHandlers(p)
  }

  invokeStream(prompt: string, cwd: string, session_id?: string, base?: Options): EventEmitter {
    const aiStream = new AISDKStream()
    const rawStream = new ClaudeCodeStream()

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

    this.setupStreamingHandlers(p, rawStream)
    this.setupAISDKTransform(rawStream, aiStream)

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

    const startTime = Date.now()

    // Handle stdout with streaming events
    if (process.stdout) {
      process.stdout.setEncoding('utf8')
      process.stdout.on('data', (data: string) => {
        stdoutData += data
        logger.debug('Streaming stdout chunk:', { length: data.length })

        // Parse JSON stream output line by line and emit events
        const lines = data.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed)
            stream.emit('data', { type: 'message', data: parsed })
            logger.debug('Parsed JSON line', { parsed })
          } catch {
            // If you expect NDJSON only, you may want to keep this in buffer instead of emitting.
            stream.emit('data', { type: 'message', data: { text: trimmed } })
            logger.debug('Non-JSON line', { line: trimmed })
          }
        }
      })

      process.stdout.on('end', () => {
        logger.debug('Streaming stdout ended')
      })
    }

    // Handle stderr
    if (process.stderr) {
      process.stderr.setEncoding('utf8')
      process.stderr.on('data', (data: string) => {
        stderrData += data
        logger.warn('Streaming stderr chunk:', { data: data.trim() })

        // Emit stderr as error events
        stream.emit('data', {
          type: 'error',
          data: { stderr: data.trim() }
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

      // Emit completion event
      stream.emit('data', {
        type: 'complete',
        result
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

  /**
   * Transform raw Claude Code stream events to AI SDK format
   */
  private setupAISDKTransform(rawStream: ClaudeCodeStream, aiStream: AISDKStream): void {
    rawStream.on('data', (event: ClaudeCodeStreamEvent) => {
      try {
        switch (event.type) {
          case 'message':
            // Transform SDKMessage to UIMessageChunk
            if (event.data) {
              const chunks = transformSDKMessageToUIChunk(event.data as SDKMessage)
              for (const chunk of chunks) {
                aiStream.emit('data', { type: 'chunk', chunk })
              }
            }
            break

          case 'error':
            aiStream.emit('data', { type: 'error', error: event.error })
            break

          case 'complete':
            aiStream.emit('data', { type: 'complete', result: event.result })
            break

          default:
            logger.warn('Unknown raw stream event type:', { type: (event as any).type })
            break
        }
      } catch (error) {
        logger.error('Error transforming stream event:', { error, event })
        aiStream.emit('data', {
          type: 'error',
          error: error instanceof Error ? error : new Error('Transform error')
        })
      }
    })
  }

  /**
   * Set up process event handlers and return a promise that resolves with complete output
   */
  private setupProcessHandlers(process: ChildProcess): Promise<ClaudeCodeResult> {
    return new Promise((resolve, reject) => {
      let stdoutData = ''
      let stderrData = ''
      const jsonOutput: any[] = []
      let hasResolved = false

      const startTime = Date.now()

      // Handle stdout with proper encoding and buffering
      if (process.stdout) {
        process.stdout.setEncoding('utf8')
        process.stdout.on('data', (data: string) => {
          stdoutData += data
          logger.debug('Agent stdout chunk:', { length: data.length })

          // Parse JSON stream output line by line
          const lines = data.split('\n')
          for (const line of lines) {
            if (line.trim()) {
              try {
                const parsed = JSON.parse(line.trim())
                jsonOutput.push(parsed)
                logger.silly('Parsed JSON output:', parsed)
              } catch (e) {
                // Not JSON, might be plain text output
                logger.debug('Non-JSON stdout line:', { line: line.trim() })
              }
            }
          }
        })

        process.stdout.on('end', () => {
          logger.debug('Agent stdout stream ended')
        })
      }

      // Handle stderr with proper encoding
      if (process.stderr) {
        process.stderr.setEncoding('utf8')
        process.stderr.on('data', (data: string) => {
          stderrData += data
          logger.warn('Agent stderr chunk:', { data: data.trim() })
        })

        process.stderr.on('end', () => {
          logger.debug('Agent stderr stream ended')
        })
      }

      // Handle process exit
      process.on('exit', (code, signal) => {
        const duration = Date.now() - startTime
        const success = code === 0
        const status = success ? 'completed' : 'failed'

        logger.info('Agent process exited', {
          code,
          signal,
          success,
          status,
          duration,
          stdoutLength: stdoutData.length,
          stderrLength: stderrData.length,
          jsonItems: jsonOutput.length
        })

        if (!hasResolved) {
          hasResolved = true
          resolve({
            success,
            stdout: stdoutData,
            stderr: stderrData,
            jsonOutput,
            exitCode: code || undefined
          })
        }
      })

      // Handle process errors
      process.on('error', (error) => {
        const duration = Date.now() - startTime
        logger.error('Agent process error:', {
          error: error.message,
          duration,
          stdoutLength: stdoutData.length,
          stderrLength: stderrData.length
        })

        if (!hasResolved) {
          hasResolved = true
          reject({
            success: false,
            stdout: stdoutData,
            stderr: stderrData,
            jsonOutput,
            error
          })
        }
      })

      // Handle close event as a fallback
      process.on('close', (code, signal) => {
        const duration = Date.now() - startTime
        logger.debug('Agent process closed', { code, signal, duration })

        // Only resolve here if exit event hasn't fired
        if (!hasResolved) {
          hasResolved = true
          const success = code === 0
          resolve({
            success,
            stdout: stdoutData,
            stderr: stderrData,
            jsonOutput,
            exitCode: code || undefined
          })
        }
      })

      // Set a timeout to prevent hanging indefinitely (reduced for debugging)
      const timeout = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true
          logger.error('Agent process timeout after 30 seconds', {
            pid: process.pid,
            stdoutLength: stdoutData.length,
            stderrLength: stderrData.length,
            jsonItems: jsonOutput.length
          })
          process.kill('SIGTERM')
          reject({
            success: false,
            stdout: stdoutData,
            stderr: stderrData,
            jsonOutput,
            error: new Error('Process timeout after 30 seconds')
          })
        }
      }, 30 * 1000) // 30 seconds timeout for debugging

      // Clear timeout when process ends
      process.on('exit', () => clearTimeout(timeout))
      process.on('error', () => clearTimeout(timeout))
    })
  }
}

export default ClaudeCodeService

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

import { loggerService } from '@logger'
import { findExecutableInEnv } from '@main/utils/process'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { type AgentConfiguration, type GetAgentSessionResponse, getAgentStyleModePreset } from '@types'
import type { TextStreamPart } from 'ai'

import type { AgentServiceInterface, AgentStream, AgentStreamEvent } from '../../interfaces/AgentStreamInterface'

const logger = loggerService.withContext('CommandWorkerService')
const EXTERNAL_WORKER_MODEL_ID = 'worker:external'

type CommandWorkerConfiguration = AgentConfiguration & {
  worker_command?: string
  worker_args?: string[]
}

type WorkerOutputSource = 'stdout' | 'stderr'

class CommandWorkerStream extends EventEmitter implements AgentStream {
  declare emit: (event: 'data', data: AgentStreamEvent) => boolean
  declare on: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  declare once: (event: 'data', listener: (data: AgentStreamEvent) => void) => this
  sdkSessionId?: string
}

const emptyStartStep: TextStreamPart<Record<string, any>> = {
  type: 'start-step',
  request: { body: '' },
  warnings: []
}

const finishStep: TextStreamPart<Record<string, any>> = {
  type: 'finish-step',
  response: {
    id: 'command-worker-step',
    timestamp: new Date(),
    modelId: 'command-worker'
  },
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    inputTokenDetails: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheTokens: 0
    },
    outputTokenDetails: {
      textTokens: 0,
      reasoningTokens: 0
    }
  },
  finishReason: 'stop',
  rawFinishReason: 'stop',
  providerMetadata: undefined
}

const defaultWorkerCommands: Partial<Record<GetAgentSessionResponse['agent_type'], string>> = {
  'claude-code': 'claude',
  codex: 'codex',
  opencode: 'opencode',
  'gemini-cli': 'gemini',
  hermes: 'hermes'
}

function supportsInjectedModel(agentType: GetAgentSessionResponse['agent_type']): boolean {
  return ['claude-code', 'codex', 'opencode', 'gemini-cli', 'hermes'].includes(agentType)
}

function readWorkerConfig(session: GetAgentSessionResponse): CommandWorkerConfiguration {
  return (session.configuration ?? {}) as CommandWorkerConfiguration
}

function withStyleInstruction(prompt: string, config: CommandWorkerConfiguration): string {
  if (!config.style_mode) return prompt
  const style = getAgentStyleModePreset(config.style_mode)
  return `${style.prompt}\n\n任务内容：\n${prompt}`
}

function interpolateArg(value: string, replacements: Record<string, string>): string {
  return value
    .replaceAll('{{prompt}}', replacements.prompt)
    .replaceAll('{{cwd}}', replacements.cwd)
    .replaceAll('{{sessionId}}', replacements.sessionId)
}

async function resolveWorkerCommand(
  command: string,
  agentType: GetAgentSessionResponse['agent_type']
): Promise<string> {
  if (!path.isAbsolute(command) || fs.existsSync(command)) {
    return command
  }
  const fallbackCommand = defaultWorkerCommands[agentType]
  if (!fallbackCommand) {
    return command
  }
  return (await findExecutableInEnv(fallbackCommand)) ?? command
}

function normalizeWorkerModel(agentType: GetAgentSessionResponse['agent_type'], modelId: string): string {
  if (!modelId.includes(':')) {
    return modelId
  }

  if (agentType === 'opencode') {
    const [provider, ...rest] = modelId.split(':')
    return `${provider}/${rest.join(':')}`
  }

  return modelId.split(':').slice(1).join(':')
}

export function resolveDesiredModel(
  session: GetAgentSessionResponse,
  config: CommandWorkerConfiguration
): string | undefined {
  if (!supportsInjectedModel(session.agent_type)) {
    return undefined
  }

  const workerSource = config.worker_model_source ?? 'worker'

  if (workerSource === 'worker') {
    const detectedModel = config.worker_detected_model?.trim()
    if (detectedModel) {
      return normalizeWorkerModel(session.agent_type, detectedModel)
    }
  }

  if (!session.model || session.model === EXTERNAL_WORKER_MODEL_ID) {
    return undefined
  }

  return normalizeWorkerModel(session.agent_type, session.model)
}

export function injectModelArgs(rawArgs: string[], desiredModel?: string): string[] {
  const nextArgs = [...rawArgs]

  for (let index = nextArgs.length - 1; index >= 0; index -= 1) {
    const value = nextArgs[index]
    if (value === '--model' || value === '-m') {
      nextArgs.splice(index, 2)
    }
  }

  if (!desiredModel) {
    return nextArgs
  }

  const promptIndex = nextArgs.findIndex((arg) => arg.includes('{{prompt}}'))
  const injection = ['--model', desiredModel]

  if (promptIndex >= 0) {
    nextArgs.splice(promptIndex, 0, ...injection)
    return nextArgs
  }

  nextArgs.push(...injection)
  return nextArgs
}

export class CommandWorkerService implements AgentServiceInterface {
  async invoke(
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController
  ): Promise<AgentStream> {
    const stream = new CommandWorkerStream()
    setImmediate(() => {
      void this.startWorker(stream, prompt, session, abortController)
    })

    return stream
  }

  private async startWorker(
    stream: CommandWorkerStream,
    prompt: string,
    session: GetAgentSessionResponse,
    abortController: AbortController
  ): Promise<void> {
    const cwd = session.accessible_paths[0]

    if (!cwd) {
      stream.emit('data', {
        type: 'error',
        error: new Error('No accessible paths defined for this worker session')
      })
      return
    }

    const workerConfig = readWorkerConfig(session)
    let workerCommand = workerConfig.worker_command?.trim()
    const styledPrompt = withStyleInstruction(prompt, workerConfig)

    if (!workerCommand) {
      stream.emit('data', {
        type: 'error',
        error: new Error(`Agent type '${session.agent_type}' requires configuration.worker_command`)
      })
      return
    }

    workerCommand = await resolveWorkerCommand(workerCommand, session.agent_type)

    const loginShellEnv = path.isAbsolute(workerCommand) ? {} : await getLoginShellEnvironment()
    const env = {
      ...process.env,
      ...loginShellEnv,
      ...workerConfig.env_vars
    }
    const replacements = {
      prompt: styledPrompt,
      cwd,
      sessionId: session.id
    }
    const resolvedModel = resolveDesiredModel(session, workerConfig)
    const rawWorkerArgs = injectModelArgs(workerConfig.worker_args ?? [], resolvedModel)
    const workerArgs = rawWorkerArgs.map((arg) => interpolateArg(arg, replacements))
    const promptInterpolated = rawWorkerArgs.some((arg) => arg.includes('{{prompt}}'))

    const child = spawn(workerCommand, workerArgs, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    stream.sdkSessionId = `worker_${session.id}_${Date.now()}`

    let settled = false
    let textStarted = false
    const textId = randomUUID()
    let currentText = ''
    let lastEmittedTextLength = 0
    let stderrText = ''
    let hasStderr = false

    const emitChunk = (chunk: TextStreamPart<Record<string, any>>) => {
      stream.emit('data', {
        type: 'chunk',
        chunk
      })
    }

    const ensureTextStart = () => {
      if (textStarted) return
      textStarted = true
      emitChunk(emptyStartStep)
      emitChunk({
        type: 'text-start',
        id: textId
      })
    }

    const appendText = (value: string, source: WorkerOutputSource = 'stdout') => {
      const trimmed = value.replace(/\r\n/g, '\n')
      if (!trimmed) return
      ensureTextStart()
      hasStderr = hasStderr || source === 'stderr'
      currentText += trimmed

      const delta = currentText.slice(lastEmittedTextLength)
      if (!delta) return
      lastEmittedTextLength = currentText.length

      emitChunk({
        type: 'text-delta',
        id: textId,
        text: delta,
        providerMetadata: {
          command_worker: {
            source,
            hasStderr
          }
        }
      })
    }

    const finishText = () => {
      if (!textStarted) return
      emitChunk({
        type: 'text-end',
        id: textId,
        providerMetadata: {
          command_worker: {
            hasStderr
          },
          text: {
            value: currentText
          }
        }
      })
      emitChunk(finishStep)
    }

    const finalize = (event: AgentStreamEvent) => {
      if (settled) return
      settled = true
      stream.emit('data', event)
    }

    const abortHandler = () => {
      if (settled) return
      logger.info('Aborting command worker run', {
        agentType: session.agent_type,
        sessionId: session.id,
        command: workerCommand
      })
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL')
        }
      }, 5000).unref()
    }

    abortController.signal.addEventListener('abort', abortHandler, { once: true })

    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')

    child.stdout.on('data', (chunk: Buffer) => {
      appendText(stdoutDecoder.write(chunk), 'stdout')
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk)
      stderrText += text
      appendText(text, 'stderr')
    })

    child.on('error', (error) => {
      abortController.signal.removeEventListener('abort', abortHandler)
      finalize({
        type: 'error',
        error
      })
    })

    child.on('close', (code, signal) => {
      abortController.signal.removeEventListener('abort', abortHandler)

      // Flush decoders
      const lastStdout = stdoutDecoder.end()
      if (lastStdout) appendText(lastStdout, 'stdout')
      const lastStderr = stderrDecoder.end()
      if (lastStderr) {
        stderrText += lastStderr
        appendText(lastStderr, 'stderr')
      }

      if (abortController.signal.aborted || signal === 'SIGTERM' || signal === 'SIGKILL') {
        finishText()
        finalize({ type: 'cancelled' })
        return
      }

      if (code === 0) {
        finishText()
        finalize({ type: 'complete' })
        return
      }

      const message =
        stderrText.trim() ||
        `Worker command exited with code ${code ?? 'unknown'} for agent type '${session.agent_type}'`
      finishText()
      finalize({
        type: 'error',
        error: new Error(message)
      })
    })

    if (child.stdin) {
      if (!promptInterpolated) {
        child.stdin.write(styledPrompt)
      }
      child.stdin.end()
    }

    logger.info('Started command worker run', {
      agentType: session.agent_type,
      sessionId: session.id,
      command: workerCommand,
      args: workerArgs,
      model: resolvedModel
    })
  }
}

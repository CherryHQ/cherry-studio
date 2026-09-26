import path from 'node:path'

import { loggerService } from '@logger'
import { executeCommand, type CommandResult } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { AgentHookListSchema, type AgentHook } from '@shared/ai/agentHook'

import type { AgentRuntimeHookHandler, AgentRuntimeHookInput, AgentRuntimeToolApprovalRequest } from '../runtime/types'

const logger = loggerService.withContext('AgentHookSession')
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_INPUT_BYTES = 1024 * 1024

interface HookSessionContext {
  sessionId: string
  agentId: string
  runtime: string
  getConfiguration: () => { hooks: AgentHook[]; env_vars?: Record<string, string> }
  getCwd: () => string | undefined
}

/** One connection's Hook lifetime; prewarming alone never starts a command. */
export class AgentHookSession {
  private readonly controller = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly notifiedInteractions = new Set<string>()
  private started?: Promise<unknown>

  constructor(private readonly context: HookSessionContext) {}

  notifyInteraction(request: AgentRuntimeToolApprovalRequest, signal?: AbortSignal): void {
    if (this.notifiedInteractions.has(request.approvalId)) return
    this.notifiedInteractions.add(request.approvalId)
    void this.invoke(
      {
        event: request.interactionKind === 'question' ? 'questionRequested' : 'approvalRequested',
        approvalId: request.approvalId,
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        toolInput: request.input
      },
      signal
    ).catch((error) => logger.warn('Interaction Hook failed', { event: request.interactionKind, error }))
  }

  readonly invoke: AgentRuntimeHookHandler = (input, signal) => {
    const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal
    const pending = this.invokeOnce(input, combined)
    this.pending.add(pending)
    void pending.then(
      () => this.pending.delete(pending),
      () => this.pending.delete(pending)
    )
    return pending
  }

  async close(): Promise<void> {
    this.controller.abort()
    await Promise.allSettled([this.started, ...this.pending])
  }

  private async invokeOnce(input: AgentRuntimeHookInput, signal: AbortSignal) {
    if (signal.aborted) return { denied: input.event === 'preToolUse', reason: 'Hook execution was cancelled.' }
    this.started ??= this.run({ event: 'sessionStart', messageId: input.messageId }, this.controller.signal)
    await this.waitForOrAbort(this.started, signal)
    if (signal.aborted) return { denied: input.event === 'preToolUse', reason: 'Hook execution was cancelled.' }
    if (input.event === 'sessionStart') return {}
    return this.run(input, signal)
  }

  // Cancelling a caller must preserve startup owned by the connection.
  private async waitForOrAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
    const aborted = Promise.withResolvers<undefined>()
    const onAbort = () => aborted.resolve(undefined)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    try {
      return await Promise.race([operation, aborted.promise])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private async run(input: AgentRuntimeHookInput, signal: AbortSignal): ReturnType<AgentRuntimeHookHandler> {
    try {
      const configuration = this.context.getConfiguration()
      const hooks = AgentHookListSchema.parse(configuration.hooks).filter(
        (hook) =>
          hook.enabled &&
          hook.event === input.event &&
          (!hook.matcher?.toolNameContains || (input.toolName ?? '').includes(hook.matcher.toolNameContains)) &&
          (!hook.matcher?.inputContains || (JSON.stringify(input.toolInput) ?? '').includes(hook.matcher.inputContains))
      )
      if (!hooks.length) return {}
      const cwd = this.context.getCwd()
      if (!cwd || !path.isAbsolute(cwd)) throw new Error('The Hook has no verified workspace directory.')
      const stdin = JSON.stringify({
        version: 1,
        ...input,
        sessionId: this.context.sessionId,
        agentId: this.context.agentId,
        runtime: this.context.runtime,
        cwd
      })
      if (Buffer.byteLength(stdin) > MAX_INPUT_BYTES) throw new Error('Hook input exceeds the 1 MiB limit.')
      const env = { ...(await getShellEnv(signal)), ...configuration?.env_vars }
      for (const hook of hooks) {
        if (signal.aborted) return { denied: input.event === 'preToolUse', reason: 'Hook execution was cancelled.' }
        const result = await this.execute(hook, cwd, env, stdin, signal)
        const details = {
          sessionId: this.context.sessionId,
          hookId: hook.id,
          event: input.event,
          exitCode: result.code,
          failure: result.failure
        }
        if (result.failure || result.code !== 0) {
          const reason = `Hook ${hook.name || hook.id} failed: ${result.failure ?? `exit ${result.code}`}${result.output.trim() ? `\n${result.output.trim().slice(0, 4096)}` : ''}`
          logger.warn('Agent Hook failed', { ...details, reason })
          if (input.event === 'preToolUse') return { denied: true, reason }
        } else {
          logger.debug('Agent Hook completed', details)
        }
      }
      return {}
    } catch (error) {
      if (signal.aborted) return { denied: input.event === 'preToolUse', reason: 'Hook execution was cancelled.' }
      logger.warn('Unable to execute Agent Hook', { sessionId: this.context.sessionId, event: input.event, error })
      return input.event === 'preToolUse'
        ? { denied: true, reason: `Unable to execute Hook: ${error instanceof Error ? error.message : String(error)}` }
        : {}
    }
  }

  private async execute(
    hook: AgentHook,
    cwd: string,
    env: NodeJS.ProcessEnv,
    stdin: string,
    signal: AbortSignal
  ): Promise<CommandResult> {
    const isWindows = process.platform === 'win32'
    const systemRoot = Object.entries(env).find(([key]) => key.toLowerCase() === 'systemroot')?.[1]
    if (isWindows && !systemRoot) throw new Error('Windows SystemRoot is unavailable.')
    const command = isWindows
      ? path.join(systemRoot!, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : '/bin/sh'
    const args = isWindows
      ? [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new(); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ' +
            hook.command
        ]
      : ['-c', hook.command]
    return executeCommand(command, args, {
      cwd,
      env,
      stdin,
      signal,
      timeout: hook.timeoutMs,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      result: 'structured'
    })
  }
}

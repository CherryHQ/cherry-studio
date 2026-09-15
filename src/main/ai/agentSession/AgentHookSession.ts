import type { ChildProcess } from 'node:child_process'
import path from 'node:path'

import { loggerService } from '@logger'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import { AgentHookListSchema, type AgentHook } from '@shared/ai/agentHook'
import type { AgentConfiguration } from '@shared/data/api/schemas/agents'

import type { AgentRuntimeHookHandler, AgentRuntimeHookInput, AgentRuntimeToolApprovalRequest } from '../runtime/types'

const logger = loggerService.withContext('AgentHookSession')
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_INPUT_BYTES = 1024 * 1024

interface HookSessionContext {
  sessionId: string
  agentId: string
  runtime: string
  getConfiguration: () => AgentConfiguration | undefined
  getCwd: () => string | undefined
}

interface HookCommandResult {
  code: number | null
  output: string
  failure?: string
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
    await Promise.allSettled([...this.pending])
  }

  private async invokeOnce(input: AgentRuntimeHookInput, signal: AbortSignal) {
    if (signal.aborted) return { denied: input.event === 'preToolUse', reason: 'Hook execution was cancelled.' }
    this.started ??= this.run({ event: 'sessionStart', messageId: input.messageId }, signal)
    await this.started
    if (signal.aborted) return { denied: input.event === 'preToolUse', reason: 'Hook execution was cancelled.' }
    if (input.event === 'sessionStart') return {}
    return this.run(input, signal)
  }

  private async run(input: AgentRuntimeHookInput, signal: AbortSignal): ReturnType<AgentRuntimeHookHandler> {
    try {
      const configuration = this.context.getConfiguration()
      const hooks = AgentHookListSchema.parse(configuration?.hooks ?? []).filter(
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
      const env = { ...(await getShellEnv()), ...configuration?.env_vars }
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
  ): Promise<HookCommandResult> {
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
    if (signal.aborted) return { code: null, output: '', failure: 'cancelled' }
    const child = crossPlatformSpawn(command, args, {
      cwd,
      env,
      detached: !isWindows,
      windowsHide: true,
      stdio: 'pipe'
    })
    return this.collect(child, hook.timeoutMs, stdin, signal)
  }

  private collect(
    child: ChildProcess,
    timeoutMs: number,
    stdin: string,
    signal: AbortSignal
  ): Promise<HookCommandResult> {
    return new Promise((resolve) => {
      let outputBytes = 0
      const output: Buffer[] = []
      let failure: string | undefined
      let settled = false
      let stopping: Promise<void> | undefined
      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve({ code, output: Buffer.concat(output).toString('utf8'), failure })
      }
      const stop = (reason: string) => {
        failure ??= reason
        stopping ??= (async () => {
          try {
            await terminateProcessTree(child, true, 'Agent Hook')
            if (!(await waitForProcessExit(child, 2000)))
              logger.error('Agent Hook process did not exit', { pid: child.pid })
          } catch (error) {
            logger.error('Agent Hook process termination failed', { pid: child.pid, error })
          } finally {
            child.stdin?.destroy()
            child.stdout?.destroy()
            child.stderr?.destroy()
            finish(null)
          }
        })()
      }
      const onAbort = () => stop('cancelled')
      const timer = setTimeout(() => stop('timed out'), timeoutMs)
      timer.unref?.()
      const onData = (data: Buffer) => {
        const remaining = MAX_OUTPUT_BYTES - outputBytes
        if (remaining > 0) output.push(data.subarray(0, remaining))
        outputBytes += data.length
        if (outputBytes > MAX_OUTPUT_BYTES) stop('output exceeds 64 KiB')
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.once('error', (error) => {
        failure = error.message
        finish(null)
      })
      child.once('close', (code) => {
        if (!stopping) finish(code)
      })
      child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') stop(error.message)
      })
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      else child.stdin?.end(stdin)
    })
  }
}

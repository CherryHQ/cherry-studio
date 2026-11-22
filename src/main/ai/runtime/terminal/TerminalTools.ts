import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Context } from '@earendil-works/chord/context'
import type {
  BackgroundBashOperations,
  BashOperations,
  ToolDefinition,
  createBashToolDefinition
} from '@earendil-works/pi-coding-agent'
import type { ShellExecOptions, Result, ShellExecResult, ExecutionError } from '@earendil-works/pi-durable/env'
import type { BackgroundBashExec, createBashTool } from '@earendil-works/pi-durable/tools'
import type { TSchema } from 'typebox'
import * as z from 'zod'

import { application } from '@application'
import {
  terminalConversationId,
  terminalResourceId,
  type TerminalResourceState
} from '@main/services/terminal/contracts'
import type { TerminalLease, TerminalResourceRef } from '@main/services/terminal/TerminalService'
import { findExecutableInEnv } from '@main/utils/commandResolver'

import { loadPiSdk } from '../pi/piSdk'
import { mergePiShellExecutionEnv, resolvePiShellPath } from '../pi/piShell'
import { ShellOutput } from './ShellOutput'

const id = z.string().min(1).max(512)
const revision = z.number().int().nonnegative()
export const terminalToolSchemas = {
  terminal_open: z.object({
    shell: z.enum(['bash', 'powershell']).default('bash'),
    cols: z.number().int().min(2).max(256).default(80),
    rows: z.number().int().min(2).max(80).default(24)
  }),
  terminal_send: z.object({
    terminal_id: id,
    control_revision: revision,
    kind: z.enum(['command', 'input']),
    data: z
      .string()
      .min(1)
      .max(32 * 1024),
    prompt_revision: revision.optional(),
    draft_revision: revision.optional(),
    command_id: id.optional(),
    program_revision: revision.optional(),
    yield_ms: z.number().int().min(0).max(30_000).default(1000)
  }),
  terminal_list: z.object({ cursor: revision.default(0) }),
  terminal_signal: z.object({
    terminal_id: id,
    control_revision: revision,
    command_id: id,
    program_revision: revision,
    signal: z.literal('SIGINT').default('SIGINT')
  }),
  terminal_read: z.object({ terminal_id: id, cursor: revision.default(0) }),
  terminal_close: z.object({ terminal_id: id, control_revision: revision }),
  shell_task_list: z.object({ cursor: revision.default(0) }),
  shell_task_read: z.object({ execution_id: id, cursor: revision.default(0) }),
  shell_task_stop: z.object({ execution_id: id, control_revision: revision })
}
const descriptions: Record<keyof typeof terminalToolSchemas, string> = {
  terminal_open:
    'Create a persistent interactive terminal in this conversation. Separate from fresh bash/powershell calls. Returns its identity, control revision and verified shell facts.',
  terminal_send:
    'Send a command only at a verified prompt, or raw stdin to the expected running command. Commands require prompt_revision and draft_revision from a verified empty editor; stdin requires command_id and program_revision. Busy commands are refused. Yielding or cancelling the wait leaves the terminal running.',
  terminal_list:
    'List persistent terminals in this conversation, with their shell, control and command facts. Paged reads never acquire control.',
  terminal_signal:
    'Interrupt the expected foreground program with terminal Ctrl-C (SIGINT), keeping the persistent shell alive. Requires its current control and program revisions.',
  terminal_read:
    'Read bounded terminal output by byte cursor, including current shell, control and command facts. Reading never runs a command.',
  terminal_close:
    'Close this persistent terminal and its managed process scope. Unconfirmed cleanup stays visible and can be retried.',
  shell_task_list:
    "List this conversation's session-owned fresh-shell tasks, including actual exit status and cleanup. Never starts another model turn.",
  shell_task_read: 'Read bounded output of an existing fresh-shell background task by execution identity and cursor.',
  shell_task_stop:
    'Stop an existing fresh-shell background task by execution identity. Does not affect sibling processes or user-controlled work.'
}
interface Call {
  thread: string
  id: string
}
class ShellExecutableError extends Error {
  readonly code = 'spawn_error'
}
interface PipeOptions {
  cwd: string
  env: Record<string, string>
  timeout?: number
  signal?: AbortSignal
  background?: boolean
  onData?: (data: Uint8Array, truncated: boolean, source: 'stdout' | 'stderr' | 'terminal') => void
}

/** One runtime connection's adapters; TerminalService owns all retained process resources. */
export class TerminalTools {
  private readonly scope = new AsyncLocalStorage<Call>()
  private readonly leases = new Map<string, Promise<TerminalLease>>()
  private readonly bindingId = randomUUID()
  private readonly invocations = new Map<
    string,
    { signature: string; result: Promise<Awaited<ReturnType<TerminalTools['runPipe']>>> }
  >()
  private closed = false
  readonly conversationId

  constructor(
    conversationId: string,
    readonly cwd: string,
    readonly env: Record<string, string>
  ) {
    this.conversationId = terminalConversationId.parse(conversationId)
  }

  private get service() {
    return application.get('TerminalService')
  }

  private lease(thread: string): Promise<TerminalLease> {
    if (this.closed) return Promise.reject(new Error('Terminal runtime was released'))
    let lease = this.leases.get(thread)
    if (!lease) {
      lease = this.service.attachRuntime({
        conversationId: this.conversationId,
        contextId: thread,
        bindingId: this.bindingId
      })
      this.leases.set(thread, lease)
    }
    return lease
  }

  bindPi<T extends ReturnType<typeof createBashToolDefinition>>(tool: T): T {
    return {
      ...tool,
      execute: (id, args, signal, update, context) =>
        this.scope.run({ thread: context.sessionManager.getSessionId(), id }, () =>
          tool.execute(id, args, signal, update, context)
        )
    }
  }

  piBashOperations(): BackgroundBashOperations {
    return {
      exec: async (command, cwd, options) => {
        const call = this.scope.getStore()
        if (!call) throw new Error('Shell call has no native identity')
        const sdk = await loadPiSdk()
        const config = sdk.getShellConfig(resolvePiShellPath())
        return this.pipe(
          call,
          config.commandTransport === 'stdin' ? config.args : [...config.args, command],
          config.shell,
          'bash',
          {
            cwd,
            env: mergePiShellExecutionEnv(options.env ?? this.env),
            timeout: options.timeout,
            signal: options.signal,
            background: options.runInBackground,
            onData: (data, gap) => {
              if (gap) throw new Error('Shell output observation was truncated')
              options.onData(Buffer.from(data))
            }
          },
          config.commandTransport === 'stdin' ? command : ''
        )
      }
    }
  }

  piPowerShellOperations(): BashOperations {
    return {
      exec: async (command, cwd, options) => {
        const call = this.scope.getStore()
        if (!call) throw new Error('Shell call has no native identity')
        const sdk = await loadPiSdk()
        const native = sdk.createLocalPowerShellOperations((config) => ({
          exec: async (prepared, cwd, options) => {
            const result = await this.pipe(call, [...config.args, prepared], config.shell, 'powershell', {
              cwd,
              env: mergePiShellExecutionEnv(options.env ?? this.env),
              timeout: options.timeout,
              signal: options.signal,
              onData: (data, gap) => {
                if (gap) throw new Error('Shell output observation was truncated')
                options.onData(Buffer.from(data))
              }
            })
            if (result.status !== 'completed') throw new Error('PowerShell execution did not complete')
            return { exitCode: result.exitCode }
          }
        }))
        return native.exec(command, cwd, options)
      }
    }
  }

  private pipe(
    call: Call,
    args: string[],
    program: string,
    shell: 'bash' | 'powershell',
    options: PipeOptions,
    stdin = ''
  ) {
    const key = JSON.stringify([call.thread, call.id])
    const signature = createHash('sha256')
      .update(
        JSON.stringify({
          args,
          program,
          shell,
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeout,
          background: options.background,
          stdin
        })
      )
      .digest('hex')
    const known = this.invocations.get(key)
    if (known) {
      if (known.signature !== signature) throw new Error('Shell execution identity conflict')
      return known.result
    }
    if (this.invocations.size >= 1024) throw new Error('Shell invocation capacity exceeded')
    const result = this.runPipe(call, args, program, shell, options, stdin)
    this.invocations.set(key, { signature, result })
    return result
  }

  private async runPipe(
    call: Call,
    args: string[],
    program: string,
    shell: 'bash' | 'powershell',
    options: PipeOptions,
    stdin: string
  ) {
    const lease = await this.lease(call.thread)
    options.signal?.throwIfAborted()
    const file = path.isAbsolute(program)
      ? program
      : await findExecutableInEnv(program, { env: options.env, signal: options.signal })
    if (!file) throw new ShellExecutableError(`Shell executable unavailable: ${program}`)
    const receipt = await this.service.start({
      lease,
      replayKey: call.id,
      turnId: call.id,
      background: options.background,
      onOutput: options.onData,
      launch: {
        kind: 'pipe',
        shell,
        file,
        args,
        cwd: options.cwd,
        env: options.env,
        stdin,
        ...(options.timeout !== undefined && { deadlineAt: Date.now() + options.timeout * 1000 })
      }
    })
    if (receipt.kind !== 'resource')
      throw new Error(`Shell admission rejected: ${receipt.kind === 'rejected' ? receipt.reason : 'invalid receipt'}`)
    const ref = { host: receipt.resource.host, id: receipt.resource.id }
    let result: Awaited<ReturnType<typeof this.service.wait>>
    try {
      result = await this.service.wait(ref, { signal: options.signal, foreground: true })
    } catch (error) {
      await this.service.stopTurn(lease, call.id)
      throw error
    } finally {
      this.service.detachOutput(ref)
    }
    if (result.status === 'running')
      return { status: 'running' as const, executionId: ref.id, outputCursor: result.resource.outputCursor }
    if (result.status === 'cancelled') throw new Error('aborted')
    if (result.status === 'control_transferred')
      throw new Error('Shell control transferred; execution remains available in Terminal')
    if (result.resource.stopReason === 'deadline') throw new Error(`timeout:${options.timeout}`)
    const process = result.resource.process
    if (process.kind !== 'exited') throw new Error('Shell execution outcome is unknown')
    return { status: 'completed' as const, exitCode: process.signal ? 128 + process.signal : process.exitCode }
  }

  private resource(value: string, kind: 'pipe' | 'pty'): TerminalResourceState {
    const resource = this.service.list(this.conversationId).find((item) => item.id === value && item.kind === kind)
    if (!resource) throw new Error('Terminal resource is unavailable in this conversation')
    return resource
  }

  async execute(name: keyof typeof terminalToolSchemas, input: unknown, call: Call, signal?: AbortSignal) {
    if (!call.id || call.id.length > 512) throw new Error('Invalid native terminal call identity')
    const lease = await this.lease(call.thread)
    signal?.throwIfAborted()
    if (name === 'terminal_open') {
      const args = terminalToolSchemas.terminal_open.parse(input)
      const sdk = await loadPiSdk()
      const config =
        args.shell === 'bash'
          ? sdk.getShellConfig(resolvePiShellPath())
          : process.platform === 'win32'
            ? sdk.getPowerShellConfig()
            : { shell: 'pwsh', args: [] }
      const file = path.isAbsolute(config.shell)
        ? config.shell
        : await findExecutableInEnv(config.shell, { env: this.env, signal })
      if (!file || (args.shell === 'bash' && !/bash(?:\.exe)?$/i.test(file)))
        throw new Error('Managed shell integration requires Bash or PowerShell')
      const receipt = await this.service.start({
        lease,
        replayKey: call.id,
        turnId: call.id,
        launch: {
          kind: 'pty',
          shell: args.shell,
          file,
          args: [],
          cwd: this.cwd,
          env: this.env,
          cols: args.cols,
          rows: args.rows
        }
      })
      if (receipt.kind !== 'resource') return receipt
      const result = await this.service.wait(
        { host: receipt.resource.host, id: receipt.resource.id },
        { signal, budgetMs: 5000, prompt: true }
      )
      return { kind: 'resource' as const, resource: result.resource }
    }
    if (name === 'terminal_signal') {
      const args = terminalToolSchemas.terminal_signal.parse(input)
      const resource = this.resource(args.terminal_id, 'pty')
      return this.service.mutate(
        { host: resource.host, id: resource.id },
        {
          kind: 'interrupt',
          id: resource.id,
          actor: { kind: 'agent', context: lease.context },
          controlRevision: args.control_revision,
          commandId: args.command_id,
          programRevision: args.program_revision
        },
        `${call.thread}:${call.id}`
      )
    }
    if (name === 'shell_task_list' || name === 'terminal_list') {
      const { cursor } = terminalToolSchemas[name].parse(input)
      const all = this.service
        .list(this.conversationId)
        .filter((item) =>
          name === 'terminal_list' ? item.kind === 'pty' : item.kind === 'pipe' && item.retention.kind === 'session'
        )
      const tasks: TerminalResourceState[] = []
      let bytes = 0
      for (const task of all.slice(cursor, cursor + 32)) {
        const size = Buffer.byteLength(JSON.stringify(task))
        if (bytes + size > 48 * 1024) break
        tasks.push(task)
        bytes += size
      }
      return {
        ...(name === 'terminal_list' ? { terminals: tasks } : { tasks }),
        nextCursor: cursor + tasks.length < all.length ? cursor + tasks.length : null
      }
    }
    if (name === 'terminal_read' || name === 'shell_task_read') {
      const args =
        name === 'terminal_read'
          ? terminalToolSchemas.terminal_read.parse(input)
          : terminalToolSchemas.shell_task_read.parse(input)
      const resource = this.resource(
        'terminal_id' in args ? args.terminal_id : args.execution_id,
        name === 'terminal_read' ? 'pty' : 'pipe'
      )
      const read = this.service.readText({ host: resource.host, id: resource.id }, args.cursor)
      return { resource, ...read }
    }
    if (name === 'terminal_close' || name === 'shell_task_stop') {
      const args =
        name === 'terminal_close'
          ? terminalToolSchemas.terminal_close.parse(input)
          : terminalToolSchemas.shell_task_stop.parse(input)
      const resource = this.resource(
        'terminal_id' in args ? args.terminal_id : args.execution_id,
        name === 'terminal_close' ? 'pty' : 'pipe'
      )
      return this.service.mutate(
        { host: resource.host, id: resource.id },
        {
          kind: 'stop',
          id: resource.id,
          actor: { kind: 'agent', context: lease.context },
          controlRevision: args.control_revision,
          cancelRevision: resource.cancelRevision,
          reason: name === 'terminal_close' ? 'terminal_close' : 'task_stop'
        },
        `${call.thread}:${call.id}`
      )
    }
    const args = terminalToolSchemas.terminal_send.parse(input)
    const resource = this.resource(args.terminal_id, 'pty')
    const ref: TerminalResourceRef = { host: resource.host, id: terminalResourceId.parse(args.terminal_id) }
    const common = {
      id: resource.id,
      actor: { kind: 'agent' as const, context: lease.context },
      controlRevision: args.control_revision,
      data: args.data
    }
    const commandId = `${call.thread}:${call.id}`
    const receipt =
      args.kind === 'command'
        ? await this.service.mutate(
            ref,
            {
              kind: 'shell-command',
              ...common,
              commandId,
              promptRevision: z.number().parse(args.prompt_revision),
              draftRevision: z.number().parse(args.draft_revision)
            },
            commandId
          )
        : await this.service.mutate(
            ref,
            {
              kind: 'input',
              ...common,
              commandId: z.string().parse(args.command_id),
              programRevision: z.number().parse(args.program_revision)
            },
            commandId
          )
    if (receipt.kind !== 'resource' || args.kind === 'input') return receipt
    const result = await this.service.wait(ref, { signal, budgetMs: args.yield_ms, commandId })
    return { status: result.status, resource: result.resource }
  }

  piTools(): ToolDefinition[] {
    return (Object.keys(terminalToolSchemas) as (keyof typeof terminalToolSchemas)[]).map((name) => ({
      name,
      label: name,
      description: descriptions[name],
      parameters: z.toJSONSchema(terminalToolSchemas[name], { io: 'input' }) as TSchema,
      execute: async (id, args, signal, _update, context) => {
        const result = await this.execute(name, args, { thread: context.sessionManager.getSessionId(), id }, signal)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], details: result }
      }
    }))
  }

  async durableTools() {
    const { defineTool } = await import('@earendil-works/pi-durable')
    return (Object.keys(terminalToolSchemas) as (keyof typeof terminalToolSchemas)[]).map((name) =>
      defineTool({
        name,
        description: descriptions[name],
        parameters: z.toJSONSchema(terminalToolSchemas[name], { io: 'input' }),
        replay: 'unsafe',
        execute: async (args, api, context) => ({
          output: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                await this.execute(
                  name,
                  args,
                  { thread: String(api.conversationId), id: api.callId },
                  context.abortSignal
                )
              )
            }
          ]
        })
      })
    )
  }

  bindDurable<T extends ReturnType<typeof createBashTool>>(tool: T): T {
    return {
      ...tool,
      execute: (args, api, context) =>
        this.scope.run({ thread: String(api.conversationId), id: api.callId }, () => {
          const environment = api.env
          if (!environment) throw new Error('Shell execution environment is unavailable')
          const env = new Proxy(environment, {
            get: (target, key) => {
              if (key === 'exec')
                return (command: string | readonly string[], options: ShellExecOptions | undefined, ctx: Context) =>
                  this.durableExec(command, options, ctx, { thread: String(api.conversationId), id: api.callId }).then(
                    (result) => {
                      if (!result.ok) return result
                      if ('status' in result.value) throw new Error('Unexpected background shell result')
                      return { ok: true as const, value: result.value }
                    }
                  )
              const value = Reflect.get(target, key)
              return typeof value === 'function' ? value.bind(target) : value
            }
          })
          return tool.execute(args, { ...api, env }, context)
        })
    }
  }

  durableBackground(): BackgroundBashExec {
    return (command, options, context) => {
      const call = this.scope.getStore()
      if (!call) throw new Error('Shell call has no native identity')
      return this.durableExec(command, options, context, call, options.runInBackground)
    }
  }

  async durableExec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
    call: Call,
    background = false
  ): Promise<
    Result<ShellExecResult | { status: 'running'; executionId: string; outputCursor: number }, ExecutionError>
  > {
    const { ok, err, ExecutionError } = await import('@earendil-works/pi-durable/env')
    const output = new ShellOutput(options?.spill, (text, stream) => options?.onOutput?.(text, context, { stream }))
    try {
      let argv: string[]
      let stdin = ''
      if (typeof command === 'string') {
        const config = (await loadPiSdk()).getShellConfig(resolvePiShellPath())
        argv =
          config.commandTransport === 'stdin' ? [config.shell, ...config.args] : [config.shell, ...config.args, command]
        if (config.commandTransport === 'stdin') stdin = command
      } else argv = [...command]
      const program = argv[0]
      if (!program) throw new Error('Shell command is empty')
      const env = options?.inheritEnv === false ? (options.env ?? {}) : { ...process.env, ...this.env, ...options?.env }
      const result = await this.pipe(
        call,
        argv.slice(1),
        program,
        typeof command !== 'string' ? 'powershell' : 'bash',
        {
          cwd: options?.cwd ?? this.cwd,
          env: Object.fromEntries(
            Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)
          ),
          timeout: options?.timeout,
          signal: context.abortSignal,
          background,
          onData: (data, truncated, source) => {
            if (truncated) throw new Error('Shell output observation was truncated')
            output.push(data, source === 'stderr' ? 'stderr' : 'stdout')
          }
        },
        stdin
      )
      output.close()
      if (result.status === 'running') return ok({ ...result, spillPath: output.path })
      if (result.exitCode === null) throw new Error('Shell exit code is unknown')
      return ok({ exitCode: result.exitCode, spillPath: output.path })
    } catch (cause) {
      const error = new ExecutionError(
        context.abortSignal?.aborted
          ? 'aborted'
          : cause instanceof ShellExecutableError
            ? cause.code
            : cause instanceof Error && cause.message.startsWith('timeout:')
              ? 'timeout'
              : 'unknown',
        cause instanceof Error ? cause.message : String(cause)
      )
      error.spillPath = output.path
      return err(error)
    } finally {
      output.close()
    }
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.all([...this.leases.values()].map(async (lease) => this.service.releaseRuntime(await lease)))
  }
}

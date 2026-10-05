import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough, type Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import {
  type ClaudeCodeProcessDiagnostics,
  createClaudeCodeProcessDiagnostics,
  recordClaudeCodeProcessExit,
  recordClaudeCodeSpawnError,
  resetClaudeCodeProcessDiagnostics
} from './processExitDiagnostics'

const logger = loggerService.withContext('ClaudeCodeProcessManager')

// Mirrors the SDK's own `ProcessTransport` local spawn, which the custom spawner replaces:
// exit is delivered only once stderr closed, so an exit consumer sees the whole tail.
const STDERR_TAIL_LIMIT = 2048
const STDERR_DRAIN_GRACE_MS = 200

function utf8Tail(text: string): string {
  const bytes = Buffer.from(text)
  if (bytes.length <= STDERR_TAIL_LIMIT) return text

  let start = bytes.length - STDERR_TAIL_LIMIT
  while ((bytes[start] & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString()
}

type TrackedSpawnedProcess = SpawnedProcess & { readonly pid?: number }
type SpawnedChildProcess = TrackedSpawnedProcess & { readonly stderr: Readable }

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string
    env: NodeJS.ProcessEnv
    signal: AbortSignal
    stdio: ['pipe', 'pipe', 'pipe']
    windowsHide: true
  }
) => SpawnedChildProcess

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void
type ErrorListener = (error: Error) => void

class ManagedClaudeCodeProcess implements SpawnedProcess {
  private readonly events = new EventEmitter()
  private stderrTail = ''
  private stderrClosed = false
  private pendingExit?: { code: number | null; signal: NodeJS.Signals | null }
  private drainTimer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly child: SpawnedChildProcess,
    private readonly diagnostics: ClaudeCodeProcessDiagnostics
  ) {
    const decoder = new StringDecoder('utf8')
    child.stderr.on('data', (chunk: Buffer | string) => this.appendStderr(decoder.write(Buffer.from(chunk))))
    child.stderr.once('close', () => {
      this.appendStderr(decoder.end())
      this.stderrClosed = true
      this.deliverExit()
    })
    child.stderr.once('error', () => {
      this.stderrClosed = true
      this.deliverExit()
    })
    child.once('exit', (code, signal) => {
      this.pendingExit = { code, signal }
      if (this.stderrClosed) return this.deliverExit()
      this.drainTimer = setTimeout(() => {
        child.stderr.destroy()
        this.deliverExit()
      }, STDERR_DRAIN_GRACE_MS)
      this.drainTimer.unref?.()
    })
    child.once('error', (error) => {
      recordClaudeCodeSpawnError(diagnostics, error)
      this.logTerminalReason()
      this.events.emit('error', error)
    })
  }

  get stdin() {
    return this.child.stdin
  }

  get stdout() {
    return this.child.stdout
  }

  get killed() {
    return this.child.killed
  }

  get exitCode() {
    return this.child.exitCode
  }

  get signalCode() {
    return this.child.signalCode
  }

  get pid() {
    return this.child.pid
  }

  kill(signal: NodeJS.Signals): boolean {
    return this.child.kill(signal)
  }

  on(event: 'exit', listener: ExitListener): void
  on(event: 'error', listener: ErrorListener): void
  on(event: 'exit' | 'error', listener: ExitListener | ErrorListener): void {
    this.events.on(event, listener)
  }

  once(event: 'exit', listener: ExitListener): void
  once(event: 'error', listener: ErrorListener): void
  once(event: 'exit' | 'error', listener: ExitListener | ErrorListener): void {
    this.events.once(event, listener)
  }

  off(event: 'exit', listener: ExitListener): void
  off(event: 'error', listener: ErrorListener): void
  off(event: 'exit' | 'error', listener: ExitListener | ErrorListener): void {
    this.events.off(event, listener)
  }

  private appendStderr(text: string): void {
    this.stderrTail = utf8Tail(`${this.stderrTail}${text}`)
  }

  private deliverExit(): void {
    const exit = this.pendingExit
    if (!exit) return
    this.pendingExit = undefined
    if (this.drainTimer) clearTimeout(this.drainTimer)
    recordClaudeCodeProcessExit(this.diagnostics, exit.code, exit.signal, this.stderrTail)
    if (exit.code !== 0) this.logTerminalReason()
    this.events.emit('exit', exit.code, exit.signal)
  }

  /** Correlate the renderer reference with structured diagnostics without persisting untrusted stderr. */
  private logTerminalReason(): void {
    logger.warn('Claude Code process failed', {
      reference: this.diagnostics.reference,
      category: this.diagnostics.category,
      exitCode: this.diagnostics.exitCode,
      exitSignal: this.diagnostics.exitSignal,
      spawnFailed: this.diagnostics.spawnFailed
    })
  }
}

/**
 * Owns every Claude Code CLI handle this app spawns: the stdio contract that arms the CLI's own
 * parent-death exit, plus the registry a shutdown sweep needs. Consumers `@DependsOn` it so it
 * initialises first and therefore stops last, after they have closed their queries.
 */
@Injectable('ClaudeCodeProcessManager')
@ServicePhase(Phase.WhenReady)
export class ClaudeCodeProcessManager extends BaseService {
  private readonly processes = new Set<TrackedSpawnedProcess>()

  /** Seam for tests. A constructor parameter would break the container's `ServiceConstructor` shape. */
  protected spawnProcess: SpawnProcess = (command, args, options) => spawn(command, args, options)

  spawn(options: SpawnOptions, diagnostics = createClaudeCodeProcessDiagnostics()): SpawnedProcess {
    resetClaudeCodeProcessDiagnostics(diagnostics)
    // libuv throws synchronously when it cannot set up the child's stdio (notably `EBADF` on
    // macOS, where the new pipes land above Apple's `OPEN_MAX` spawn ceiling). A synchronous
    // throw leaves no handle to attach `once('error')` to, so it would escape the wrapper's
    // error listener and reach the SDK as a bare `Error: spawn EBADF`. Convert it into the
    // async `error` contract the SDK already handles on one shared shape.
    const rawChild = this.spawnOrThrow(options, diagnostics)
    diagnostics.exited = new Promise<void>((resolve) => {
      rawChild.once('exit', () => resolve())
      rawChild.once('error', () => {
        if (rawChild.pid === undefined) resolve()
      })
    })
    const child = new ManagedClaudeCodeProcess(rawChild, diagnostics) as TrackedSpawnedProcess
    this.processes.add(child)
    // Untracked on the raw exit, not the wrapper's — no reason to hold a dead handle through the drain.
    rawChild.once('exit', () => this.processes.delete(child))
    child.once('error', () => {
      if (child.pid === undefined) this.processes.delete(child)
    })
    return child
  }

  /**
   * Spawn, converting a synchronous throw into a handle that delivers `error` asynchronously.
   * The stand-in keeps the `SpawnedProcess` contract (unresolved pid, no streams) so the
   * existing listeners observe the failure through the same path as a late spawn error.
   */
  private spawnOrThrow(options: SpawnOptions, diagnostics: ClaudeCodeProcessDiagnostics): SpawnedChildProcess {
    try {
      return this.spawnProcess(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        // Keeping stdin a pipe is also what makes the CLI exit on its own once this app dies.
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      const events = new EventEmitter()
      // Inert pipes, not nulls: the SDK reads `stdin`/`stdout` right after the spawn call returns,
      // and a missing stream would throw a TypeError that masks the spawn failure it came from.
      const [stdin, stdout, stderr] = [new PassThrough(), new PassThrough(), new PassThrough()]
      const standIn = {
        pid: undefined,
        stdin,
        stdout,
        stderr,
        killed: false,
        exitCode: null,
        signalCode: null,
        kill: () => false,
        on: events.on.bind(events),
        once: events.once.bind(events),
        off: events.off.bind(events)
      } as unknown as SpawnedChildProcess
      recordClaudeCodeSpawnError(diagnostics, failure)
      // Deferred: emitting synchronously would outrun listeners the SDK attaches after this
      // returns — the same ordering the bare throw used to break.
      queueMicrotask(() => events.emit('error', failure))
      return standIn
    }
  }

  /**
   * Best-effort sweep over the handles this app spawned. Synchronous and waits for nothing — the OS
   * can cut shutdown short at any point, so a child that must not outlive the app cannot rely on
   * this running.
   */
  killAll(signal: NodeJS.Signals): void {
    for (const child of [...this.processes]) {
      if (this.hasExited(child)) {
        this.processes.delete(child)
        continue
      }
      try {
        child.kill(signal)
      } catch (error) {
        logger.warn('Failed to signal Claude Code subprocess', { signal, error })
      }
    }
  }

  protected onStop(): void {
    this.killAll('SIGTERM')
  }

  private hasExited(child: TrackedSpawnedProcess): boolean {
    return child.exitCode !== null || child.signalCode != null
  }
}

/** Stable reference for SDK `Options`, so a warm signature stays comparable across queries. */
export const spawnClaudeCodeProcess = (options: SpawnOptions): SpawnedProcess =>
  application.get('ClaudeCodeProcessManager').spawn(options)

export { createClaudeCodeProcessDiagnostics } from './processExitDiagnostics'

export const createSpawnClaudeCodeProcess =
  (diagnostics: ClaudeCodeProcessDiagnostics) =>
  (options: SpawnOptions): SpawnedProcess =>
    application.get('ClaudeCodeProcessManager').spawn(options, diagnostics)

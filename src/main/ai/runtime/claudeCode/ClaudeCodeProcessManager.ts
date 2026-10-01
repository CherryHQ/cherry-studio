import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { prepareClaudeCodeSpawnCapacity, type ClaudeCodeSpawnPriority, MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES } from './claudeCodeSpawnCapacity'
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
  /** Evicted warm children stay here until exit so shutdown still signals them. */
  private readonly evictingProcesses = new Set<TrackedSpawnedProcess>()
  private readonly processesByDiagnostics = new Map<string, TrackedSpawnedProcess>()
  /** In-flight spawn attempts reserve a cap slot until the child is tracked or admission fails. */
  private reservedSpawnSlots = 0

  /** Seam for tests. A constructor parameter would break the container's `ServiceConstructor` shape. */
  protected spawnProcess: SpawnProcess = (command, args, options) => spawn(command, args, options)

  /** Every CLI child still running, including evicted warm ones finishing their SIGTERM. */
  getActiveProcessCount(): number {
    return this.processes.size + this.evictingProcesses.size + this.reservedSpawnSlots
  }

  /**
   * Children that still hold a spawn-cap slot: live children and parked warm queries. Evicted warm
   * children freed their slot when they were signaled, even though they stay active until exit.
   */
  getCapSlotProcessCount(): number {
    return this.processes.size
  }

  waitForActiveProcessBelowCap(max: number, timeoutMs: number): Promise<void> {
    if (this.getActiveProcessCount() < max) return Promise.resolve()
    return new Promise((resolve) => {
      const tryResolve = () => {
        if (this.getActiveProcessCount() < max) {
          clearInterval(poll)
          clearTimeout(timer)
          resolve()
        }
      }
      const poll = setInterval(tryResolve, 50)
      poll.unref?.()
      const timer = setTimeout(() => {
        clearInterval(poll)
        resolve()
      }, timeoutMs)
      timer.unref?.()
      tryResolve()
    })
  }

  /**
   * Drop a parked warm query's CLI child from the active cap before its async dispose finishes.
   * No-op when the reference is unknown or the process already exited.
   */
  releaseWarmQueryProcess(diagnosticsReference: string): void {
    const child = this.processesByDiagnostics.get(diagnosticsReference)
    if (!child) return
    this.forgetProcess(child, diagnosticsReference)
    if (this.hasExited(child)) return
    this.trackEvictingProcess(child)
    try {
      child.kill('SIGTERM')
    } catch (error) {
      logger.warn('Failed to signal Claude Code subprocess during warm eviction', { error })
    }
  }

  spawn(
    options: SpawnOptions,
    diagnostics = createClaudeCodeProcessDiagnostics(),
    priority: ClaudeCodeSpawnPriority = 'live'
  ): SpawnedProcess {
    if (!prepareClaudeCodeSpawnCapacity(priority)) {
      const error = new Error('Claude Code CLI process cap reached')
      recordClaudeCodeSpawnError(diagnostics, error)
      throw error
    }
    this.reservedSpawnSlots++
    try {
      if (this.getActiveProcessCount() > MAX_CONCURRENT_CLAUDE_CODE_CLI_PROCESSES) {
        const error = new Error('Claude Code CLI process cap reached')
        recordClaudeCodeSpawnError(diagnostics, error)
        throw error
      }
      resetClaudeCodeProcessDiagnostics(diagnostics)
      const rawChild = this.spawnProcess(options.command, options.args, {
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
        // Keeping stdin a pipe is also what makes the CLI exit on its own once this app dies.
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      diagnostics.exited = new Promise<void>((resolve) => {
        rawChild.once('exit', () => resolve())
        rawChild.once('error', () => {
          if (rawChild.pid === undefined) resolve()
        })
      })
      const child = new ManagedClaudeCodeProcess(rawChild, diagnostics) as TrackedSpawnedProcess
      this.trackProcess(child, diagnostics.reference)
      // Untracked on the raw exit, not the wrapper's — no reason to hold a dead handle through the drain.
      rawChild.once('exit', () => this.forgetProcess(child, diagnostics.reference))
      child.once('error', () => {
        if (child.pid === undefined) this.forgetProcess(child, diagnostics.reference)
      })
      return child
    } finally {
      this.reservedSpawnSlots--
    }
  }

  /**
   * Best-effort sweep over the handles this app spawned. Synchronous and waits for nothing — the OS
   * can cut shutdown short at any point, so a child that must not outlive the app cannot rely on
   * this running.
   */
  killAll(signal: NodeJS.Signals): void {
    for (const child of [...this.processes, ...this.evictingProcesses]) {
      if (this.hasExited(child)) {
        this.forgetProcess(child)
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

  private trackProcess(child: TrackedSpawnedProcess, diagnosticsReference: string): void {
    this.processes.add(child)
    this.processesByDiagnostics.set(diagnosticsReference, child)
  }

  private trackEvictingProcess(child: TrackedSpawnedProcess): void {
    this.evictingProcesses.add(child)
    const release = () => this.evictingProcesses.delete(child)
    child.once('exit', release)
    child.once('error', () => {
      if (child.pid === undefined) release()
    })
  }

  private forgetProcess(child: TrackedSpawnedProcess, diagnosticsReference?: string): void {
    this.processes.delete(child)
    this.evictingProcesses.delete(child)
    if (diagnosticsReference) {
      this.processesByDiagnostics.delete(diagnosticsReference)
      return
    }
    for (const [reference, tracked] of this.processesByDiagnostics) {
      if (tracked === child) this.processesByDiagnostics.delete(reference)
    }
  }
}

/** Stable reference for SDK `Options`, so a warm signature stays comparable across queries. */
export const spawnClaudeCodeProcess = (options: SpawnOptions): SpawnedProcess =>
  application.get('ClaudeCodeProcessManager').spawn(options)

export { createClaudeCodeProcessDiagnostics } from './processExitDiagnostics'

export const createSpawnClaudeCodeProcess =
  (diagnostics: ClaudeCodeProcessDiagnostics, priority: ClaudeCodeSpawnPriority = 'live') =>
  (options: SpawnOptions): SpawnedProcess =>
    application.get('ClaudeCodeProcessManager').spawn(options, diagnostics, priority)

import { spawn } from 'node:child_process'

import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { loggerService } from '@logger'

const logger = loggerService.withContext('ClaudeCodeProcessManager')
const GRACEFUL_EXIT_TIMEOUT_MS = 2_000
const SIGTERM_EXIT_TIMEOUT_MS = 1_000

type TrackedSpawnedProcess = SpawnedProcess & { readonly pid?: number }

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string
    env: NodeJS.ProcessEnv
    signal: AbortSignal
    stdio: ['pipe', 'pipe', 'ignore']
    windowsHide: true
  }
) => TrackedSpawnedProcess

type TrackedProcess = {
  process: TrackedSpawnedProcess
  signals: Set<NodeJS.Signals>
}

type ShutdownPhase = 'running' | 'graceful' | 'sigterm' | 'sigkill' | 'complete'

export class ClaudeCodeProcessManager {
  private readonly processes = new Map<TrackedSpawnedProcess, TrackedProcess>()
  private readonly emptyWaiters = new Set<() => void>()
  private shutdownPhase: ShutdownPhase = 'running'
  private shutdownPromise?: Promise<void>

  constructor(
    private readonly spawnProcess: SpawnProcess = (command, args, options) => spawn(command, args, options)
  ) {}

  readonly spawnClaudeCodeProcess = (options: SpawnOptions): SpawnedProcess => {
    const child = this.spawnProcess(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      // The SDK custom-spawn contract exposes no stderr stream; an unread pipe could block the CLI.
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })
    const tracked = { process: child, signals: new Set<NodeJS.Signals>() }
    this.processes.set(child, tracked)
    child.once('exit', () => this.remove(child))
    child.once('error', () => {
      if (child.pid === undefined) this.remove(child)
    })

    if (this.shutdownPhase === 'sigterm') this.signal(tracked, 'SIGTERM')
    if (this.shutdownPhase === 'sigkill' || this.shutdownPhase === 'complete') this.signal(tracked, 'SIGKILL')
    return child
  }

  shutdown(close: () => void | Promise<void>): Promise<void> {
    const gracefulClose = this.runGracefulClose(close)
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.runShutdown(gracefulClose).catch((error) => {
        logger.warn('Claude Code subprocess shutdown failed', { error })
      })
    }
    return this.shutdownPromise
  }

  private async runShutdown(gracefulClose: Promise<void>): Promise<void> {
    this.shutdownPhase = 'graceful'
    await this.waitAtMost(
      Promise.all([gracefulClose, this.whenEmpty()]).then(() => undefined),
      GRACEFUL_EXIT_TIMEOUT_MS
    )

    this.shutdownPhase = 'sigterm'
    this.signalAll('SIGTERM')
    if (this.processes.size > 0) {
      await this.waitAtMost(this.whenEmpty(), SIGTERM_EXIT_TIMEOUT_MS)
    }

    this.shutdownPhase = 'sigkill'
    this.signalAll('SIGKILL')
    this.shutdownPhase = 'complete'
  }

  private runGracefulClose(close: () => void | Promise<void>): Promise<void> {
    try {
      return Promise.resolve(close()).catch((error) => {
        logger.warn('Claude Code graceful shutdown failed', { error })
      })
    } catch (error) {
      logger.warn('Claude Code graceful shutdown failed', { error })
      return Promise.resolve()
    }
  }

  private signalAll(signal: NodeJS.Signals): void {
    this.removeExitedProcesses()
    for (const tracked of this.processes.values()) this.signal(tracked, signal)
  }

  private signal(tracked: TrackedProcess, signal: NodeJS.Signals): void {
    if (!this.processes.has(tracked.process) || tracked.signals.has(signal)) return
    if (this.hasExited(tracked.process)) {
      this.remove(tracked.process)
      return
    }
    tracked.signals.add(signal)
    try {
      tracked.process.kill(signal)
    } catch (error) {
      logger.warn('Failed to signal Claude Code subprocess', { signal, error })
    }
  }

  private hasExited(child: TrackedSpawnedProcess): boolean {
    return child.exitCode !== null || child.signalCode != null
  }

  private removeExitedProcesses(): void {
    for (const child of this.processes.keys()) {
      if (this.hasExited(child)) this.remove(child)
    }
  }

  private remove(child: TrackedSpawnedProcess): void {
    if (!this.processes.delete(child) || this.processes.size > 0) return
    for (const resolve of this.emptyWaiters) resolve()
    this.emptyWaiters.clear()
  }

  private whenEmpty(): Promise<void> {
    this.removeExitedProcesses()
    if (this.processes.size === 0) return Promise.resolve()
    return new Promise((resolve) => this.emptyWaiters.add(resolve))
  }

  private async waitAtMost(promise: Promise<void>, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    await Promise.race([promise, timeout])
    if (timer) clearTimeout(timer)
  }
}

export const claudeCodeProcessManager = new ClaudeCodeProcessManager()
export const spawnClaudeCodeProcess = claudeCodeProcessManager.spawnClaudeCodeProcess

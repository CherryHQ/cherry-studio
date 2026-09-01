import { spawn } from 'node:child_process'

import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

const logger = loggerService.withContext('ClaudeCodeProcessManager')

type TrackedSpawnedProcess = SpawnedProcess & { readonly pid?: number }

export type SpawnProcess = (
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

  spawn(options: SpawnOptions): SpawnedProcess {
    const child = this.spawnProcess(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      // The SDK custom-spawn contract exposes no stderr stream; an unread pipe could block the CLI.
      // Keeping stdin a pipe is also what makes the CLI exit on its own once this app dies.
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    })
    this.processes.add(child)
    child.once('exit', () => this.processes.delete(child))
    child.once('error', () => {
      if (child.pid === undefined) this.processes.delete(child)
    })
    return child
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

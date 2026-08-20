import type { ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import type { HermesDashboardStatus } from '@shared/ipc/schemas/hermesDashboard'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { redactSecretText } from '@shared/utils/redaction'
import { Mutex } from 'async-mutex'

const logger = loggerService.withContext('HermesDashboardService')
const execFileAsync = promisify(execFile)

const DASHBOARD_HOST = '127.0.0.1'
const START_TIMEOUT_MS = 30_000
const HEALTH_PROBE_TIMEOUT_MS = 2_000
const HEALTH_PROBE_INTERVAL_MS = 250
const GRACEFUL_STOP_TIMEOUT_MS = 3_000
const FORCE_STOP_TIMEOUT_MS = 1_000
const OUTPUT_CAPTURE_LIMIT = 32 * 1024
const DIAGNOSTIC_LIMIT = 2_000

interface HermesDashboardRuntime {
  env: NodeJS.ProcessEnv
  executablePath: string
}

@Injectable('HermesDashboardService')
@ServicePhase(Phase.WhenReady)
export class HermesDashboardService extends BaseService {
  private readonly operationMutex = new Mutex()
  private readonly startupAbortControllers = new Set<AbortController>()
  private child: ChildProcess | null = null
  private isLifecycleStopping = false
  private status: HermesDashboardStatus = 'stopped'
  private stoppingChild: ChildProcess | null = null
  private url: string | undefined

  protected onInit(): void {
    this.isLifecycleStopping = false
  }

  protected async onStop(): Promise<void> {
    this.isLifecycleStopping = true
    await this.stop()
  }

  getStatus(): { status: HermesDashboardStatus; url?: string } {
    return { status: this.status, ...(this.url ? { url: this.url } : {}) }
  }

  async start(): Promise<{ success: true; url: string } | { success: false; message: string }> {
    const startupAbortController = new AbortController()
    this.startupAbortControllers.add(startupAbortController)
    try {
      return await this.operationMutex.runExclusive(async () => {
        if (this.isLifecycleStopping) {
          return { success: false, message: 'Hermes Dashboard is unavailable during application shutdown' }
        }
        if (startupAbortController.signal.aborted) {
          return { success: false, message: 'Hermes Dashboard startup was cancelled' }
        }
        if (this.child && this.status === 'running' && this.url) {
          return { success: true, url: this.url }
        }
        if (this.child) await this.stopOwnedProcessLocked()

        try {
          this.status = 'starting'
          this.url = undefined
          const runtime = await this.resolveRuntime()
          if (startupAbortController.signal.aborted) throw new Error('Hermes Dashboard startup was cancelled')
          const port = await findAvailablePort()
          if (startupAbortController.signal.aborted) throw new Error('Hermes Dashboard startup was cancelled')
          const url = `http://${DASHBOARD_HOST}:${port}`
          await this.spawnAndWaitForReady(runtime, port, url, startupAbortController.signal)
          if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
            throw new Error('Hermes Dashboard exited immediately after becoming ready')
          }
          this.status = 'running'
          this.url = url
          return { success: true, url }
        } catch (error) {
          await this.stopOwnedProcessLocked().catch((stopError) => {
            logger.warn('Failed to stop Hermes Dashboard after launch failure', stopError as Error)
          })
          this.status = 'error'
          this.url = undefined
          return {
            success: false,
            message: sanitizeDiagnostic(error instanceof Error ? error.message : 'Failed to start Hermes Dashboard')
          }
        }
      })
    } finally {
      this.startupAbortControllers.delete(startupAbortController)
    }
  }

  async stop(): Promise<void> {
    for (const startup of this.startupAbortControllers) startup.abort()
    await this.operationMutex.runExclusive(async () => {
      try {
        await this.stopOwnedProcessLocked()
        this.status = 'stopped'
      } catch (error) {
        this.status = 'error'
        throw error
      } finally {
        this.url = undefined
      }
    })
  }

  private async resolveRuntime(): Promise<HermesDashboardRuntime> {
    const snapshot = (await application.get('BinaryManager').getToolSnapshots(['hermes'])).hermes
    if (snapshot.availability.source === 'none') throw new Error('Hermes is not installed')
    const env = snapshot.availability.source === 'system' ? await getRawShellEnv() : await refreshShellEnv()
    return { env, executablePath: AbsoluteFilePathSchema.parse(snapshot.availability.path) }
  }

  private async spawnAndWaitForReady(
    runtime: HermesDashboardRuntime,
    port: number,
    url: string,
    signal: AbortSignal
  ): Promise<void> {
    const child = crossPlatformSpawn(
      runtime.executablePath,
      ['dashboard', '--host', DASHBOARD_HOST, '--port', String(port), '--no-open'],
      {
        env: runtime.env,
        detached: !isWin,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    )
    this.child = child
    const handleTermination = (code: number | null, childSignal: NodeJS.Signals | null) =>
      this.handleChildTermination(child, code, childSignal)
    child.once('exit', handleTermination)
    child.once('close', handleTermination)
    child.on('error', (error) => {
      if (this.child === child && this.status === 'running') this.status = 'error'
      logger.warn('Managed Hermes Dashboard process error', { message: sanitizeDiagnostic(error.message) })
    })

    await waitForReady(child, url, signal)
  }

  private handleChildTermination(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = null
    this.url = undefined
    if (this.stoppingChild === child) {
      this.stoppingChild = null
      this.status = 'stopped'
      return
    }
    if (this.status === 'starting' || this.status === 'running') {
      this.status = 'error'
      logger.warn('Managed Hermes Dashboard process exited unexpectedly', { code, signal })
    }
  }

  private async stopOwnedProcessLocked(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stoppingChild = child
    try {
      await terminateOwnedProcess(child, false)
      if (await waitForTermination(child, GRACEFUL_STOP_TIMEOUT_MS)) return

      await terminateOwnedProcess(child, true)
      if (!(await waitForTermination(child, FORCE_STOP_TIMEOUT_MS))) {
        throw new Error('Hermes Dashboard did not exit after forced termination')
      }
    } catch (error) {
      if (this.stoppingChild === child) this.stoppingChild = null
      throw error
    }
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, DASHBOARD_HOST, () => resolve())
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  if (!address || typeof address === 'string' || address.port < 1) {
    throw new Error('Failed to allocate a local port for Hermes Dashboard')
  }
  return address.port
}

async function assertDashboardReady(url: string): Promise<void> {
  const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) })
  await response.body?.cancel()
  if (!response.ok) throw new Error(`Hermes Dashboard returned HTTP ${response.status}`)
}

function appendBounded(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-OUTPUT_CAPTURE_LIMIT)
}

function sanitizeDiagnostic(value: string): string {
  return redactSecretText(value).slice(0, DIAGNOSTIC_LIMIT)
}

function waitForReady(child: ChildProcess, url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let checkingHealth = false

    const cleanup = () => {
      clearTimeout(timeout)
      clearInterval(healthInterval)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onClose)
      child.off('close', onClose)
      signal.removeEventListener('abort', onAbort)
      child.stdout?.resume()
      child.stderr?.resume()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      const diagnostic = sanitizeDiagnostic([error.message, stderr, stdout].filter(Boolean).join('\n'))
      reject(new Error(diagnostic || 'Hermes Dashboard failed during startup'))
    }
    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const checkHealth = () => {
      if (checkingHealth || settled) return
      checkingHealth = true
      void assertDashboardReady(url)
        .then(succeed)
        .catch(() => undefined)
        .finally(() => {
          checkingHealth = false
        })
    }
    const onStdout = (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk)
    }
    const onStderr = (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    }
    const onError = (error: Error) => fail(error)
    const onAbort = () => fail(new Error('Hermes Dashboard startup was cancelled'))
    const onClose = (code: number | null, childSignal: NodeJS.Signals | null) =>
      fail(
        new Error(`Hermes Dashboard exited before it was ready (code ${String(code)}, signal ${String(childSignal)})`)
      )
    const timeout = setTimeout(() => fail(new Error('Hermes Dashboard startup timed out')), START_TIMEOUT_MS)
    const healthInterval = setInterval(checkHealth, HEALTH_PROBE_INTERVAL_MS)

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onClose)
    child.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    else checkHealth()
  })
}

async function terminateOwnedProcess(child: ChildProcess, force: boolean): Promise<void> {
  if (!child.pid) return
  if (isWin) {
    const args = ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])]
    await execFileAsync('taskkill', args, { windowsHide: true }).catch((error) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      if (force) throw error
      logger.warn('Failed to gracefully stop the managed Hermes Dashboard process tree', error as Error)
    })
    return
  }

  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

function waitForTermination(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', onClose)
      child.off('close', onClose)
      resolve(false)
    }, timeoutMs)
    const onClose = () => {
      clearTimeout(timeout)
      child.off('exit', onClose)
      child.off('close', onClose)
      resolve(true)
    }
    child.once('exit', onClose)
    child.once('close', onClose)
  })
}

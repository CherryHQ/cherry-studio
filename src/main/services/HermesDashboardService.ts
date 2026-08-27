import type { ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import type { HermesDashboardStartFailureReason, HermesDashboardStatus } from '@shared/ipc/schemas/hermesDashboard'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { redactSecretText } from '@shared/utils/redaction'
import { Mutex } from 'async-mutex'

const logger = loggerService.withContext('HermesDashboardService')

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

class HermesDashboardStartError extends Error {
  constructor(
    readonly reason: HermesDashboardStartFailureReason,
    message: string
  ) {
    super(message)
    this.name = 'HermesDashboardStartError'
  }
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

  /** Serializes native Hermes config mutations with the Dashboard lifecycle. */
  async writeConfigFiles<T>(write: () => Promise<T>): Promise<T> {
    return this.operationMutex.runExclusive(async () => {
      if (this.child || this.stoppingChild || this.status === 'starting' || this.status === 'running') {
        throw new Error('Hermes Agent web UI is running, so its configuration cannot be changed')
      }
      return write()
    })
  }

  async start(): Promise<
    { success: true; url: string } | { success: false; reason: HermesDashboardStartFailureReason; message: string }
  > {
    const startupAbortController = new AbortController()
    this.startupAbortControllers.add(startupAbortController)
    try {
      return await this.operationMutex.runExclusive(async () => {
        if (this.isLifecycleStopping) {
          return {
            success: false,
            reason: 'cancelled',
            message: 'Hermes Dashboard is unavailable during application shutdown'
          }
        }
        if (startupAbortController.signal.aborted) {
          return { success: false, reason: 'cancelled', message: 'Hermes Dashboard startup was cancelled' }
        }
        if (this.child && this.status === 'running' && this.url) {
          return { success: true, url: this.url }
        }

        try {
          // Reaping a leftover child belongs inside the try so a failing stop is
          // mapped to a failure Result, not thrown out of start().
          if (this.child) await this.stopOwnedProcessLocked()
          this.updateStatus('starting')
          const runtime = await this.resolveRuntime()
          if (startupAbortController.signal.aborted) {
            throw new HermesDashboardStartError('cancelled', 'Hermes Dashboard startup was cancelled')
          }
          const port = await findAvailablePort()
          if (startupAbortController.signal.aborted) {
            throw new HermesDashboardStartError('cancelled', 'Hermes Dashboard startup was cancelled')
          }
          const url = `http://${DASHBOARD_HOST}:${port}`
          await this.spawnAndWaitForReady(runtime, port, url, startupAbortController.signal)
          if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
            throw new HermesDashboardStartError(
              'startup_failed',
              'Hermes Dashboard exited immediately after becoming ready'
            )
          }
          this.updateStatus('running', url)
          return { success: true, url }
        } catch (error) {
          await this.stopOwnedProcessLocked().catch((stopError) => {
            logger.warn('Failed to stop Hermes Dashboard after launch failure', stopError as Error)
          })
          this.updateStatus('error')
          const message = sanitizeDiagnostic(
            error instanceof Error ? error.message : 'Failed to start Hermes Dashboard'
          )
          return {
            success: false,
            reason: getStartFailureReason(error, message),
            message
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
        this.updateStatus('stopped')
      } catch (error) {
        this.updateStatus('error')
        throw error
      }
    })
  }

  private async resolveRuntime(): Promise<HermesDashboardRuntime> {
    const snapshot = (await application.get('BinaryManager').getToolSnapshots(['hermes'])).hermes
    if (snapshot.availability.source === 'none') {
      throw new HermesDashboardStartError('not_installed', 'Hermes is not installed')
    }
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
      if (this.child === child && this.status === 'running') this.updateStatus('error')
      logger.warn('Managed Hermes Dashboard process error', { message: sanitizeDiagnostic(error.message) })
    })

    await waitForReady(child, url, signal)
  }

  private handleChildTermination(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = null
    if (this.stoppingChild === child) {
      this.stoppingChild = null
      this.updateStatus('stopped')
      return
    }
    if (this.status === 'starting' || this.status === 'running') {
      this.updateStatus('error')
      logger.warn('Managed Hermes Dashboard process exited unexpectedly', { code, signal })
    }
  }

  private updateStatus(status: HermesDashboardStatus, url?: string): void {
    this.status = status
    this.url = url
    try {
      application.get('IpcApiService').broadcast('hermes_dashboard.status_changed', this.getStatus())
    } catch (error) {
      logger.warn('Failed to broadcast Hermes Dashboard status', error as Error)
    }
  }

  private async stopOwnedProcessLocked(): Promise<void> {
    const child = this.child
    if (!child) return
    if (!child.pid) {
      this.child = null
      if (this.stoppingChild === child) this.stoppingChild = null
      return
    }
    this.stoppingChild = child
    try {
      await terminateProcessTree(child, false, 'Hermes Dashboard')
      if (await waitForProcessExit(child, GRACEFUL_STOP_TIMEOUT_MS)) return

      await terminateProcessTree(child, true, 'Hermes Dashboard')
      if (!(await waitForProcessExit(child, FORCE_STOP_TIMEOUT_MS))) {
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
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Hermes Dashboard returned HTTP ${response.status}`)
  }
  // A foreign process can hold our freshly-picked port before Hermes binds; confirm the
  // /api/status body is Hermes's own so we never open the wrong server as the Dashboard.
  const body = await response.json().catch(() => null)
  if (!isHermesStatusBody(body)) {
    throw new Error('Hermes Dashboard health endpoint returned an unrecognized response')
  }
}

function isHermesStatusBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Record<string, unknown>).hermes_home === 'string' &&
    'gateway_running' in body
  )
}

function appendBounded(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-OUTPUT_CAPTURE_LIMIT)
}

function sanitizeDiagnostic(value: string): string {
  return redactSecretText(value).slice(0, DIAGNOSTIC_LIMIT)
}

function getStartFailureReason(error: unknown, message: string): HermesDashboardStartFailureReason {
  if (error instanceof HermesDashboardStartError) return error.reason
  if (/dashboard startup was cancelled/i.test(message)) return 'cancelled'
  return 'startup_failed'
}

function isMissingDashboardDependencyDiagnostic(value: string): boolean {
  return /web ui requires\b.*\bfastapi\b.*\buvicorn\b/i.test(value)
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
      const rawDiagnostic = [error.message, stderr, stdout].filter(Boolean).join('\n')
      const diagnostic = sanitizeDiagnostic(rawDiagnostic)
      if (isMissingDashboardDependencyDiagnostic(rawDiagnostic)) {
        reject(
          new HermesDashboardStartError(
            'dashboard_dependencies_missing',
            diagnostic || 'Hermes Dashboard dependencies are missing'
          )
        )
        return
      }
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

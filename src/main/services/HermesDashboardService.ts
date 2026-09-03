import { realpath } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { getHermesHome } from '@main/services/codeCli'
import { type ChildProcessHandle, type ProcessLogLine, ProcessState } from '@main/services/process'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import type { HermesDashboardStartFailureReason, HermesDashboardStatus } from '@shared/ipc/schemas/hermesDashboard'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { redactSecretText } from '@shared/utils/redaction'
import { Mutex } from 'async-mutex'

const logger = loggerService.withContext('HermesDashboardService')

const DASHBOARD_HOST = '127.0.0.1'
const START_TIMEOUT_MS = 30_000
const HEALTH_PROBE_TIMEOUT_MS = 2_000
const HEALTH_PROBE_INTERVAL_MS = 250
const OUTPUT_CAPTURE_LIMIT = 32 * 1024
const DIAGNOSTIC_LIMIT = 2_000
const HERMES_DASHBOARD_PROCESS_ID = 'hermes-dashboard'

interface HermesDashboardRuntime {
  env: Record<string, string>
  executablePath: string
  home: AbsoluteFilePath
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
@DependsOn(['ProcessManager'])
export class HermesDashboardService extends BaseService {
  private readonly operationMutex = new Mutex()
  private readonly startupAbortControllers = new Set<AbortController>()
  private processHandle: ChildProcessHandle | null = null
  private isLifecycleStopping = false
  private status: HermesDashboardStatus = 'stopped'
  private stoppingHandle: ChildProcessHandle | null = null
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
      if (this.processHandle || this.stoppingHandle || this.status === 'starting' || this.status === 'running') {
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
        if (this.processHandle && this.status === 'running' && this.url) {
          return { success: true, url: this.url }
        }

        try {
          // Reaping a leftover child belongs inside the try so a failing stop is
          // mapped to a failure Result, not thrown out of start().
          if (this.processHandle) await this.stopOwnedProcessLocked()
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
          if (!this.processHandle || this.processHandle.state !== ProcessState.Running) {
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
    const home = await getHermesHome()
    // Pin the Dashboard to the same home config writes target, so it reads what
    // Cherry wrote regardless of how Hermes would resolve its default.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'hermes_home') delete env[key]
    }
    env.HERMES_HOME = home
    return { env, executablePath: AbsoluteFilePathSchema.parse(snapshot.availability.path), home }
  }

  private async spawnAndWaitForReady(
    runtime: HermesDashboardRuntime,
    port: number,
    url: string,
    signal: AbortSignal
  ): Promise<void> {
    const pm = application.get('ProcessManager')
    const existing = pm.get(HERMES_DASHBOARD_PROCESS_ID)
    if (existing) {
      await existing.stop()
      await pm.unregister(HERMES_DASHBOARD_PROCESS_ID)
    }

    const handle = pm.register({
      id: HERMES_DASHBOARD_PROCESS_ID,
      command: runtime.executablePath,
      args: ['dashboard', '--host', DASHBOARD_HOST, '--port', String(port), '--no-open'],
      env: runtime.env,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.processHandle = handle

    const previousOnExited = handle.onExited
    handle.onExited = (code, childSignal) => {
      previousOnExited?.(code, childSignal)
      this.handleProcessTermination(handle, code, childSignal)
      void pm
        .unregister(HERMES_DASHBOARD_PROCESS_ID)
        .catch((error: unknown) => logger.warn('Failed to unregister Hermes Dashboard process', error as Error))
    }

    const readiness = waitForReady(handle, url, runtime.home, signal)
    void readiness.catch(() => undefined)
    await handle.start()
    await readiness
  }

  private handleProcessTermination(
    handle: ChildProcessHandle,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.processHandle !== handle) return
    this.processHandle = null
    if (this.stoppingHandle === handle) {
      this.stoppingHandle = null
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
    const handle = this.processHandle
    if (!handle) return
    this.stoppingHandle = handle
    try {
      await handle.stop()
      await application.get('ProcessManager').unregister(HERMES_DASHBOARD_PROCESS_ID)
      if (this.processHandle === handle) this.processHandle = null
      if (this.stoppingHandle === handle) this.stoppingHandle = null
    } catch (error) {
      if (this.stoppingHandle === handle) this.stoppingHandle = null
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

class HermesHomeMismatchError extends Error {}

async function assertDashboardReady(url: string, expectedHome: AbsoluteFilePath): Promise<void> {
  const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`Hermes Dashboard returned HTTP ${response.status}`)
  }
  // A foreign process can grab the freshly-freed port first; body shape + home check
  // filter accidental squatters but cannot prove the responder is our child process.
  const body = await response.json().catch(() => null)
  if (!isHermesStatusBody(body)) {
    throw new Error('Hermes Dashboard health endpoint returned an unrecognized response')
  }
  const reportedHome = normalizeHome(body.hermes_home)
  if (reportedHome === normalizeHome(expectedHome)) return
  // Symlink aliases only (macOS /tmp, /var): realpath the trusted pin — never the
  // reported string, and only off the fast path (network homes can hang realpath).
  const pinnedCanonicalHome = normalizeHome(await realpath(expectedHome).catch(() => expectedHome))
  if (reportedHome !== pinnedCanonicalHome) {
    throw new HermesHomeMismatchError(
      `Hermes Dashboard is using a different configuration home (reported ${body.hermes_home}, expected ${expectedHome})`
    )
  }
}

/** Lexical normalization only: resolve, plus Windows separator and casing folding. */
function normalizeHome(value: string): string {
  // path.win32 keeps the Windows normalization testable from POSIX hosts.
  const resolved = (isWin ? path.win32 : path).resolve(value)
  return isWin ? resolved.toLowerCase() : resolved
}

function isHermesStatusBody(body: unknown): body is { hermes_home: string; gateway_running: unknown } {
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

function waitForReady(
  handle: ChildProcessHandle,
  url: string,
  expectedHome: AbsoluteFilePath,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let checkingHealth = false

    const cleanup = () => {
      clearTimeout(timeout)
      clearInterval(healthInterval)
      if (handle.onLog === onLog) handle.onLog = previousOnLog
      if (handle.onExited === onExited) handle.onExited = previousOnExited
      signal.removeEventListener('abort', onAbort)
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
      void assertDashboardReady(url, expectedHome)
        .then(succeed)
        // The reported home is fixed at spawn: a mismatch can never heal, so fail
        // fast instead of probing into the startup timeout.
        .catch((error) => {
          if (error instanceof HermesHomeMismatchError) fail(error)
        })
        .finally(() => {
          checkingHealth = false
        })
    }
    const previousOnLog = handle.onLog
    const onLog = (line: ProcessLogLine) => {
      previousOnLog?.(line)
      if (line.stream === 'stdout') stdout = appendBounded(stdout, line.data)
      else stderr = appendBounded(stderr, line.data)
    }
    const onAbort = () => fail(new Error('Hermes Dashboard startup was cancelled'))
    const previousOnExited = handle.onExited
    const onExited = (code: number | null, childSignal: NodeJS.Signals | null) => {
      previousOnExited?.(code, childSignal)
      fail(
        new Error(`Hermes Dashboard exited before it was ready (code ${String(code)}, signal ${String(childSignal)})`)
      )
    }
    const timeout = setTimeout(() => fail(new Error('Hermes Dashboard startup timed out')), START_TIMEOUT_MS)
    const healthInterval = setInterval(checkHealth, HEALTH_PROBE_INTERVAL_MS)

    handle.onLog = onLog
    handle.onExited = onExited
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    else checkHealth()
  })
}

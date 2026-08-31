import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { type ChildProcessHandle, type ProcessLogLine, ProcessState } from '@main/services/process'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { BinaryAvailability } from '@shared/types/binary'
import type { DeepSeekHarnessPermissionMode, DeepSeekHarnessSettings } from '@shared/types/codeCli'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { isNonChatModel } from '@shared/utils/model'
import { isLoginBasedProvider } from '@shared/utils/provider'
import { redactLiteral, redactSecretText } from '@shared/utils/redaction'
import { Mutex } from 'async-mutex'

import {
  createDeepSeekHarnessDirectIdentity,
  type DeepSeekHarnessConfigReceipt,
  type DeepSeekHarnessMode,
  type DeepSeekHarnessProjection,
  resolveDeepSeekHarnessEndpoint,
  rollbackDeepSeekHarnessConfig,
  writeDeepSeekHarnessConfig
} from './config'

const logger = loggerService.withContext('DeepSeekHarnessService')

const START_TIMEOUT_MS = 30_000
const OUTPUT_CAPTURE_LIMIT = 32 * 1024
const DIAGNOSTIC_LIMIT = 2000
const DEEPSEEK_HARNESS_PROCESS_ID = 'deepseek-harness'
const NO_KEY_PLACEHOLDER = 'no-key-required'
const GATEWAY_ROUTE = 'cherry-studio-codemate-gateway'
const GATEWAY_CREDENTIAL_REF = 'CHERRY_STUDIO_CODEMATE_GATEWAY_API_KEY'
const MANAGED_CREDENTIAL_ENV = /^CHERRY_STUDIO_CODEMATE_(?:[A-F0-9]{12}|GATEWAY)_API_KEY$/i

type DeepSeekHarnessStatus = 'stopped' | 'starting' | 'running' | 'error'

interface DeepSeekHarnessStartInput extends DeepSeekHarnessSettings {
  mode: DeepSeekHarnessMode
  uniqueModelId: UniqueModelId
}

interface DeepSeekHarnessRuntime {
  path: string
  env: Record<string, string>
}

@Injectable('DeepSeekHarnessService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiGatewayService', 'ProcessManager'])
export class DeepSeekHarnessService extends BaseService {
  private readonly operationMutex = new Mutex()
  private status: DeepSeekHarnessStatus = 'stopped'
  private url: string | undefined
  private processHandle: ChildProcessHandle | null = null
  private stoppingHandle: ChildProcessHandle | null = null
  private runningPermissionMode: DeepSeekHarnessPermissionMode | undefined
  private readonly startupAbortControllers = new Set<AbortController>()
  // Bumped by every setStatus broadcast; request paths use it to detect no-op completions.
  private statusTransitionId = 0

  protected async onStop(): Promise<void> {
    await this.stop()
  }

  getStatus(): { status: DeepSeekHarnessStatus; url?: string } {
    return { status: this.status, ...(this.url ? { url: this.url } : {}) }
  }

  /** Single status-transition point: assign, then broadcast; same-value calls are not transitions. */
  private setStatus(status: DeepSeekHarnessStatus, options?: { force?: boolean }): void {
    if (!options?.force && this.status === status) return
    this.status = status
    this.statusTransitionId++
    try {
      application.get('IpcApiService').broadcast('deepseek_harness.status_changed', this.getStatus())
    } catch (err) {
      // A lost broadcast is corrected by the next transition or a request-completion
      // rebroadcast; it must never abort the transition itself.
      logger.warn('Failed to broadcast DeepSeek Harness status change', err as Error)
    }
  }

  async start(
    input: DeepSeekHarnessStartInput
  ): Promise<{ success: true; url: string } | { success: false; message: string }> {
    const startupAbortController = new AbortController()
    this.startupAbortControllers.add(startupAbortController)
    try {
      return await this.operationMutex.runExclusive(async () => {
        if (startupAbortController.signal.aborted) {
          return { success: false, message: 'DeepSeek Harness startup was cancelled' }
        }
        if (
          this.processHandle &&
          this.status === 'running' &&
          this.url &&
          this.runningPermissionMode === input.permissionMode
        ) {
          const runningHandle = this.processHandle
          const transitionBefore = this.statusTransitionId
          try {
            const { receipt } = await this.syncConfig(input)
            if (
              startupAbortController.signal.aborted ||
              this.processHandle !== runningHandle ||
              this.status !== 'running' ||
              !this.url
            ) {
              await this.rollbackLaunchConfig(receipt)
              throw new Error(
                startupAbortController.signal.aborted
                  ? 'DeepSeek Harness startup was cancelled'
                  : 'DeepSeek Harness exited while updating its configuration'
              )
            }
            // Idempotent success broadcasts nothing on its own — rebroadcast so a
            // renderer that missed an earlier event is corrected by this request.
            if (this.statusTransitionId === transitionBefore) this.setStatus('running', { force: true })
            return { success: true, url: this.url }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update DeepSeek Harness configuration'
            return { success: false, message: sanitizeDiagnostic(message) }
          }
        }
        if (this.processHandle) await this.stopOwnedProcessLocked()
        if (startupAbortController.signal.aborted) {
          return { success: false, message: 'DeepSeek Harness startup was cancelled' }
        }

        let receipt: DeepSeekHarnessConfigReceipt | undefined
        try {
          this.url = undefined
          this.setStatus('starting')
          const runtime = await this.resolveRuntime()
          if (startupAbortController.signal.aborted) {
            throw new Error('DeepSeek Harness startup was cancelled')
          }
          const synced = await this.syncConfig(input)
          const projection = synced.projection
          receipt = synced.receipt
          if (startupAbortController.signal.aborted) {
            throw new Error('DeepSeek Harness startup was cancelled')
          }
          const url = await this.spawnAndWaitForReady(
            runtime,
            projection,
            input.permissionMode,
            startupAbortController.signal
          )
          if (!this.processHandle || this.processHandle.state !== ProcessState.Running) {
            throw new Error('DeepSeek Harness exited immediately after becoming ready')
          }
          this.url = url
          this.setStatus('running')
          this.runningPermissionMode = input.permissionMode
          return { success: true, url }
        } catch (error) {
          // Terminal state first: the cleanup-driven termination handler must not
          // broadcast 'stopped' for a failed launch on its way to 'error'.
          this.url = undefined
          this.setStatus('error')
          await this.stopOwnedProcessLocked().catch((stopError) => {
            logger.warn('Failed to stop DeepSeek Harness after launch failure', stopError as Error)
          })
          if (receipt) await this.rollbackLaunchConfig(receipt)
          const message = error instanceof Error ? error.message : 'Failed to start DeepSeek Harness'
          return { success: false, message: sanitizeDiagnostic(message) }
        }
      })
    } finally {
      this.startupAbortControllers.delete(startupAbortController)
    }
  }

  async stop(): Promise<void> {
    for (const startup of this.startupAbortControllers) startup.abort()
    await this.operationMutex.runExclusive(async () => {
      const transitionBefore = this.statusTransitionId
      await this.stopOwnedProcessLocked()
      this.url = undefined
      this.runningPermissionMode = undefined
      this.setStatus('stopped')
      // A no-op stop (already stopped) still confirms the terminal state to the renderer.
      if (this.statusTransitionId === transitionBefore) this.setStatus('stopped', { force: true })
    })
  }

  private async rollbackLaunchConfig(receipt: DeepSeekHarnessConfigReceipt): Promise<void> {
    try {
      const rolledBack = await rollbackDeepSeekHarnessConfig(receipt)
      if (!rolledBack) logger.warn('Skipped DeepSeek Harness config rollback because the files changed concurrently')
    } catch (error) {
      logger.warn('Failed to roll back DeepSeek Harness config after launch failure', error as Error)
    }
  }

  private async findBinary(): Promise<Exclude<BinaryAvailability, { source: 'none' }> | null> {
    const snapshot = (await application.get('BinaryManager').getToolSnapshots(['dsh'])).dsh
    return snapshot.availability.source === 'none' ? null : snapshot.availability
  }

  private async resolveRuntime(): Promise<DeepSeekHarnessRuntime> {
    const binary = await this.findBinary()
    if (!binary) throw new Error('DeepSeek Harness is not installed')
    const env = binary.source === 'system' ? await getRawShellEnv() : await refreshShellEnv()
    return { path: AbsoluteFilePathSchema.parse(binary.path), env }
  }

  private async syncConfig(input: DeepSeekHarnessStartInput): Promise<{
    projection: DeepSeekHarnessProjection
    receipt: DeepSeekHarnessConfigReceipt
  }> {
    const projection = await this.resolveProjection(input)
    const receipt = await writeDeepSeekHarnessConfig(
      AbsoluteFilePathSchema.parse(application.getPath('external.deepseek_harness.config')),
      projection
    )
    return { projection, receipt }
  }

  private async resolveProjection(input: DeepSeekHarnessStartInput): Promise<DeepSeekHarnessProjection> {
    const uniqueModelId = UniqueModelIdSchema.parse(input.uniqueModelId)
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    const provider = providerService.getByProviderId(providerId)
    const model = modelService.getByKey(providerId, modelId)
    if (!provider.isEnabled || !model.isEnabled) throw new Error('The selected DeepSeek Harness model is disabled')
    if (isNonChatModel(model)) throw new Error('The selected DeepSeek Harness model must support chat')

    if (input.mode === 'gateway') {
      const gateway = application.get('ApiGatewayService')
      await gateway.start()
      const credentialValue = await gateway.ensureValidApiKey()
      const { host, port } = gateway.getCurrentConfig()
      return {
        route: GATEWAY_ROUTE,
        credentialRef: GATEWAY_CREDENTIAL_REF,
        credentialValue,
        displayName: 'Cherry Studio Unified Gateway',
        protocol: 'openai-completions',
        baseUrl: `${gatewayClientOrigin(host, port)}/v1`,
        model,
        modelId: formatGatewayModelId(providerId, model.apiModelId ?? modelId),
        agentPreset: input.agentPreset
      }
    }

    if (isLoginBasedProvider(provider)) {
      throw new Error('This provider must be used through the Unified Gateway')
    }
    const { protocol, baseUrl } = resolveDeepSeekHarnessEndpoint(provider, model)
    const { route, credentialRef } = createDeepSeekHarnessDirectIdentity(provider.id, protocol)
    const apiKey = providerService.getApiKeys(provider.id, { enabled: true })[0]?.key
    if (!apiKey && !provider.authOptional) throw new Error(`Provider ${provider.id} has no enabled API key`)

    return {
      route,
      credentialRef,
      credentialValue: apiKey ?? NO_KEY_PLACEHOLDER,
      displayName: `Cherry Studio: ${provider.name}`,
      protocol,
      baseUrl,
      model,
      modelId: model.apiModelId ?? modelId,
      agentPreset: input.agentPreset
    }
  }

  private async spawnAndWaitForReady(
    runtime: DeepSeekHarnessRuntime,
    projection: DeepSeekHarnessProjection,
    permissionMode: DeepSeekHarnessPermissionMode,
    signal: AbortSignal
  ): Promise<string> {
    const env = {
      ...runtime.env,
      DSH_HOME: application.getPath('external.deepseek_harness.config'),
      DSH_PERMISSION_MODE: permissionMode
    }
    for (const name of Object.keys(env)) {
      if (MANAGED_CREDENTIAL_ENV.test(name)) delete env[name]
    }

    const pm = application.get('ProcessManager')
    const existing = pm.get(DEEPSEEK_HARNESS_PROCESS_ID)
    if (existing) {
      await existing.stop()
      await pm.unregister(DEEPSEEK_HARNESS_PROCESS_ID)
    }

    const handle = pm.register({
      id: DEEPSEEK_HARNESS_PROCESS_ID,
      command: runtime.path,
      args: ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
      cwd: application.getPath('feature.deepseek_harness.workspace'),
      env,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.processHandle = handle

    const previousOnExited = handle.onExited
    handle.onExited = (code, childSignal) => {
      previousOnExited?.(code, childSignal)
      this.handleProcessTermination(handle, code, childSignal)
      void pm
        .unregister(DEEPSEEK_HARNESS_PROCESS_ID)
        .catch((error: unknown) => logger.warn('Failed to unregister DeepSeek Harness process', error as Error))
    }

    const readiness = waitForReady(handle, projection.credentialValue, signal)
    void readiness.catch(() => undefined)
    try {
      await handle.start()
      return await readiness
    } catch (error) {
      throw error instanceof Error ? error : new Error('DeepSeek Harness failed during startup')
    }
  }

  private handleProcessTermination(
    handle: ChildProcessHandle,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    if (this.processHandle !== handle) return
    this.processHandle = null
    this.url = undefined
    this.runningPermissionMode = undefined
    if (this.stoppingHandle === handle) {
      this.stoppingHandle = null
      // A teardown that began after the state already left starting/running (failed-launch
      // cleanup sets 'error' first) must not revive 'stopped'.
      if (this.status === 'starting' || this.status === 'running') this.setStatus('stopped')
      return
    }
    if (this.status === 'starting' || this.status === 'running') {
      this.setStatus('error')
      logger.warn('Managed DeepSeek Harness process exited unexpectedly', { code, signal })
    }
  }

  private async stopOwnedProcessLocked(): Promise<void> {
    const handle = this.processHandle
    if (!handle) return
    this.stoppingHandle = handle
    try {
      await handle.stop()
      await application.get('ProcessManager').unregister(DEEPSEEK_HARNESS_PROCESS_ID)
      if (this.processHandle === handle) this.processHandle = null
      if (this.stoppingHandle === handle) this.stoppingHandle = null
    } catch (error) {
      if (this.stoppingHandle === handle) this.stoppingHandle = null
      throw error
    }
  }
}

function appendBounded(current: string, chunk: Buffer | string): string {
  return `${current}${chunk.toString()}`.slice(-OUTPUT_CAPTURE_LIMIT)
}

function sanitizeDiagnostic(value: string, secret?: string): string {
  return redactSecretText(redactLiteral(value, secret)).slice(0, DIAGNOSTIC_LIMIT)
}

function parseReadyUrl(output: string): string | undefined {
  const match = /^dsh web: (http:\/\/127\.0\.0\.1:(\d{1,5}))(?:\s|$)/m.exec(output)
  if (!match) return undefined
  const port = Number(match[2])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  const url = new URL(match[1])
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/') return undefined
  return url.toString().replace(/\/$/, '')
}

async function assertWebReady(url: string): Promise<void> {
  const response = await fetch(`${url}/`, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  await response.body?.cancel()
  if (response.status !== 200) throw new Error(`DeepSeek Harness Web UI returned HTTP ${response.status}`)
}

function waitForReady(handle: ChildProcessHandle, secret: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let checkingUrl = false
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      if (handle.onLog === onLog) handle.onLog = previousOnLog
      if (handle.onExited === onExited) handle.onExited = previousOnExited
      signal.removeEventListener('abort', onAbort)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      const diagnostic = sanitizeDiagnostic([error.message, stderr, stdout].filter(Boolean).join('\n'), secret)
      reject(new Error(diagnostic || 'DeepSeek Harness failed during startup'))
    }
    const previousOnLog = handle.onLog
    const onLog = (line: ProcessLogLine) => {
      previousOnLog?.(line)
      if (line.stream === 'stderr') {
        stderr = appendBounded(stderr, line.data)
        return
      }
      stdout = appendBounded(stdout, line.data)
      const url = parseReadyUrl(stdout)
      if (!url || checkingUrl) return
      checkingUrl = true
      void assertWebReady(url)
        .then(() => {
          if (settled) return
          settled = true
          cleanup()
          resolve(url)
        })
        .catch((error) => fail(error instanceof Error ? error : new Error('DeepSeek Harness Web UI is unavailable')))
    }
    const onAbort = () => fail(new Error('DeepSeek Harness startup was cancelled'))
    const previousOnExited = handle.onExited
    const onExited = (code: number | null, signal: NodeJS.Signals | null) => {
      previousOnExited?.(code, signal)
      fail(new Error(`DeepSeek Harness exited before it was ready (code ${String(code)}, signal ${String(signal)})`))
    }
    const timeout = setTimeout(() => fail(new Error('DeepSeek Harness startup timed out')), START_TIMEOUT_MS)

    handle.onLog = onLog
    handle.onExited = onExited
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

import type { ChildProcess } from 'node:child_process'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { BinaryAvailability } from '@shared/types/binary'
import type { DeepSeekHarnessPermissionMode, DeepSeekHarnessSettings } from '@shared/types/codeCli'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { formatGatewayModelId, gatewayClientOrigin } from '@shared/utils/apiGateway'
import { isNonChatModel } from '@shared/utils/model'
import { isLoginBasedProvider } from '@shared/utils/provider'
import { redactLiteral, redactSecretText } from '@shared/utils/redaction'

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
const GRACEFUL_STOP_TIMEOUT_MS = 3000
const FORCE_STOP_TIMEOUT_MS = 1000
const OUTPUT_CAPTURE_LIMIT = 32 * 1024
const DIAGNOSTIC_LIMIT = 2000
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
  env: NodeJS.ProcessEnv
}

@Injectable('DeepSeekHarnessService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['ApiGatewayService'])
export class DeepSeekHarnessService extends BaseService {
  private readonly operationMutex = new Mutex()
  private status: DeepSeekHarnessStatus = 'stopped'
  private url: string | undefined
  private child: ChildProcess | null = null
  private stoppingChild: ChildProcess | null = null
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
          this.child &&
          this.status === 'running' &&
          this.url &&
          this.runningPermissionMode === input.permissionMode
        ) {
          const runningChild = this.child
          const transitionBefore = this.statusTransitionId
          try {
            const { receipt } = await this.syncConfig(input)
            if (
              startupAbortController.signal.aborted ||
              this.child !== runningChild ||
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
        if (this.child) await this.stopOwnedProcessLocked()
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
          if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
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

    const child = crossPlatformSpawn(runtime.path, ['web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: application.getPath('feature.deepseek_harness.workspace'),
      env,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child
    const handleTermination = (code: number | null, signal: NodeJS.Signals | null) =>
      this.handleChildTermination(child, code, signal)
    child.once('exit', handleTermination)
    child.once('close', handleTermination)
    child.on('error', (error) => {
      if (this.child === child && this.status === 'running') this.setStatus('error')
      logger.warn('Managed DeepSeek Harness process error', { message: sanitizeDiagnostic(error.message) })
    })

    try {
      return await waitForReady(child, projection.credentialValue, signal)
    } catch (error) {
      throw error instanceof Error ? error : new Error('DeepSeek Harness failed during startup')
    }
  }

  private handleChildTermination(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.child !== child) return
    this.child = null
    this.url = undefined
    this.runningPermissionMode = undefined
    if (this.stoppingChild === child) {
      this.stoppingChild = null
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
    const child = this.child
    if (!child) return
    this.stoppingChild = child
    await terminateProcessTree(child, false, 'DeepSeek Harness')
    if (await waitForProcessExit(child, GRACEFUL_STOP_TIMEOUT_MS)) return

    await terminateProcessTree(child, true, 'DeepSeek Harness')
    if (!(await waitForProcessExit(child, FORCE_STOP_TIMEOUT_MS))) {
      throw new Error('DeepSeek Harness did not exit after forced termination')
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

function waitForReady(child: ChildProcess, secret: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let checkingUrl = false
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
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
      const diagnostic = sanitizeDiagnostic([error.message, stderr, stdout].filter(Boolean).join('\n'), secret)
      reject(new Error(diagnostic || 'DeepSeek Harness failed during startup'))
    }
    const onStdout = (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk)
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
    const onStderr = (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    }
    const onError = (error: Error) => fail(error)
    const onAbort = () => fail(new Error('DeepSeek Harness startup was cancelled'))
    const onClose = (code: number | null, signal: NodeJS.Signals | null) =>
      fail(new Error(`DeepSeek Harness exited before it was ready (code ${String(code)}, signal ${String(signal)})`))
    const timeout = setTimeout(() => fail(new Error('DeepSeek Harness startup timed out')), START_TIMEOUT_MS)

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onClose)
    child.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

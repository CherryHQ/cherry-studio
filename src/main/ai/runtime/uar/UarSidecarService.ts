import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { ensureManagedSecrets } from '@main/services/prometheus/integrationConfig'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv } from '@main/utils/shellEnv'
import { assertUarEnabled, isUarEnabled } from '@shared/ai/agentRuntimeCapabilities'
import { uarCapabilitiesResponseSchema, type UarAdministrationCapabilities } from '@shared/types/prometheusIntegration'
import { redactSecretText } from '@shared/utils/redaction'

import { inspectUarPayload, requireUarPayload, type UarPayload } from './uarPayload'
import { uarPrincipalForSession } from './uarPrincipal'
import { type AppliedUarStorage, readAppliedUarStorage, writeAppliedUarStorage } from './uarStorageProfile'

const logger = loggerService.withContext('UarSidecarService')
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000
const PROVIDER_CREDENTIAL_ENV_PATTERNS = [/_API_KEY$/i, /_API_TOKEN$/i, /_ACCESS_TOKEN$/i, /_SECRET_KEY$/i]
const LEGACY_UAR_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'COHERE_API_KEY',
  'CONFIG_FILE',
  'EXTERNAL_CACHE_ENABLED',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'JWT_REQUIRED',
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_PROTOCOL',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'PERPLEXITY_API_KEY',
  'PORT',
  'RATE_LIMIT_ENABLED',
  'TIMEOUT_DISABLED',
  'TOGETHER_API_KEY'
])
const REQUIRED_CAPABILITIES = [
  'approval_lifecycle_v1',
  'host_history',
  'reasoning_effort',
  'run_scoped_credentials',
  'run_scoped_mcp_servers',
  'session_principal',
  'working_directory'
] as const

export interface UarSidecarEndpoint {
  baseUrl: string
  generation: number
  uarVersion: string
  capabilities: readonly string[]
  administration: UarAdministrationCapabilities
  storage: Omit<AppliedUarStorage, 'password'>
}

export type UarSidecarStatus = UarSidecarEndpoint & { state: 'running' }

type RunningSidecar = Omit<UarSidecarEndpoint, 'storage'> & {
  child: ChildProcess
  launchToken: string
  adminKey: string
  storage: AppliedUarStorage
}

function isolatedSidecarEnvironment(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => {
      const normalized = key.toUpperCase()
      return (
        !normalized.startsWith('UAR_') &&
        !normalized.startsWith('LLM_') &&
        !LEGACY_UAR_ENV_KEYS.has(normalized) &&
        !PROVIDER_CREDENTIAL_ENV_PATTERNS.some((pattern) => pattern.test(normalized))
      )
    })
  )
}

@Injectable('UarSidecarService')
@ServicePhase(Phase.WhenReady)
export class UarSidecarService extends BaseService {
  private readonly operation = new Mutex()
  private running?: RunningSidecar
  private startPromise?: Promise<RunningSidecar>
  private generation = 0
  private stopping = false

  protected onInit(): void {
    this.stopping = false
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    await this.operation.runExclusive(() => this.stopOwnedProcess())
  }

  async ensureReady(): Promise<UarSidecarEndpoint> {
    assertUarEnabled()
    const running = await this.ensureRunning()
    return {
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities,
      administration: running.administration,
      storage: this.storageStatus(running.storage)
    }
  }

  status(): UarSidecarStatus | undefined {
    if (!isUarEnabled()) return undefined
    const running = this.running
    if (!running || !this.isAlive(running.child)) return undefined
    return {
      state: 'running',
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities,
      administration: running.administration,
      storage: this.storageStatus(running.storage)
    }
  }

  payload(): UarPayload | undefined {
    return inspectUarPayload()
  }

  async restart(): Promise<UarSidecarEndpoint> {
    assertUarEnabled()
    const running = await this.operation.runExclusive(async () => {
      await this.stopOwnedProcess()
      const next = await this.startOwnedProcess(await readAppliedUarStorage())
      this.running = next
      return next
    })
    return {
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities,
      administration: running.administration,
      storage: this.storageStatus(running.storage)
    }
  }

  async applyStorage(candidate: AppliedUarStorage): Promise<UarSidecarEndpoint> {
    assertUarEnabled()
    const running = await this.operation.runExclusive(async () => {
      const previous = this.running?.storage ?? (await readAppliedUarStorage())
      await this.stopOwnedProcess()
      let next: RunningSidecar | undefined
      try {
        next = await this.startOwnedProcess(candidate)
        await writeAppliedUarStorage(candidate)
        this.running = next
        return next
      } catch (error) {
        if (next) await this.terminate(next.child)
        try {
          const restored = await this.startOwnedProcess(previous)
          this.running = restored
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'UAR storage apply and rollback both failed')
        }
        throw error
      }
    })
    return {
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities,
      administration: running.administration,
      storage: this.storageStatus(running.storage)
    }
  }

  async request(
    pathname: string,
    principal: string,
    init: RequestInit = {},
    expectedGeneration?: number
  ): Promise<Response> {
    assertUarEnabled()
    const running = await this.ensureRunning()
    if (expectedGeneration !== undefined && running.generation !== expectedGeneration) {
      throw new Error('UAR sidecar restarted before the request was admitted')
    }
    return this.authenticatedFetch(running, pathname, principal, init)
  }

  requestCurrent(
    pathname: string,
    principal: string,
    init: RequestInit = {},
    expectedGeneration?: number
  ): Promise<Response> | undefined {
    if (!isUarEnabled()) return undefined
    const running = this.running
    if (!running || !this.isAlive(running.child)) return undefined
    if (expectedGeneration !== undefined && running.generation !== expectedGeneration) return undefined
    return this.authenticatedFetch(running, pathname, principal, init)
  }

  /** Main-process-only administration request. The protected authority never
   * crosses IPC or appears in endpoint/status snapshots. */
  async adminRequest(pathname: string, init: RequestInit = {}, expectedGeneration?: number): Promise<Response> {
    assertUarEnabled()
    const running = await this.ensureRunning()
    if (expectedGeneration !== undefined && running.generation !== expectedGeneration) {
      throw new Error('UAR sidecar restarted before the administration request was admitted')
    }
    const headers = new Headers(init.headers)
    headers.set('x-uar-admin-key', running.adminKey)
    return this.authenticatedFetch(running, pathname, uarPrincipalForSession('admin'), { ...init, headers })
  }

  private async authenticatedFetch(
    running: RunningSidecar,
    pathname: string,
    principal: string,
    init: RequestInit
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${running.launchToken}`)
    headers.set('x-uar-principal', principal)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(new URL(pathname, running.baseUrl), { ...init, headers })
      if (response.status !== 429 || attempt === 5) return response
      await response.body?.cancel()
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error('UAR request exhausted its rate-limit retries')
  }

  private ensureRunning(): Promise<RunningSidecar> {
    assertUarEnabled()
    if (this.stopping) return Promise.reject(new Error('UAR sidecar is shutting down'))
    if (this.running && this.isAlive(this.running.child)) return Promise.resolve(this.running)
    this.startPromise ??= this.operation.runExclusive(async () => {
      if (this.running && this.isAlive(this.running.child)) return this.running
      await this.stopOwnedProcess()
      const running = await this.startOwnedProcess(await readAppliedUarStorage())
      this.running = running
      return running
    })
    return this.startPromise.finally(() => {
      this.startPromise = undefined
    })
  }

  private async startOwnedProcess(storage: AppliedUarStorage): Promise<RunningSidecar> {
    assertUarEnabled()
    const payload = requireUarPayload()
    const executable = payload.executable
    const launchToken = randomBytes(32).toString('hex')
    const managedSecrets = await ensureManagedSecrets()
    const adminKey = managedSecrets.uarAdminKey
    const credentialEncryptionKey = managedSecrets.uarCredentialEncryptionKey
    if (!adminKey || !credentialEncryptionKey) throw new Error('UAR protected authority could not be provisioned')
    const dataRoot = application.getPath('feature.agents.uar.data')
    const configFile = path.join(dataRoot, 'sidecar.yaml')
    const dotenvFile = path.join(dataRoot, '.env')
    await mkdir(dataRoot, { recursive: true, mode: 0o700 })
    await Promise.all([
      writeFile(configFile, '{}\n', { encoding: 'utf8', mode: 0o600 }),
      writeFile(dotenvFile, '', { encoding: 'utf8', mode: 0o600 })
    ])
    if (!isWin) await Promise.all([chmod(dataRoot, 0o700), chmod(configFile, 0o600), chmod(dotenvFile, 0o600)])
    const persistence =
      storage.profile.backend === 'remote'
        ? {
            UAR_PERSISTENCE__DATABASE_URL: storage.profile.endpoint,
            UAR_PERSISTENCE__SURREAL_USER: storage.profile.username,
            UAR_PERSISTENCE__SURREAL_PASS: storage.password ?? '',
            UAR_PERSISTENCE__SURREAL_AUTH_LEVEL: storage.profile.authLevel,
            UAR_PERSISTENCE__SURREAL_NS: storage.profile.namespace,
            UAR_PERSISTENCE__SURREAL_DB: storage.profile.database
          }
        : {
            UAR_PERSISTENCE__DATABASE_URL: `surrealkv://${path.resolve(dataRoot, 'runtime.db').replaceAll('\\', '/')}`
          }
    const env = {
      ...isolatedSidecarEnvironment(await getRawShellEnv()),
      UAR_SIDECAR: '1',
      UAR_SECURITY__SETTINGS_MUTATION_AUTH_REQUIRED: 'true',
      UAR_SECURITY__SETTINGS_ADMIN_KEY: adminKey,
      CREDENTIAL_ENCRYPTION_KEY: credentialEncryptionKey,
      UAR_PERSISTENCE__PROVIDER: 'surreal',
      ...persistence,
      UAR_BUILTIN_SKILLS_DIR: path.join(application.getPath('feature.prometheus.pack.runtime'), 'skills'),
      UAR_MODELS_DIR: payload.modelsDirectory,
      UAR_LOAD_IMPORTED_SKILLS: 'true',
      UAR_NATIVE_TOOLS__FILE_TOOLS_ENABLED: 'false',
      UAR_NATIVE_TOOLS__WEB_FETCH_ENABLED: 'false',
      UAR_NATIVE_TOOLS__TERMINAL_EXEC_ENABLED: 'false'
    }
    const child = crossPlatformSpawn(executable, ['--config', configFile], {
      cwd: dataRoot,
      env,
      detached: !isWin,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    child.on('error', (error) => logger.warn('UAR sidecar process error', { error }))
    child.stdin?.write(`${launchToken}\n`)

    try {
      const port = await this.waitForReady(child)
      const baseUrl = `http://127.0.0.1:${port}`
      const capabilities = await this.readCapabilities(baseUrl, launchToken)
      if (!this.isAlive(child)) throw new Error('UAR sidecar exited immediately after becoming ready')
      const generation = ++this.generation
      const running: RunningSidecar = {
        child,
        launchToken,
        adminKey,
        baseUrl,
        generation,
        uarVersion: capabilities.uarVersion,
        capabilities: capabilities.capabilities,
        administration: capabilities.administration,
        storage
      }
      child.once('exit', (code, signal) => {
        if (this.running?.child === child) this.running = undefined
        if (!this.stopping) logger.warn('UAR sidecar exited', { code, signal, generation })
      })
      child.stderr?.resume()
      logger.info('UAR sidecar ready', {
        generation,
        version: running.uarVersion,
        storageBackend: storage.profile.backend,
        capabilities: running.capabilities
      })
      return running
    } catch (error) {
      await this.terminate(child)
      throw error
    }
  }

  private waitForReady(child: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
      const output = readline.createInterface({ input: child.stdout! })
      let startupDiagnostic = ''
      const appendDiagnostic = (value: string) => {
        startupDiagnostic = `${startupDiagnostic}${redactSecretText(value)}`.slice(-2_000)
      }
      const timeout = setTimeout(() => settle(new Error('UAR sidecar readiness timed out')), START_TIMEOUT_MS)
      timeout.unref()
      const settle = (error?: Error, port?: number) => {
        clearTimeout(timeout)
        output.removeAllListeners()
        child.stderr?.removeListener('data', onStderr)
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
        if (error) reject(error)
        else resolve(port!)
      }
      const onStderr = (chunk: Buffer | string) => {
        appendDiagnostic(String(chunk))
      }
      const onError = (error: Error) => settle(new Error(`Failed to launch UAR sidecar: ${error.message}`))
      const onExit = (code: number | null) =>
        settle(
          new Error(
            `UAR sidecar exited before readiness (${code ?? 'signal'})${startupDiagnostic ? ': ' + startupDiagnostic.trim() : ''}`
          )
        )
      child.stderr?.on('data', onStderr)
      child.once('error', onError)
      child.once('exit', onExit)
      output.on('line', (line) => {
        const match = /^READY:(\d{1,5})$/.exec(line)
        if (!match) {
          appendDiagnostic(`${line}\n`)
          return
        }
        const port = Number(match[1])
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          settle(new Error('UAR sidecar reported an invalid readiness port'))
          return
        }
        settle(undefined, port)
      })
    })
  }

  private async readCapabilities(baseUrl: string, launchToken: string) {
    const response = await fetch(new URL('/api/uar/capabilities', baseUrl), {
      headers: { authorization: `Bearer ${launchToken}` },
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) throw new Error(`UAR sidecar capability check failed with HTTP ${response.status}`)
    const body = uarCapabilitiesResponseSchema.parse(await response.json())
    const capabilities = body.capabilities
    if (!Array.isArray(capabilities) || !capabilities.every((value) => typeof value === 'string')) {
      throw new Error('UAR sidecar capability response is invalid')
    }
    const missing = REQUIRED_CAPABILITIES.filter((capability) => !capabilities.includes(capability))
    if (missing.length) throw new Error(`UAR sidecar is missing required capabilities: ${missing.join(', ')}`)
    return { uarVersion: body.uar_version, capabilities, administration: body.administration }
  }

  private async stopOwnedProcess(): Promise<void> {
    const running = this.running
    this.running = undefined
    if (!running) return
    await this.terminate(running.child)
  }

  private async terminate(child: ChildProcess): Promise<void> {
    if (!this.isAlive(child)) return
    child.stdin?.end()
    if (await waitForProcessExit(child, STOP_TIMEOUT_MS)) return
    await terminateProcessTree(child, true, 'UAR sidecar')
    await waitForProcessExit(child, 1_000)
  }

  private isAlive(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null
  }

  private storageStatus(storage: AppliedUarStorage): UarSidecarEndpoint['storage'] {
    return { revision: storage.revision, profile: storage.profile }
  }
}

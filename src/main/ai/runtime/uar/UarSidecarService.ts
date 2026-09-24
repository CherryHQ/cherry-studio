import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import { crossPlatformSpawn, terminateProcessTree, waitForProcessExit } from '@main/utils/processRunner'
import { getRawShellEnv } from '@main/utils/shellEnv'

const logger = loggerService.withContext('UarSidecarService')
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 5_000
const REQUIRED_CAPABILITIES = [
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
}

export type UarSidecarStatus = UarSidecarEndpoint & { state: 'running' }

type RunningSidecar = UarSidecarEndpoint & {
  child: ChildProcess
  launchToken: string
}

type CapabilitiesResponse = {
  uar_version?: unknown
  agui?: { profile?: unknown; profile_revision?: unknown }
  capabilities?: unknown
}

@Injectable('UarSidecarService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['BinaryManager'])
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
    const running = await this.ensureRunning()
    return {
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities
    }
  }

  status(): UarSidecarStatus | undefined {
    const running = this.running
    if (!running || !this.isAlive(running.child)) return undefined
    return {
      state: 'running',
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities
    }
  }

  async restart(): Promise<UarSidecarEndpoint> {
    const running = await this.operation.runExclusive(async () => {
      await this.stopOwnedProcess()
      const next = await this.startOwnedProcess()
      this.running = next
      return next
    })
    return {
      baseUrl: running.baseUrl,
      generation: running.generation,
      uarVersion: running.uarVersion,
      capabilities: running.capabilities
    }
  }

  async request(
    pathname: string,
    principal: string,
    init: RequestInit = {},
    expectedGeneration?: number
  ): Promise<Response> {
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
    const running = this.running
    if (!running || !this.isAlive(running.child)) return undefined
    if (expectedGeneration !== undefined && running.generation !== expectedGeneration) return undefined
    return this.authenticatedFetch(running, pathname, principal, init)
  }

  private authenticatedFetch(
    running: RunningSidecar,
    pathname: string,
    principal: string,
    init: RequestInit
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${running.launchToken}`)
    headers.set('x-uar-principal', principal)
    return fetch(new URL(pathname, running.baseUrl), { ...init, headers })
  }

  private ensureRunning(): Promise<RunningSidecar> {
    if (this.stopping) return Promise.reject(new Error('UAR sidecar is shutting down'))
    if (this.running && this.isAlive(this.running.child)) return Promise.resolve(this.running)
    this.startPromise ??= this.operation.runExclusive(async () => {
      if (this.running && this.isAlive(this.running.child)) return this.running
      await this.stopOwnedProcess()
      const running = await this.startOwnedProcess()
      this.running = running
      return running
    })
    return this.startPromise.finally(() => {
      this.startPromise = undefined
    })
  }

  private async startOwnedProcess(): Promise<RunningSidecar> {
    const executable = await this.resolveExecutable()
    const launchToken = randomBytes(32).toString('hex')
    const dataRoot = application.getPath('feature.agents.uar.data')
    await mkdir(dataRoot, { recursive: true })
    const env = {
      ...(await getRawShellEnv()),
      UAR_SIDECAR: '1',
      UAR_PERSISTENCE__PROVIDER: 'surreal',
      UAR_PERSISTENCE__DATABASE_URL: `surrealkv://${path.resolve(dataRoot, 'runtime.db').replaceAll('\\', '/')}`,
      UAR_BUILTIN_SKILLS_DIR: path.join(application.getPath('feature.prometheus.pack.runtime'), 'skills'),
      UAR_MODELS_DIR: path.join(path.dirname(executable), 'uar-models'),
      UAR_LOAD_IMPORTED_SKILLS: 'true',
      UAR_NATIVE_TOOLS__FILE_TOOLS_ENABLED: 'false',
      UAR_NATIVE_TOOLS__WEB_FETCH_ENABLED: 'false',
      UAR_NATIVE_TOOLS__TERMINAL_EXEC_ENABLED: 'false'
    }
    const child = crossPlatformSpawn(executable, [], {
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
        baseUrl,
        generation,
        uarVersion: capabilities.uarVersion,
        capabilities: capabilities.capabilities
      }
      child.once('exit', (code, signal) => {
        if (this.running?.child === child) this.running = undefined
        if (!this.stopping) logger.warn('UAR sidecar exited', { code, signal, generation })
      })
      child.stderr?.resume()
      logger.info('UAR sidecar ready', {
        generation,
        version: running.uarVersion,
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
        if (startupDiagnostic.length < 2_000)
          startupDiagnostic += String(chunk).slice(0, 2_000 - startupDiagnostic.length)
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
        if (!match) return
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
    const body = (await response.json()) as CapabilitiesResponse
    if (typeof body.uar_version !== 'string') throw new Error('UAR sidecar did not report a version')
    if (body.agui?.profile !== 'uar.agui/1' || body.agui.profile_revision !== 1) {
      throw new Error('UAR sidecar AG-UI profile is incompatible (requires uar.agui/1 revision 1)')
    }
    if (!Array.isArray(body.capabilities) || !body.capabilities.every((value) => typeof value === 'string')) {
      throw new Error('UAR sidecar capability response is invalid')
    }
    const missing = REQUIRED_CAPABILITIES.filter((capability) => !body.capabilities!.includes(capability))
    if (missing.length) throw new Error(`UAR sidecar is missing required capabilities: ${missing.join(', ')}`)
    return { uarVersion: body.uar_version, capabilities: body.capabilities as string[] }
  }

  private async resolveExecutable(): Promise<string> {
    const override = process.env.THE_BOSS_UAR_SIDECAR_PATH?.trim()
    if (override) return override
    const bundled = path.join(
      application.getPath('app.root.resources.binaries'),
      `${process.platform}-${process.arch}`,
      `uar-sidecar${isWin ? '.exe' : ''}`
    )
    if (existsSync(bundled)) return bundled
    const snapshot = (await application.get('BinaryManager').getToolSnapshots(['uar-sidecar']))['uar-sidecar']
    if (snapshot.availability.source !== 'none') return snapshot.availability.path
    throw new Error('UAR sidecar binary is not installed')
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
}

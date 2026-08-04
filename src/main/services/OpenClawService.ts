import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import path from 'node:path'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import type { Model, Provider, ProviderType, VertexProvider } from '@main/data/migration/legacyTypes'
import { t } from '@main/i18n'
import { atomicWriteFile, remove } from '@main/utils/file'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import { getRawShellEnv, refreshShellEnv } from '@main/utils/shellEnv'
import type { EndpointType, Model as DataModel, UniqueModelId } from '@shared/data/types/model'
import {
  CURRENCY,
  ENDPOINT_TYPE,
  MODEL_CAPABILITY,
  parseUniqueModelId,
  UniqueModelIdSchema
} from '@shared/data/types/model'
import type { Provider as DataProvider } from '@shared/data/types/provider'
import type { BinaryAvailability } from '@shared/types/binary'
import type { OperationResult } from '@shared/types/codeTools'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { formatApiHost, hasApiVersion, withoutTrailingSlash } from '@shared/utils/api'
import { isNonChatModel } from '@shared/utils/model'

import { vertexAiService } from './VertexAiService'

const logger = loggerService.withContext('OpenClawService')

const openclawConfigDir = () => application.getPath('external.openclaw.config')
const openclawConfigPath = (): AbsoluteFilePath =>
  AbsoluteFilePathSchema.parse(path.join(openclawConfigDir(), 'openclaw.json'))
const openclawConfigBakPath = () => path.join(openclawConfigDir(), 'openclaw.json.bak')
const openclawLegacyConfigPath = () => path.join(openclawConfigDir(), 'openclaw.cherry.json')
const DEFAULT_GATEWAY_PORT = 18790
const OPENCLAW_COMMAND_TIMEOUT_MS = 10000
const OPENCLAW_COMMAND_CAPTURE_LIMIT_BYTES = 1024 * 1024
const OPENCLAW_DIAGNOSTIC_LIMIT = 2000
const OPENCLAW_VISIBLE_ISSUE_LIMIT = 3
const OPENCLAW_CONFIG_FILE_MODE = 0o600
const OPENCLAW_CHERRY_MANAGED_PATHS = new Set([
  'gateway.mode',
  'gateway.port',
  'gateway.auth',
  'gateway.auth.token',
  'agents.defaults.model',
  'agents.defaults.model.primary',
  'update.checkOnStart'
])

type OpenClawPreflightFailureKind = 'binary_incompatible' | 'external_config_invalid' | 'preflight_failed'

type OpenClawRuntime = {
  source: Exclude<BinaryAvailability, { source: 'none' }>['source']
  path: AbsoluteFilePath
  version?: string
  env: Record<string, string>
}

type OpenClawCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  outputTruncated: boolean
}

type OpenClawValidationIssue = {
  path: string
  message: string
  allowedValues?: unknown[]
}

interface OpenClawValidationReport {
  valid: boolean
  path?: string
  issues: OpenClawValidationIssue[]
  warnings: OpenClawValidationIssue[]
}

function sanitizeOpenClawDiagnostic(diagnostic: string): string {
  const withoutSensitiveValues = diagnostic.replace(
    /(["']?)(api_?key|token|auth|authorization|secret|password)\1(\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n,;}\]]+)/gi,
    (_match, quote: string, key: string, separator: string) => `${quote}${key}${quote}${separator}[REDACTED]`
  )
  return withoutSensitiveValues
    .replace(/\b(Bearer|Basic)\s+[^\s"',;}\]]+/gi, (_match, scheme: string) => `${scheme} [REDACTED]`)
    .slice(0, OPENCLAW_DIAGNOSTIC_LIMIT)
}

function isCherryManagedConfigPath(configPath: string): boolean {
  return configPath.startsWith('models.providers.cherry-') || OPENCLAW_CHERRY_MANAGED_PATHS.has(configPath)
}

class OpenClawPreflightError extends Error {
  public readonly kind: OpenClawPreflightFailureKind

  constructor(kind: OpenClawPreflightFailureKind, sanitizedMessage: string) {
    super(sanitizeOpenClawDiagnostic(sanitizedMessage))
    this.kind = kind
  }
}

export type GatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface HealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayPort: number
}

type GatewayHealthProbeResult = { status: 'healthy' } | { status: 'unhealthy'; error: string }

export interface OpenClawConfig {
  gateway?: {
    mode?: 'local' | 'remote'
    port?: number
    auth?: {
      token?: string
    }
  }
  agents?: {
    defaults?: {
      model?: {
        primary?: string
      }
    }
  }
  models?: {
    mode?: string
    providers?: Record<string, OpenClawProviderConfig>
  }
  update?: {
    checkOnStart?: boolean
  }
}

export interface OpenClawModelConfig {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: boolean
  input?: string[]
  cost?: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
  }
  [key: string]: unknown
}

export interface OpenClawProviderConfig {
  baseUrl: string
  apiKey: string
  api: string
  headers?: Record<string, string>
  models: OpenClawModelConfig[]
}

type OpenClawSyncModel = Model &
  Pick<OpenClawModelConfig, 'contextWindow' | 'maxTokens' | 'reasoning' | 'input' | 'cost'>
type OpenClawSyncProvider = Provider & { headers?: Record<string, string> }

/**
 * OpenClaw API types
 * - 'openai-completions': For OpenAI-compatible chat completions API
 * - 'anthropic-messages': For Anthropic Messages API format
 */
const OPENCLAW_API_TYPES = {
  OPENAI: 'openai-completions',
  ANTHROPIC: 'anthropic-messages',
  OPENAI_RESPOSNE: 'openai-responses'
} as const

/**
 * Placeholder API keys for providers that don't require authentication.
 * OpenClaw requires a non-empty apiKey value even for local providers.
 * Keys are matched by provider preset/id first, then by provider type.
 */
const NO_KEY_PLACEHOLDERS: Record<string, string> = {
  gpustack: 'gpustack',
  ollama: 'ollama',
  lmstudio: 'lmstudio'
}

/**
 * Providers that always use Anthropic API format
 */
const ANTHROPIC_ONLY_PROVIDERS: ProviderType[] = ['anthropic', 'vertex-anthropic']

const UNSUPPORTED_SYNC_PROVIDER_IDS = new Set(['azure-openai', 'aws-bedrock', 'vertexai', 'vertex-anthropic'])

/**
 * Endpoint types that use Anthropic API format
 * These are values from model.endpoint_type field
 */
const ANTHROPIC_ENDPOINT_TYPES = ['anthropic']

/**
 * Check if a model should use Anthropic API based on endpoint_type
 */
function isAnthropicEndpointType(model: Model): boolean {
  const endpointType = model.endpoint_type
  return endpointType ? ANTHROPIC_ENDPOINT_TYPES.includes(endpointType) : false
}

/**
 * Type guard to check if a provider is a VertexProvider
 */
function isVertexProvider(provider: Provider): provider is VertexProvider {
  return provider.type === 'vertexai'
}

@Injectable('OpenClawService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager'])
export class OpenClawService extends BaseService {
  private gatewayStatus: GatewayStatus = 'stopped'
  private gatewayPort: number = DEFAULT_GATEWAY_PORT
  private gatewayAuthToken: string = ''

  public get gatewayUrl(): string {
    return `ws://127.0.0.1:${this.gatewayPort}/ws`
  }

  protected async onInit(): Promise<void> {
    // IPC handlers migrated to IpcApi (openclaw.*)
  }

  protected async onStop(): Promise<void> {
    await this.stopGateway()
  }

  /** Resolve the same live executable path the management UI reports. */
  private async findOpenClawBinary(): Promise<Exclude<BinaryAvailability, { source: 'none' }> | null> {
    const snapshot = (await application.get('BinaryManager').getToolSnapshots(['openclaw'])).openclaw
    return snapshot.availability.source === 'none' ? null : snapshot.availability
  }

  private async resolveOpenClawRuntime(): Promise<OpenClawRuntime> {
    const managedShellEnv = await refreshShellEnv()
    const openclaw = await this.findOpenClawBinary()
    if (!openclaw) {
      throw new Error('OpenClaw binary not found. Please install OpenClaw first.')
    }

    const runtime: OpenClawRuntime = {
      source: openclaw.source,
      path: AbsoluteFilePathSchema.parse(openclaw.path),
      version: 'version' in openclaw ? openclaw.version : undefined,
      env: openclaw.source === 'system' ? await getRawShellEnv() : managedShellEnv
    }
    logger.info('Resolved OpenClaw runtime', {
      source: runtime.source,
      path: runtime.path,
      version: runtime.version
    })
    return runtime
  }

  private runOpenClawCommand(
    openclawPath: AbsoluteFilePath,
    args: string[],
    env: Record<string, string>
  ): Promise<OpenClawCommandResult> {
    return new Promise((resolve, reject) => {
      let proc: ReturnType<typeof crossPlatformSpawn>
      try {
        proc = crossPlatformSpawn(openclawPath, args, {
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      } catch (error) {
        const summary = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
        logger.warn('OpenClaw preflight command could not start', { summary })
        reject(new OpenClawPreflightError('preflight_failed', t('openclaw.errors.preflight_failed')))
        return
      }

      const stdoutCapture = this.createBoundedOutputCapture()
      const stderrCapture = this.createBoundedOutputCapture()
      let outputTruncated = false
      let settled = false

      proc.stdout?.on('data', (chunk) => {
        if (stdoutCapture.append(chunk)) outputTruncated = true
      })
      proc.stderr?.on('data', (chunk) => {
        if (stderrCapture.append(chunk)) outputTruncated = true
      })

      const timeoutId = setTimeout(() => {
        if (settled) return
        proc.kill('SIGKILL')
        settled = true
        logger.warn('OpenClaw preflight command timed out', { timeoutMs: OPENCLAW_COMMAND_TIMEOUT_MS })
        reject(new OpenClawPreflightError('preflight_failed', t('openclaw.errors.preflight_failed')))
      }, OPENCLAW_COMMAND_TIMEOUT_MS)

      proc.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        logger.warn('OpenClaw preflight command failed', { summary: this.sanitizeDiagnostic(error.message) })
        reject(new OpenClawPreflightError('preflight_failed', t('openclaw.errors.preflight_failed')))
      })

      proc.on('close', (exitCode) => {
        if (settled) return
        settled = true
        clearTimeout(timeoutId)
        resolve({
          exitCode,
          stdout: stdoutCapture.read(),
          stderr: stderrCapture.read(),
          outputTruncated
        })
      })
    })
  }

  private createBoundedOutputCapture() {
    const chunks: Buffer[] = []
    let capturedBytes = 0

    return {
      append: (chunk: Buffer | string): boolean => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const remaining = Math.max(0, OPENCLAW_COMMAND_CAPTURE_LIMIT_BYTES - capturedBytes)
        const retainedBytes = Math.min(bytes.length, remaining)
        if (retainedBytes > 0) {
          chunks.push(bytes.subarray(0, retainedBytes))
          capturedBytes += retainedBytes
        }
        return bytes.length > retainedBytes
      },
      read: (): string => Buffer.concat(chunks).toString('utf8')
    }
  }

  private sanitizeDiagnostic(diagnostic: string | OpenClawValidationIssue | OpenClawValidationIssue[]): string {
    return sanitizeOpenClawDiagnostic(typeof diagnostic === 'string' ? diagnostic : JSON.stringify(diagnostic))
  }

  private parseValidationResult(result: OpenClawCommandResult): OpenClawValidationReport {
    const fail = (): never => {
      throw new OpenClawPreflightError('preflight_failed', t('openclaw.errors.preflight_failed'))
    }

    if (result.outputTruncated) fail()

    let parsed: unknown
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      fail()
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail()

    const report = parsed as Record<string, unknown>
    const isIssue = (issue: unknown): issue is OpenClawValidationIssue => {
      if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) return false
      const candidate = issue as Record<string, unknown>
      return (
        typeof candidate.path === 'string' &&
        typeof candidate.message === 'string' &&
        (candidate.allowedValues === undefined || Array.isArray(candidate.allowedValues))
      )
    }

    if (typeof report.valid !== 'boolean') fail()
    if (report.path !== undefined && typeof report.path !== 'string') fail()
    if (!Array.isArray(report.issues) || !report.issues.every(isIssue)) fail()
    if (report.warnings !== undefined && (!Array.isArray(report.warnings) || !report.warnings.every(isIssue))) fail()
    const valid = report.valid as boolean
    const reportPath = report.path as string | undefined
    const issues = report.issues as OpenClawValidationIssue[]
    const warnings = (report.warnings ?? []) as OpenClawValidationIssue[]
    if (!valid && issues.length === 0) fail()
    if ((valid && result.exitCode !== 0) || (!valid && result.exitCode !== 1)) fail()

    return {
      valid,
      ...(reportPath !== undefined ? { path: reportPath } : {}),
      issues,
      warnings
    }
  }

  private formatValidationDetails(issues: OpenClawValidationIssue[]): string {
    const visible = issues
      .slice(0, OPENCLAW_VISIBLE_ISSUE_LIMIT)
      .map((issue) => this.sanitizeDiagnostic(`${issue.path}: ${issue.message}`))
    const remaining = issues.length - visible.length
    if (remaining > 0) {
      visible.push(t('openclaw.errors.more_issues', { count: remaining }))
    }
    return visible.length > 0 ? `\n${visible.join('\n')}` : ''
  }

  private async validateConfig(
    runtime: OpenClawRuntime,
    configPath: AbsoluteFilePath
  ): Promise<OpenClawValidationReport> {
    try {
      const result = await this.runOpenClawCommand(runtime.path, ['config', 'validate', '--json'], {
        ...runtime.env,
        OPENCLAW_CONFIG_PATH: configPath
      })
      return this.parseValidationResult(result)
    } catch (error) {
      const summary = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
      logger.warn('OpenClaw config validation failed', { summary })
      if (error instanceof OpenClawPreflightError && error.kind === 'preflight_failed') {
        throw error
      }
      throw new OpenClawPreflightError('preflight_failed', t('openclaw.errors.preflight_failed'))
    }
  }

  private async assertConfigValid(runtime: OpenClawRuntime, configPath: AbsoluteFilePath): Promise<void> {
    const report = await this.validateConfig(runtime, configPath)
    if (report.valid) {
      for (const warning of report.warnings) {
        logger.warn('OpenClaw config validation warning', {
          summary: this.sanitizeDiagnostic(`${warning.path}: ${warning.message}`)
        })
      }
      return
    }

    const kind = report.issues.some((issue) => isCherryManagedConfigPath(issue.path))
      ? 'binary_incompatible'
      : 'external_config_invalid'
    const details = this.formatValidationDetails(report.issues)
    const message =
      kind === 'binary_incompatible'
        ? t('openclaw.errors.binary_incompatible', { details })
        : t('openclaw.errors.external_config_invalid', { details })
    throw new OpenClawPreflightError(kind, message)
  }

  private async assertSchemaCapability(runtime: OpenClawRuntime): Promise<void> {
    let result: OpenClawCommandResult
    try {
      result = await this.runOpenClawCommand(runtime.path, ['config', 'schema', '--json'], {
        ...runtime.env,
        OPENCLAW_CONFIG_PATH: openclawConfigPath()
      })
    } catch (error) {
      this.throwSchemaCapabilityError(error instanceof Error ? error.message : String(error))
    }

    if (result.exitCode !== 0) {
      const stderrSummary = result.stderr.trim().split(/\r?\n/, 1)[0]
      this.throwSchemaCapabilityError(
        `config schema exited with code ${result.exitCode}${stderrSummary ? `: ${stderrSummary}` : ''}`
      )
    }
    if (result.outputTruncated) {
      this.throwSchemaCapabilityError('config schema output exceeded the capture limit')
    }

    let schema: unknown
    try {
      schema = JSON.parse(result.stdout)
    } catch {
      this.throwSchemaCapabilityError('config schema did not return valid JSON')
    }
    if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
      this.throwSchemaCapabilityError('config schema did not return a top-level object')
    }
  }

  private throwSchemaCapabilityError(diagnostic: string): never {
    const summary = this.sanitizeDiagnostic(diagnostic)
    logger.warn('OpenClaw schema capability check failed', { summary })
    const details = summary ? `\n${summary}` : ''
    throw new OpenClawPreflightError('binary_incompatible', t('openclaw.errors.binary_incompatible', { details }))
  }

  /**
   * Start the OpenClaw Gateway
   */
  public async startGateway(port?: number): Promise<OperationResult> {
    this.gatewayPort = port ?? DEFAULT_GATEWAY_PORT

    // Prevent concurrent startup calls
    if (this.gatewayStatus === 'starting') {
      return { success: false, message: 'Gateway is already starting' }
    }

    try {
      const runtime = await this.resolveOpenClawRuntime()
      await this.assertSchemaCapability(runtime)
      await this.assertConfigValid(runtime, openclawConfigPath())

      // Check if the port is already in use
      const isPortOpen = await this.checkPortOpen(this.gatewayPort)
      if (isPortOpen) {
        // Check if this is our gateway already running on this port
        const { status } = await this.checkGatewayHealth()
        if (status === 'healthy') {
          // Stop the stale gateway (e.g. respawned orphan from a previous session)
          logger.info('Detected stale gateway on port, stopping before restart...')
          await this.stopGateway()

          // Verify port is now free
          const stillOpen = await this.checkPortOpen(this.gatewayPort)
          if (stillOpen) {
            return {
              success: false,
              message: `Port ${this.gatewayPort} is still in use after stopping the old gateway.`
            }
          }
        } else {
          return {
            success: false,
            message: `Port ${this.gatewayPort} is already in use by another application. Please choose a different port.`
          }
        }
      }

      this.gatewayStatus = 'starting'

      await this.startAndWaitForGateway(runtime.path, runtime.env)
      this.gatewayStatus = 'running'
      logger.info(`Gateway started on port ${this.gatewayPort}`)
      return { success: true }
    } catch (error) {
      this.gatewayStatus = 'error'
      const errorMessage = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
      logger.error('Failed to start gateway:', new Error(errorMessage))
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Start gateway via `openclaw gateway run --force` and wait for it to become ready.
   * Spawns the gateway as a detached process so its lifecycle is independent.
   * Uses process termination to stop it later.
   */
  private async startAndWaitForGateway(openclawPath: string, shellEnv: Record<string, string>): Promise<void> {
    const args = ['gateway', 'run', '--force']

    logger.info(`Starting gateway: ${openclawPath} ${args.join(' ')}`)

    // Spawn the gateway process. We poll for readiness via health check.
    // On Windows, avoid detached: true as it creates a visible console window.
    // Instead, use windowsHide: true without detached - proc.unref() ensures
    // the parent can exit independently.
    const proc = crossPlatformSpawn(openclawPath, args, {
      // OpenClaw's own auto-updater would swap the binary underneath us, desyncing the
      // version BinaryManager installed and reports. This is OpenClaw's documented kill
      // switch, scoped to the gateway process we spawn.
      env: {
        ...shellEnv,
        OPENCLAW_CONFIG_PATH: openclawConfigPath(),
        OPENCLAW_NO_AUTO_UPDATE: '1'
      },
      detached: !isWin, // Only detach on non-Windows to avoid console flash
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    proc.unref()

    // Collect early exit errors (e.g. binary crash on startup)
    let earlyExitError = ''
    const stdoutCapture = this.createBoundedOutputCapture()
    const stderrCapture = this.createBoundedOutputCapture()
    const firstNonEmptyLines = (output: string) =>
      output
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .slice(0, 5)
        .join('\n')
    proc.stdout?.on('data', (data) => {
      stdoutCapture.append(data)
    })
    proc.stderr?.on('data', (data) => {
      stderrCapture.append(data)
    })
    proc.on('error', (err) => {
      earlyExitError = this.sanitizeDiagnostic(err.message)
    })
    proc.on('exit', (code) => {
      const detail = [firstNonEmptyLines(stderrCapture.read()), firstNonEmptyLines(stdoutCapture.read())]
        .filter(Boolean)
        .join('\n')
      if (code !== 0) {
        earlyExitError = this.sanitizeDiagnostic(detail || `gateway exited with code ${code}`)
      } else {
        // Process exited with code 0 but gateway may not be healthy (e.g. daemonized child failed)
        earlyExitError = this.sanitizeDiagnostic(
          detail
            ? `gateway exited with code 0 but output: ${detail}`
            : 'gateway process exited with code 0 before becoming healthy'
        )
      }
    })

    // Wait for gateway to become ready (max 30 seconds)
    const maxWaitMs = 30000
    const pollIntervalMs = 1000
    const startTime = Date.now()
    let pollCount = 0
    let lastError = ''

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs))
      pollCount++

      // Check if the process crashed early
      if (earlyExitError) {
        throw new Error(earlyExitError)
      }

      logger.debug(`Polling gateway health (attempt ${pollCount})...`)
      const healthResult = await this.checkGatewayHealthWithError()
      if (healthResult.status === 'healthy') {
        logger.info(`Gateway is healthy (verified after ${pollCount} polls)`)
        return
      }
      lastError = healthResult.error
    }

    // Combine all available diagnostics: health check errors, stderr, and stdout
    const stderrDetail = firstNonEmptyLines(stderrCapture.read())
    const stdoutDetail = firstNonEmptyLines(stdoutCapture.read())
    const diagnostics = [
      lastError ? `health: ${lastError}` : '',
      stderrDetail ? `stderr: ${stderrDetail}` : '',
      stdoutDetail ? `stdout: ${stdoutDetail}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const detail = diagnostics ? `\n${diagnostics}` : ''
    throw new Error(
      this.sanitizeDiagnostic(`Gateway failed to start within ${maxWaitMs}ms (${pollCount} polls)${detail}`)
    )
  }

  /**
   * Stop the OpenClaw Gateway.
   * Kills all openclaw processes to ensure clean shutdown.
   */
  public async stopGateway(): Promise<OperationResult> {
    try {
      this.killAllOpenClawProcesses()

      const stillRunning = await this.waitForGatewayStop()
      if (stillRunning) {
        this.gatewayStatus = 'error'
        return { success: false, message: 'Failed to stop gateway' }
      }

      this.gatewayStatus = 'stopped'
      logger.info('Gateway stopped')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to stop gateway:', error as Error)
      this.gatewayStatus = 'error'
      return { success: false, message: errorMessage }
    }
  }

  /**
   * Kill all openclaw processes by finding processes on the gateway port.
   * This works reliably on Windows where process name may show as bun.exe.
   */
  private killAllOpenClawProcesses(): void {
    const currentPid = process.pid
    try {
      if (isWin) {
        const output = execSync(`netstat -ano | findstr ":${this.gatewayPort}"`, { encoding: 'utf-8' })
        const pids = new Set<string>()
        for (const line of output.split('\n')) {
          const match = line.trim().match(/LISTENING\s+(\d+)/)
          if (match && Number(match[1]) !== currentPid) {
            pids.add(match[1])
          }
        }
        for (const pid of pids) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
            logger.info(`Killed process ${pid} on port ${this.gatewayPort}`)
          } catch {
            // ignore
          }
        }
      } else {
        execSync('pkill -9 openclaw', { stdio: 'ignore' })
        logger.info('Killed all openclaw processes')
      }
    } catch {
      logger.debug('No openclaw processes to kill')
    }
  }

  /**
   * Wait for gateway to actually stop, with retries.
   * Returns true if gateway is still running after all retries.
   */
  private async waitForGatewayStop(maxRetries = 3, intervalMs = 1000): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      const stillRunning = await this.checkPortOpen(this.gatewayPort)
      if (!stillRunning) {
        return false
      }
      if (i < maxRetries - 1) {
        logger.debug(`Gateway still running after stop, retrying check (${i + 1}/${maxRetries})...`)
        await new Promise((r) => setTimeout(r, intervalMs))
      }
    }
    return true
  }

  /**
   * Get Gateway status. Probes the port when idle to detect externally-started gateways.
   */
  public async getStatus(): Promise<{ status: GatewayStatus; port: number }> {
    if (this.gatewayStatus === 'starting') {
      return { status: this.gatewayStatus, port: this.gatewayPort }
    }

    const { status } = await this.checkGatewayHealth()
    if (status === 'healthy' && this.gatewayStatus !== 'running') {
      logger.info(`Detected externally running gateway on port ${this.gatewayPort}`)
      this.gatewayStatus = 'running'
    } else if (status === 'unhealthy' && this.gatewayStatus === 'running') {
      logger.warn(`Gateway on port ${this.gatewayPort} is no longer reachable, marking as stopped`)
      this.gatewayStatus = 'stopped'
    }

    return {
      status: this.gatewayStatus,
      port: this.gatewayPort
    }
  }

  /**
   * Probe gateway health via HTTP request to the health endpoint.
   * This is faster than spawning the openclaw binary.
   * Expected response: {"ok":true,"status":"live"}
   * Does NOT check gatewayStatus — callers that need to detect
   * externally-started gateways should call this directly.
   */
  private async checkGatewayHealth(): Promise<HealthInfo> {
    const result = await this.probeGatewayHealth()
    if (result.status === 'unhealthy') {
      logger.debug('Health probe failed:', new Error(result.error))
    }
    return { status: result.status, gatewayPort: this.gatewayPort }
  }

  /**
   * Check if a port is open and accepting connections
   */
  private async checkPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket()
      socket.setTimeout(2000)

      socket.on('connect', () => {
        socket.destroy()
        logger.debug(`Port ${port} is open (connected)`)
        resolve(true)
      })

      socket.on('timeout', () => {
        socket.destroy()
        logger.debug(`Port ${port} check timed out`)
        resolve(false)
      })

      socket.on('error', (err) => {
        socket.destroy()
        logger.debug(`Port ${port} is not open: ${err.message}`)
        resolve(false)
      })

      socket.connect(port, '127.0.0.1')
    })
  }

  /**
   * Get OpenClaw Dashboard URL (for opening in miniapp).
   * The Control UI uses #token= to bootstrap WebSocket authentication while
   * keeping the token client-side instead of sending it in HTTP requests.
   */
  public getDashboardUrl(): string {
    // Ensure we have the token (may have been lost after app restart)
    if (!this.gatewayAuthToken) {
      this.loadAuthTokenFromConfig()
    }
    let url = `http://127.0.0.1:${this.gatewayPort}`
    if (this.gatewayAuthToken) {
      // Use query string (not URL fragment) so dashboard app state can persist correctly.
      // Fragment (#...) is often used by SPAs for transient client-side state.
      url += `#token=${encodeURIComponent(this.gatewayAuthToken)}`
    }
    return url
  }

  /**
   * Load auth token from the config file (for recovery after app restart).
   */
  private loadAuthTokenFromConfig(): void {
    try {
      if (fs.existsSync(openclawConfigPath())) {
        const content = fs.readFileSync(openclawConfigPath(), 'utf-8')
        const config = JSON.parse(content) as OpenClawConfig
        const token = config.gateway?.auth?.token
        if (token) {
          this.gatewayAuthToken = token
          logger.info('Recovered auth token from config file')
        }
      }
    } catch (error) {
      const summary = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
      logger.warn('Failed to load auth token from config file', { summary })
    }
  }

  /**
   * Generate a cryptographically secure random auth token
   */
  private generateAuthToken(): string {
    return crypto.randomBytes(24).toString('base64url')
  }

  /**
   * Sync Cherry Studio Provider configuration to OpenClaw
   */
  public async syncConfig(uniqueModelId: UniqueModelId, port?: number): Promise<OperationResult> {
    try {
      // Apply the caller's gateway port before writing openclaw.json so the config's
      // gateway.port matches the port startGateway() will bind and health-check. Without
      // this, a custom port is written as the stale in-memory port (default 18790) because
      // sync runs before startGateway(port), so the gateway binds the wrong port on launch.
      if (port !== undefined) {
        this.gatewayPort = port
      }
      const { provider, primaryModel } = await this.resolveSyncConfig(uniqueModelId)
      return await this.syncProviderConfig(provider, primaryModel)
    } catch (error) {
      const summary = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
      logger.error('Failed to resolve OpenClaw sync config:', new Error(summary))
      return { success: false, message: summary }
    }
  }

  private async resolveSyncConfig(
    uniqueModelId: unknown
  ): Promise<{ provider: OpenClawSyncProvider; primaryModel: OpenClawSyncModel }> {
    const parsed = UniqueModelIdSchema.safeParse(uniqueModelId)
    if (!parsed.success) {
      throw new Error('Invalid OpenClaw model selection')
    }

    const { providerId, modelId } = parseUniqueModelId(parsed.data)
    const [provider, primaryModel, models, apiKeys] = await Promise.all([
      providerService.getByProviderId(providerId),
      modelService.getByKey(providerId, modelId),
      modelService.list({ providerId, enabled: true }),
      providerService.getApiKeys(providerId, { enabled: true })
    ])

    this.ensureSyncProviderSupported(provider)
    if (isNonChatModel(primaryModel)) {
      throw new Error('Selected OpenClaw model must support chat')
    }

    const endpointType = this.getModelEndpointType(primaryModel, provider)
    const apiHost = provider.endpointConfigs?.[endpointType]?.baseUrl

    if (!apiHost) {
      throw new Error(`Provider ${provider.id} has no API host configured for ${endpointType}`)
    }

    const apiKey = this.resolveSyncApiKey(provider, apiKeys.map((entry) => entry.key).join(','))

    return {
      provider: {
        id: provider.id,
        type: this.toOpenClawProviderType(provider.presetProviderId ?? provider.id, endpointType),
        name: provider.name,
        apiKey,
        apiHost,
        anthropicApiHost:
          endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
            ? provider.endpointConfigs?.[ENDPOINT_TYPE.ANTHROPIC_MESSAGES]?.baseUrl
            : undefined,
        models: models
          .filter(
            (model) =>
              !model.isHidden && !isNonChatModel(model) && this.getModelEndpointType(model, provider) === endpointType
          )
          .map((model) => this.toOpenClawModel(model)),
        presetProviderId: provider.presetProviderId,
        headers: provider.settings?.extraHeaders
      },
      primaryModel: this.toOpenClawModel(primaryModel)
    }
  }

  private resolveSyncApiKey(provider: DataProvider, apiKey: string): string {
    if (apiKey) {
      return apiKey
    }

    const noKeyPlaceholder = this.getNoKeyPlaceholder(provider)
    if (provider.authType === 'api-key' && !noKeyPlaceholder) {
      throw new Error(`Provider ${provider.id} has no enabled API key configured`)
    }

    return noKeyPlaceholder ?? ''
  }

  private getModelEndpointType(model: DataModel, provider: DataProvider): EndpointType {
    return model.endpointTypes?.[0] ?? provider.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  }

  private getNoKeyPlaceholder(provider: { id: string; type?: string; presetProviderId?: string }): string | undefined {
    const providerKey = provider.presetProviderId ?? provider.id
    return (
      NO_KEY_PLACEHOLDERS[providerKey] ??
      NO_KEY_PLACEHOLDERS[provider.id] ??
      (provider.type ? NO_KEY_PLACEHOLDERS[provider.type] : undefined)
    )
  }

  private toOpenClawProviderType(providerType: string, endpointType: EndpointType): Provider['type'] {
    if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
      return 'openai-response'
    }
    if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
      return 'anthropic'
    }
    if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
      return 'gemini'
    }
    return providerType as Provider['type']
  }

  private ensureSyncProviderSupported(provider: DataProvider): void {
    const providerKey = provider.presetProviderId ?? provider.id
    if (UNSUPPORTED_SYNC_PROVIDER_IDS.has(providerKey)) {
      throw new Error(`OpenClaw sync does not support ${provider.name} providers yet`)
    }
  }

  private toOpenClawModel(model: DataModel): OpenClawSyncModel {
    const { modelId } = parseUniqueModelId(model.id)
    const input = model.inputModalities?.filter((modality) => modality === 'text' || modality === 'image')
    const cost = this.toOpenClawCost(model)
    return {
      id: model.apiModelId ?? modelId,
      provider: model.providerId,
      name: model.name,
      group: model.group ?? '',
      endpoint_type: this.toOpenClawEndpointType(model.endpointTypes?.[0]),
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.maxOutputTokens ? { maxTokens: model.maxOutputTokens } : {}),
      ...(model.reasoning || model.capabilities.includes(MODEL_CAPABILITY.REASONING) ? { reasoning: true } : {}),
      ...(input?.length ? { input } : {}),
      ...(cost ? { cost } : {})
    }
  }

  private toOpenClawCost(model: DataModel): OpenClawModelConfig['cost'] | undefined {
    const pricing = model.pricing
    if (!pricing) return undefined
    const isUsd = (currency?: string) => currency === undefined || currency === CURRENCY.USD
    if (!isUsd(pricing.input.currency) || !isUsd(pricing.output.currency)) return undefined
    if (pricing.input.perMillionTokens === null || pricing.output.perMillionTokens === null) return undefined

    const cost: NonNullable<OpenClawModelConfig['cost']> = {
      input: pricing.input.perMillionTokens,
      output: pricing.output.perMillionTokens
    }
    if (pricing.cacheRead?.perMillionTokens != null && isUsd(pricing.cacheRead.currency)) {
      cost.cacheRead = pricing.cacheRead.perMillionTokens
    }
    if (pricing.cacheWrite?.perMillionTokens != null && isUsd(pricing.cacheWrite.currency)) {
      cost.cacheWrite = pricing.cacheWrite.perMillionTokens
    }
    return cost
  }

  private toOpenClawEndpointType(endpointType?: EndpointType): Model['endpoint_type'] {
    if (endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES) {
      return 'anthropic'
    }
    if (endpointType === ENDPOINT_TYPE.OPENAI_RESPONSES) {
      return 'openai-response'
    }
    if (endpointType === ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT) {
      return 'gemini'
    }
    return 'openai'
  }

  public async syncProviderConfig(provider: Provider, primaryModel: Model): Promise<OperationResult> {
    try {
      const runtime = await this.resolveOpenClawRuntime()
      await this.assertSchemaCapability(runtime)

      // Ensure config directory exists
      if (!fs.existsSync(openclawConfigDir())) {
        fs.mkdirSync(openclawConfigDir(), { recursive: true })
      }

      // Migrate legacy openclaw.cherry.json → openclaw.json
      if (fs.existsSync(openclawLegacyConfigPath())) {
        if (fs.existsSync(openclawConfigPath())) {
          fs.renameSync(openclawConfigPath(), openclawConfigBakPath())
          logger.info('Migrated openclaw.json → openclaw.json.bak')
        }
        fs.renameSync(openclawLegacyConfigPath(), openclawConfigPath())
        logger.info('Migrated openclaw.cherry.json → openclaw.json')
      }

      // Read existing config. An unparseable file aborts the sync instead of
      // being rebuilt from scratch — silently replacing it would destroy any
      // hand-edited OpenClaw config the user could otherwise repair.
      let config: OpenClawConfig = {}
      if (fs.existsSync(openclawConfigPath())) {
        const content = fs.readFileSync(openclawConfigPath(), 'utf-8')
        try {
          config = JSON.parse(content)
        } catch {
          throw new Error(`Existing OpenClaw config is not valid JSON; fix or remove ${openclawConfigPath()}`)
        }
      }

      // Build provider key
      const providerKey = `cherry-${provider.id}`

      // Determine the API type based on model, not provider type
      // Mixed providers (cherryin, aihubmix, etc.) can have both OpenAI and Anthropic endpoints
      const apiType = this.determineApiType(provider, primaryModel)
      const baseUrl = this.getBaseUrlForApiType(provider, apiType)

      // Get API key - for vertexai, get access token from VertexAiService
      // If multiple API keys are configured (comma-separated), use the first one
      // Some providers like Ollama and LM Studio don't require API keys
      let apiKey = provider.apiKey ? provider.apiKey.split(',')[0].trim() : ''
      if (isVertexProvider(provider)) {
        try {
          const vertexService = vertexAiService
          apiKey = await vertexService.getAccessToken({
            projectId: provider.project,
            serviceAccount: {
              privateKey: provider.googleCredentials.privateKey,
              clientEmail: provider.googleCredentials.clientEmail
            }
          })
        } catch (err) {
          const summary = this.sanitizeDiagnostic(err instanceof Error ? err.message : String(err))
          logger.warn('Failed to get VertexAI access token, using provider apiKey:', { summary })
        }
      }

      // Providers like Ollama and LM Studio don't require real API keys,
      // but OpenClaw needs a non-empty placeholder value
      if (!apiKey) {
        apiKey = this.getNoKeyPlaceholder(provider) ?? 'no-key-required'
      }

      // Rebuild Cherry Studio's managed provider area from current provider data.
      // Non-Cherry providers and all other top-level OpenClaw config remain user-owned.
      const externalProviders = Object.fromEntries(
        Object.entries(config.models?.providers ?? {}).filter(([key]) => !key.startsWith('cherry-'))
      )
      config.models = config.models || { mode: 'merge', providers: {} }
      const providerHeaders = (provider as OpenClawSyncProvider).headers

      const openclawProvider: OpenClawProviderConfig = {
        baseUrl,
        apiKey,
        api: apiType,
        models: provider.models.map((m) => {
          const synced = m as OpenClawSyncModel
          return {
            ...(synced.maxTokens !== undefined ? { maxTokens: synced.maxTokens } : {}),
            ...(synced.reasoning !== undefined ? { reasoning: synced.reasoning } : {}),
            ...(synced.input ? { input: synced.input } : {}),
            ...(synced.cost ? { cost: synced.cost } : {}),
            id: m.id,
            name: m.name,
            contextWindow: synced.contextWindow ?? 128000
          }
        })
      }
      if (providerHeaders && Object.keys(providerHeaders).length > 0) {
        openclawProvider.headers = { ...providerHeaders }
      }

      // Set gateway mode to local (required for gateway to start)
      config.gateway = config.gateway || {}
      config.gateway.mode = 'local'
      config.gateway.port = this.gatewayPort
      // Auto-generate auth token if not already set. Publish it in memory only after
      // the candidate is valid and the formal config write succeeds.
      const token = this.gatewayAuthToken || this.generateAuthToken()
      config.gateway.auth = { token }

      // Silence OpenClaw's update banner. Its "Update now" button swaps the binary
      // BinaryManager installed and version-tracks; the hint has no env kill switch
      // (unlike OPENCLAW_NO_AUTO_UPDATE, which only blocks automatic applies).
      // Only defaulted, never forced: a user who sets checkOnStart themselves keeps it.
      if (config.update?.checkOnStart === undefined) {
        config.update = { ...config.update, checkOnStart: false }
      }

      config.models.providers = {
        ...externalProviders,
        [providerKey]: openclawProvider
      }

      // Set primary model
      config.agents = config.agents || { defaults: {} }
      config.agents.defaults = config.agents.defaults || {}
      config.agents.defaults.model = {
        primary: `${providerKey}/${primaryModel.id}`
      }

      const serialized = JSON.stringify(config, null, 2)
      const candidatePath = AbsoluteFilePathSchema.parse(
        path.join(openclawConfigDir(), `openclaw.json.cherry-candidate-${crypto.randomUUID()}`)
      )
      try {
        await atomicWriteFile(candidatePath, serialized, { mode: OPENCLAW_CONFIG_FILE_MODE })
        await this.assertConfigValid(runtime, candidatePath)
        await atomicWriteFile(openclawConfigPath(), serialized, { mode: OPENCLAW_CONFIG_FILE_MODE })
        this.gatewayAuthToken = token
      } finally {
        await remove(candidatePath).catch((cleanupError) => {
          const summary = this.sanitizeDiagnostic(
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          )
          logger.warn('Failed to remove OpenClaw config validation candidate', { summary })
        })
      }

      logger.info(`Synced provider ${provider.id} to OpenClaw config`)
      return { success: true }
    } catch (error) {
      const summary = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
      logger.error('Failed to sync provider config:', new Error(summary))
      return { success: false, message: summary }
    }
  }

  /**
   * Like checkGatewayHealth but also returns error message when unhealthy.
   * Uses HTTP request for faster health checks.
   * Expected response: {"ok":true,"status":"live"}
   */
  private async checkGatewayHealthWithError(): Promise<GatewayHealthProbeResult> {
    return this.probeGatewayHealth()
  }

  private async probeGatewayHealth(): Promise<GatewayHealthProbeResult> {
    try {
      const response = await fetch(`http://127.0.0.1:${this.gatewayPort}/healthz`, {
        signal: AbortSignal.timeout(3000)
      })
      if (!response.ok) {
        return { status: 'unhealthy', error: `HTTP ${response.status}: ${response.statusText}` }
      }

      const body = await response.text()
      let data: { ok?: boolean; status?: string }
      try {
        data = JSON.parse(body) as { ok?: boolean; status?: string }
      } catch {
        const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'unknown content type'
        return { status: 'unhealthy', error: `Invalid JSON from /healthz (${contentType})` }
      }

      if (data.ok && data.status === 'live') {
        return { status: 'healthy' }
      }
      return { status: 'unhealthy', error: `Gateway not live: ${JSON.stringify(data)}` }
    } catch (error) {
      return { status: 'unhealthy', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Determine the API type based on model and provider
   * This supports mixed providers (cherryin, aihubmix, new-api, etc.) that have both OpenAI and Anthropic endpoints
   *
   * Priority order:
   * 1. Provider type (anthropic, vertex-anthropic always use Anthropic API)
   * 2. Model endpoint_type (explicit endpoint configuration)
   * 3. Provider has anthropicApiHost configured
   * 4. Default to OpenAI-compatible
   */
  private determineApiType(provider: Provider, model: Model): string {
    // 1. Check if provider type is always Anthropic
    if (ANTHROPIC_ONLY_PROVIDERS.includes(provider.type)) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }

    // 2. Check model's endpoint_type (used by new-api and other mixed providers)
    if (isAnthropicEndpointType(model)) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }
    if (model.endpoint_type === 'openai-response') {
      return OPENCLAW_API_TYPES.OPENAI_RESPOSNE
    }

    // 3. Check if provider has anthropicApiHost configured
    if (provider.anthropicApiHost) {
      return OPENCLAW_API_TYPES.ANTHROPIC
    }

    if (provider.type === 'openai-response') {
      return OPENCLAW_API_TYPES.OPENAI_RESPOSNE
    }

    // 4. Default to OpenAI-compatible
    return OPENCLAW_API_TYPES.OPENAI
  }

  /**
   * Get the appropriate base URL for the given API type
   * For anthropic-messages, prefer anthropicApiHost if available
   * For openai-completions, use apiHost with proper formatting
   */
  private getBaseUrlForApiType(provider: Provider, apiType: string): string {
    if (apiType === OPENCLAW_API_TYPES.ANTHROPIC) {
      // For Anthropic API type, prefer anthropicApiHost if available
      const host = provider.anthropicApiHost || provider.apiHost
      return this.formatAnthropicUrl(host)
    }
    // For OpenAI-compatible API type
    return this.formatOpenAIUrl(provider)
  }

  /**
   * Format URL for OpenAI-compatible APIs
   * Provider-specific URL patterns:
   * - VertexAI: {location}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{location}/endpoints/openapi
   * - Gemini: {host}/v1beta/openai (OpenAI-compatible endpoint)
   * - Vercel AI Gateway: {host}/v1 (stored as /v1/ai, needs conversion)
   * - Others: {host}/v1
   */
  private formatOpenAIUrl(provider: Provider): string {
    // Special-case built-in GitHub / Copilot providers: these hosts should
    // not have a `/v1` suffix appended by default (renderer applies
    // `formatApiHost(..., false)` for these). Mirror that behavior here
    // to avoid constructing incorrect endpoints that return 404.
    if (provider.id === 'copilot' || provider.id === 'github') {
      return formatApiHost(provider.apiHost, false)
    }

    const url = withoutTrailingSlash(provider.apiHost)
    const providerType = provider.type

    // VertexAI: build OpenAI-compatible endpoint URL with project and location
    // https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-gemini-using-openai-library
    if (isVertexProvider(provider)) {
      const location = provider.location || 'us-central1'
      return `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${provider.project}/locations/${location}/endpoints/openapi`
    }

    // Gemini: use OpenAI-compatible endpoint
    // https://ai.google.dev/gemini-api/docs/openai
    if (providerType === 'gemini' && url.includes('generativelanguage.googleapis.com')) {
      return `${url}/v1beta/openai`
    }

    // Vercel AI Gateway: convert /v1/ai to /v1
    if (providerType === 'gateway' && url.endsWith('/v1/ai')) {
      return url.replace(/\/v1\/ai$/, '/v1')
    }

    // Skip if URL already has version (e.g., /v1, /v2, /v3)
    if (hasApiVersion(url)) {
      return url
    }

    return `${url}/v1`
  }

  /**
   * Format URL for Anthropic-compatible APIs (no version suffix needed)
   */
  private formatAnthropicUrl(apiHost: string): string {
    return withoutTrailingSlash(apiHost)
  }
}

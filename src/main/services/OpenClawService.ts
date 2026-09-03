import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Socket } from 'node:net'
import path from 'node:path'

import { application } from '@application'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { resolveEffectiveEndpoint } from '@main/ai/provider/endpoint'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isWin } from '@main/core/platform'
import type { Model, Provider, ProviderType, VertexProvider } from '@main/data/migration/legacyTypes'
import { t } from '@main/i18n'
import { atomicWriteFile, remove } from '@main/utils/file'
import { crossPlatformSpawn, removeEnvProxy } from '@main/utils/processRunner'
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
import { redactSecretText } from '@shared/utils/redaction'

import { vertexAiService } from './VertexAiService'

const logger = loggerService.withContext('OpenClawService')

const openclawConfigDir = () => application.getPath('external.openclaw.config')
const openclawConfigPath = (): AbsoluteFilePath =>
  AbsoluteFilePathSchema.parse(path.join(openclawConfigDir(), 'openclaw.json'))
const openclawConfigBakPath = () => path.join(openclawConfigDir(), 'openclaw.json.bak')
const openclawLegacyConfigPath = () => path.join(openclawConfigDir(), 'openclaw.cherry.json')
const DEFAULT_GATEWAY_PORT = 18790
const GATEWAY_PROBE_INTERVAL_MS = 5000
const OPENCLAW_COMMAND_TIMEOUT_MS = 10000
const OPENCLAW_COMMAND_CAPTURE_LIMIT_BYTES = 1024 * 1024
const OPENCLAW_SCHEMA_CAPTURE_LIMIT_BYTES = 32 * 1024 * 1024
const OPENCLAW_DIAGNOSTIC_LIMIT = 2000
const OPENCLAW_VISIBLE_ISSUE_LIMIT = 3
const OPENCLAW_CONFIG_FILE_MODE = 0o600

type OpenClawPreflightFailureKind = 'binary_incompatible' | 'external_config_invalid' | 'preflight_failed'

type OpenClawRuntime = {
  path: AbsoluteFilePath
  env: Record<string, string>
}

type OpenClawCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  outputTruncated: boolean
}

type OpenClawCommandOptions = {
  stdoutLimitBytes?: number
}

type OpenClawValidationIssue = {
  path: string
  message: string
  allowedValues?: unknown[]
}

type OpenClawConfigSchemaNode = {
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  $ref?: string
  properties?: Record<string, OpenClawConfigSchemaNode>
  additionalProperties?: boolean | OpenClawConfigSchemaNode
  items?: OpenClawConfigSchemaNode | OpenClawConfigSchemaNode[]
  anyOf?: OpenClawConfigSchemaNode[]
  oneOf?: OpenClawConfigSchemaNode[]
  allOf?: OpenClawConfigSchemaNode[]
}

interface OpenClawValidationReport {
  valid: boolean
  path?: string
  issues: OpenClawValidationIssue[]
  warnings: OpenClawValidationIssue[]
}

function sanitizeOpenClawDiagnostic(diagnostic: string): string {
  return redactSecretText(diagnostic).slice(0, OPENCLAW_DIAGNOSTIC_LIMIT)
}

function isCherryManagedConfigPath(configPath: string): boolean {
  return configPath.startsWith('models.providers.cherry-')
}

const PERMISSIVE_CONFIG_SCHEMA: OpenClawConfigSchemaNode = {}

function schemaIncludesType(schema: OpenClawConfigSchemaNode, type: string): boolean {
  if (schema.type === undefined) return true
  return Array.isArray(schema.type) ? schema.type.includes(type) : schema.type === type
}

function combineSchemaConstraints(schemas: OpenClawConfigSchemaNode[]): OpenClawConfigSchemaNode {
  if (schemas.length === 1) return schemas[0]
  return { allOf: schemas }
}

function findSchemaAtPath(
  schema: OpenClawConfigSchemaNode,
  [segment, ...remaining]: string[]
): OpenClawConfigSchemaNode | undefined {
  if (segment === undefined) return schema

  let directChild: OpenClawConfigSchemaNode | undefined
  if (segment === '[]') {
    if (!schemaIncludesType(schema, 'array')) return undefined
    if (Array.isArray(schema.items)) directChild = { anyOf: schema.items }
    else directChild = schema.items ?? PERMISSIVE_CONFIG_SCHEMA
  } else {
    if (!schemaIncludesType(schema, 'object')) return undefined
    const property = segment === '*' ? undefined : schema.properties?.[segment]
    if (property) directChild = property
    else if (typeof schema.additionalProperties === 'object') directChild = schema.additionalProperties
    else if (schema.additionalProperties !== false) directChild = PERMISSIVE_CONFIG_SCHEMA
    else return undefined
  }

  const constraints: OpenClawConfigSchemaNode[] = []
  const directConstraint = findSchemaAtPath(directChild, remaining)
  if (!directConstraint) return undefined
  constraints.push(directConstraint)

  for (const branch of schema.allOf ?? []) {
    const branchConstraint = findSchemaAtPath(branch, [segment, ...remaining])
    if (!branchConstraint) return undefined
    constraints.push(branchConstraint)
  }

  for (const alternatives of [schema.anyOf, schema.oneOf]) {
    if (!alternatives) continue
    const branchConstraints = alternatives.flatMap((branch) => {
      const branchConstraint = findSchemaAtPath(branch, [segment, ...remaining])
      return branchConstraint ? [branchConstraint] : []
    })
    if (branchConstraints.length === 0) return undefined
    constraints.push(branchConstraints.length === 1 ? branchConstraints[0] : { anyOf: branchConstraints })
  }

  return combineSchemaConstraints(constraints)
}

function schemaSupportsPath(schema: OpenClawConfigSchemaNode, pathSegments: string[]): boolean {
  return findSchemaAtPath(schema, pathSegments) !== undefined
}

function schemaTypeMatches(type: string | string[] | undefined, value: unknown): boolean {
  if (type === undefined) return true
  const types = Array.isArray(type) ? type : [type]
  return types.some((candidate) => {
    if (candidate === 'null') return value === null
    if (candidate === 'array') return Array.isArray(value)
    if (candidate === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    if (candidate === 'integer') return typeof value === 'number' && Number.isInteger(value)
    return typeof value === candidate
  })
}

function schemaValueMatches(schema: OpenClawConfigSchemaNode, value: unknown): boolean {
  if (!schemaTypeMatches(schema.type, value)) return false
  if (schema.const !== undefined && !Object.is(schema.const, value)) return false
  if (schema.enum !== undefined && !schema.enum.some((candidate) => Object.is(candidate, value))) return false
  if (schema.anyOf !== undefined && !schema.anyOf.some((branch) => schemaValueMatches(branch, value))) return false
  if (schema.oneOf !== undefined && !schema.oneOf.some((branch) => schemaValueMatches(branch, value))) return false
  if (schema.allOf !== undefined && !schema.allOf.every((branch) => schemaValueMatches(branch, value))) return false
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return true

  return Object.entries(schema.properties ?? {}).every(
    ([key, property]) => !(key in value) || schemaValueMatches(property, (value as Record<string, unknown>)[key])
  )
}

function projectDirectSchemaValue(schema: OpenClawConfigSchemaNode, value: unknown): unknown {
  if (Array.isArray(value)) {
    if (schema.items === undefined) return value
    return value.map((item, index) => {
      const itemSchema = Array.isArray(schema.items) ? schema.items[index] : schema.items
      return itemSchema ? projectSchemaSupportedValue(itemSchema, item) : item
    })
  }

  if (value === null || typeof value !== 'object') return value
  if (schema.properties === undefined && schema.additionalProperties === undefined) return value

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, childValue]) => {
      const property = schema.properties?.[key]
      if (property) return [[key, projectSchemaSupportedValue(property, childValue)]]
      if (typeof schema.additionalProperties === 'object') {
        return [[key, projectSchemaSupportedValue(schema.additionalProperties, childValue)]]
      }
      return schema.additionalProperties === false ? [] : [[key, childValue]]
    })
  )
}

function mergeAlternativeProjections(values: unknown[]): unknown {
  if (values.length === 1) return values[0]
  if (values.every(Array.isArray)) {
    const arrays = values as unknown[][]
    return Array.from({ length: Math.max(...arrays.map((value) => value.length)) }, (_, index) =>
      mergeAlternativeProjections(arrays.flatMap((value) => (index in value ? [value[index]] : [])))
    )
  }
  if (values.every((value) => value !== null && typeof value === 'object' && !Array.isArray(value))) {
    const objects = values as Record<string, unknown>[]
    return Object.fromEntries(
      [...new Set(objects.flatMap((value) => Object.keys(value)))].map((key) => [
        key,
        mergeAlternativeProjections(objects.flatMap((value) => (key in value ? [value[key]] : [])))
      ])
    )
  }
  return values[0]
}

function projectSchemaSupportedValue(schema: OpenClawConfigSchemaNode, value: unknown): unknown {
  let projected = projectDirectSchemaValue(schema, value)

  for (const branch of schema.allOf ?? []) {
    projected = projectSchemaSupportedValue(branch, projected)
  }

  for (const alternatives of [schema.anyOf, schema.oneOf]) {
    if (!alternatives || alternatives.length === 0) continue
    const matchingAlternatives = alternatives.filter((branch) => schemaValueMatches(branch, value))
    const selectedAlternatives = matchingAlternatives.length > 0 ? matchingAlternatives : alternatives
    projected = mergeAlternativeProjections(
      selectedAlternatives.map((branch) => projectSchemaSupportedValue(branch, projected))
    )
  }

  return projected
}

function pickSchemaSupportedProperties(
  schema: OpenClawConfigSchemaNode,
  basePath: string[],
  value: unknown
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}

  const schemaNode = findSchemaAtPath(schema, basePath)
  if (!schemaNode) return {}
  return projectSchemaSupportedValue(schemaNode, value) as Record<string, unknown>
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
  // Bumped by every setGatewayStatus; probes discard results from an older generation.
  private gatewayTransitionId = 0

  public get gatewayUrl(): string {
    return `ws://127.0.0.1:${this.gatewayPort}/ws`
  }

  protected async onInit(): Promise<void> {
    // IPC handlers migrated to IpcApi (openclaw.*)
  }

  protected async onReady(): Promise<void> {
    // Align the probe port with the persisted preference so external gateways on a
    // custom port are detected before any sync/start runs this session.
    this.syncGatewayPortFromPreference()
    this.registerDisposable(
      application
        .get('PreferenceService')
        .subscribeChange('feature.openclaw.gateway_port', () => this.onGatewayPortPreferenceChanged())
    )
    // Report a gateway that died without telling us; registerInterval is lifecycle-cleaned.
    this.registerInterval(() => this.probeGatewayTick(), GATEWAY_PROBE_INTERVAL_MS)
  }

  private syncGatewayPortFromPreference(): void {
    const port = application.get('PreferenceService').get('feature.openclaw.gateway_port')
    if (Number.isInteger(port) && port >= 1 && port <= 65535) this.gatewayPort = port
  }

  private onGatewayPortPreferenceChanged(): void {
    // While a gateway runs on the old port, repointing would mislabel it stopped;
    // adopt the new port once the gateway is idle (the next start/sync uses it anyway).
    if (this.gatewayStatus === 'stopped' || this.gatewayStatus === 'error') this.syncGatewayPortFromPreference()
  }

  protected async onStop(): Promise<void> {
    await this.stopGateway()
  }

  /** Single gateway-status-transition point: assign, then broadcast; same-value calls are not transitions. */
  private setGatewayStatus(status: GatewayStatus, options?: { force?: boolean }): void {
    if (!options?.force && this.gatewayStatus === status) return
    this.gatewayStatus = status
    this.gatewayTransitionId++
    // Becoming idle is the moment a port preference change deferred during a run takes effect.
    if (status === 'stopped' || status === 'error') this.syncGatewayPortFromPreference()
    try {
      application.get('IpcApiService').broadcast('openclaw.status_changed', { status: this.gatewayStatus })
    } catch (err) {
      // A lost broadcast is corrected by the next transition or a request-completion
      // rebroadcast; it must never abort the transition itself.
      logger.warn('Failed to broadcast OpenClaw gateway status change', err as Error)
    }
  }

  /**
   * Generation snapshot for mid-flight probes: a monotonic transition counter
   * (covers stop→start cycles that revisit the same status) plus the port,
   * which can change without a transition via syncConfig.
   */
  private gatewayGeneration(): { transitionId: number; port: number } {
    return { transitionId: this.gatewayTransitionId, port: this.gatewayPort }
  }

  private gatewayGenerationChanged(before: { transitionId: number; port: number }): boolean {
    return this.gatewayTransitionId !== before.transitionId || this.gatewayPort !== before.port
  }

  /** Apply a fresh probe result against the pre-probe status (generation already verified by callers). */
  private reconcileGatewayStatus(health: HealthInfo['status'], statusBefore: GatewayStatus): void {
    if (health === 'healthy' && statusBefore !== 'running') {
      logger.info(`Detected externally running gateway on port ${this.gatewayPort}`)
      this.setGatewayStatus('running')
    } else if (health === 'unhealthy' && statusBefore === 'running') {
      logger.warn(`Gateway on port ${this.gatewayPort} is no longer reachable, marking as stopped`)
      this.setGatewayStatus('stopped')
    }
  }

  /**
   * One periodic probe tick: liveness of the gateway this service believes is
   * running, so a death nobody reported surfaces as an event. Discovery of a
   * gateway this service never started is a read-time concern — `getStatus()`
   * probes for it — so an idle service does no background IO.
   */
  private async probeGatewayTick(): Promise<void> {
    if (this.gatewayStatus !== 'running') return
    const generationBefore = this.gatewayGeneration()
    const statusBefore = this.gatewayStatus
    try {
      const { status } = await this.checkGatewayHealth()
      // Any transition or port change that completed mid-probe invalidates its result.
      if (this.gatewayGenerationChanged(generationBefore)) return
      this.reconcileGatewayStatus(status, statusBefore)
    } catch (error) {
      // Unreachable gateways surface as an unhealthy result, not an exception; only
      // unexpected errors land here.
      logger.warn('OpenClaw gateway health probe failed', error as Error)
    }
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

    return {
      path: AbsoluteFilePathSchema.parse(openclaw.path),
      env: openclaw.source === 'system' ? await getRawShellEnv() : managedShellEnv
    }
  }

  private runOpenClawCommand(
    openclawPath: AbsoluteFilePath,
    args: string[],
    env: Record<string, string>,
    options: OpenClawCommandOptions = {}
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

      const stdoutCapture = this.createOutputCapture(options.stdoutLimitBytes)
      const stderrCapture = this.createOutputCapture()
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

  private createOutputCapture(limitBytes = OPENCLAW_COMMAND_CAPTURE_LIMIT_BYTES) {
    const chunks: Buffer[] = []
    let capturedBytes = 0

    return {
      append: (chunk: Buffer | string): boolean => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        const remaining = Math.max(0, limitBytes - capturedBytes)
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
    if (report.issues !== undefined && (!Array.isArray(report.issues) || !report.issues.every(isIssue))) fail()
    if (report.warnings !== undefined && (!Array.isArray(report.warnings) || !report.warnings.every(isIssue))) fail()
    const valid = report.valid as boolean
    const reportPath = report.path as string | undefined
    const issues = (report.issues ?? []) as OpenClawValidationIssue[]
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
      const report = this.parseValidationResult(result)
      if (report.path === undefined || path.resolve(report.path) !== path.resolve(configPath)) {
        logger.warn('OpenClaw config validation used an unexpected config path', {
          expectedPath: configPath,
          reportedPath: report.path ?? null
        })
        throw new OpenClawPreflightError(
          'binary_incompatible',
          t('openclaw.errors.binary_incompatible', { details: '' })
        )
      }
      return report
    } catch (error) {
      const summary = this.sanitizeDiagnostic(error instanceof Error ? error.message : String(error))
      logger.warn('OpenClaw config validation failed', { summary })
      if (error instanceof OpenClawPreflightError) {
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

  private async assertSchemaCapability(runtime: OpenClawRuntime): Promise<OpenClawConfigSchemaNode> {
    let result: OpenClawCommandResult
    try {
      result = await this.runOpenClawCommand(
        runtime.path,
        ['config', 'schema'],
        {
          ...runtime.env,
          OPENCLAW_CONFIG_PATH: openclawConfigPath()
        },
        { stdoutLimitBytes: OPENCLAW_SCHEMA_CAPTURE_LIMIT_BYTES }
      )
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
    return schema as OpenClawConfigSchemaNode
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
    // Guard before touching the port so a concurrent-start rejection cannot repoint
    // it, and an omitted port keeps the preference-synced value instead of the default.
    if (this.gatewayStatus === 'starting') {
      return { success: false, message: 'Gateway is already starting' }
    }
    if (port !== undefined) this.gatewayPort = port

    try {
      const runtime = await this.resolveOpenClawRuntime()
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

      this.setGatewayStatus('starting')

      await this.startAndWaitForGateway(runtime.path, runtime.env)
      this.setGatewayStatus('running')
      logger.info(`Gateway started on port ${this.gatewayPort}`)
      return { success: true }
    } catch (error) {
      this.setGatewayStatus('error')
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to start gateway:', error as Error)
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
    // Copy before stripping: removeEnvProxy mutates in place, and shellEnv is reused
    // for other OpenClaw commands. OpenClaw's undici EnvHttpProxyAgent rejects socks5://.
    const env = { ...shellEnv }
    removeEnvProxy(env)
    const proc = crossPlatformSpawn(openclawPath, args, {
      // OpenClaw's own auto-updater would swap the binary underneath us, desyncing the
      // version BinaryManager installed and reports. This is OpenClaw's documented kill
      // switch, scoped to the gateway process we spawn.
      env: {
        ...env,
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
    let stdoutOutput = ''
    let stderrOutput = ''
    proc.stdout?.on('data', (data) => {
      stdoutOutput += data.toString()
    })
    proc.stderr?.on('data', (data) => {
      stderrOutput += data.toString()
    })
    proc.on('error', (err) => {
      earlyExitError = err.message
    })
    proc.on('exit', (code) => {
      // Capture output from both streams for diagnostics
      const combinedOutput = [stderrOutput.trim(), stdoutOutput.trim()].filter(Boolean).join('\n')
      const detail = combinedOutput.split('\n').filter(Boolean).slice(0, 5).join('\n')
      if (code !== 0) {
        earlyExitError = detail || `gateway exited with code ${code}`
      } else {
        // Process exited with code 0 but gateway may not be healthy (e.g. daemonized child failed)
        earlyExitError = detail
          ? `gateway exited with code 0 but output: ${detail}`
          : 'gateway process exited with code 0 before becoming healthy'
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
    const diagnostics = [
      lastError ? `health: ${lastError}` : '',
      stderrOutput.trim() ? `stderr: ${stderrOutput.trim().split('\n').slice(0, 5).join('\n')}` : '',
      stdoutOutput.trim() ? `stdout: ${stdoutOutput.trim().split('\n').slice(0, 5).join('\n')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const detail = diagnostics ? `\n${diagnostics}` : ''
    throw new Error(`Gateway failed to start within ${maxWaitMs}ms (${pollCount} polls)${detail}`)
  }

  /**
   * Stop the OpenClaw Gateway.
   * Kills all openclaw processes to ensure clean shutdown.
   */
  public async stopGateway(): Promise<OperationResult> {
    const transitionBefore = this.gatewayTransitionId
    try {
      this.killAllOpenClawProcesses()

      const stillRunning = await this.waitForGatewayStop()
      if (stillRunning) {
        this.setGatewayStatus('error')
        return { success: false, message: 'Failed to stop gateway' }
      }

      this.setGatewayStatus('stopped')
      // A no-op stop (already stopped) still confirms the terminal state to the renderer.
      if (this.gatewayTransitionId === transitionBefore) this.setGatewayStatus('stopped', { force: true })
      logger.info('Gateway stopped')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to stop gateway:', error as Error)
      this.setGatewayStatus('error')
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

    const generationBefore = this.gatewayGeneration()
    const statusBefore = this.gatewayStatus
    const { status } = await this.checkGatewayHealth()
    // Any transition or port change that completed mid-probe invalidates its result.
    if (!this.gatewayGenerationChanged(generationBefore)) {
      this.reconcileGatewayStatus(status, statusBefore)
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
      logger.warn('Failed to load auth token from config file', error as Error)
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
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to resolve OpenClaw sync config:', error as Error)
      return { success: false, message: errorMessage }
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

    const resolvedEndpoint = resolveEffectiveEndpoint(provider, primaryModel, {
      operationCapability: MODEL_CAPABILITY.TEXT_GENERATION
    })
    const endpointType = resolvedEndpoint.endpointType ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const apiHost = resolvedEndpoint.baseUrl

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
        anthropicApiHost: endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ? apiHost : undefined,
        models: models
          .filter(
            (model) =>
              !model.isHidden && !isNonChatModel(model) && this.getModelEndpointType(model, provider) === endpointType
          )
          .map((model) => this.toOpenClawModel(model, provider)),
        presetProviderId: provider.presetProviderId,
        headers: provider.settings?.extraHeaders
      },
      primaryModel: this.toOpenClawModel(primaryModel, provider)
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
    return (
      resolveEffectiveEndpoint(provider, model, { operationCapability: MODEL_CAPABILITY.TEXT_GENERATION })
        .endpointType ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    )
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

  private toOpenClawModel(model: DataModel, provider: DataProvider): OpenClawSyncModel {
    const { modelId } = parseUniqueModelId(model.id)
    const input = model.inputModalities?.filter((modality) => modality === 'text' || modality === 'image')
    const cost = this.toOpenClawCost(model)
    return {
      id: model.apiModelId ?? modelId,
      provider: model.providerId,
      name: model.name,
      group: model.group ?? '',
      endpoint_type: this.toOpenClawEndpointType(this.getModelEndpointType(model, provider)),
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
      const configSchema = await this.assertSchemaCapability(runtime)

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
          logger.warn('Failed to get VertexAI access token, using provider apiKey:', err as Error)
        }
      }

      // Providers like Ollama and LM Studio don't require real API keys,
      // but OpenClaw needs a non-empty placeholder value
      if (!apiKey) {
        apiKey = this.getNoKeyPlaceholder(provider) ?? 'no-key-required'
      }

      // Remove inactive Cherry-generated providers. On the selected provider, retain only
      // hand-edited fields supported by the live OpenClaw schema; Cherry-owned identity,
      // endpoint, credential, and model-name fields are always regenerated below.
      const providerSchemaPath = ['models', 'providers', '*']
      const modelSchemaPath = [...providerSchemaPath, 'models', '[]']
      const providers = config.models?.providers ?? {}
      const externalProviders = Object.fromEntries(
        Object.entries(providers).filter(([key]) => !key.startsWith('cherry-'))
      )
      const existingProvider = providers[providerKey]
      const existingModelMap = new Map((existingProvider?.models ?? []).map((model) => [model.id, model]))
      config.models = config.models || { mode: 'merge', providers: {} }
      const providerHeaders = (provider as OpenClawSyncProvider).headers
      const existingProviderOverrides = pickSchemaSupportedProperties(
        configSchema,
        providerSchemaPath,
        existingProvider
      )
      const supportsProviderField = (field: string) => schemaSupportsPath(configSchema, [...providerSchemaPath, field])
      const supportsModelField = (field: string) => schemaSupportsPath(configSchema, [...modelSchemaPath, field])

      const openclawProvider: OpenClawProviderConfig = {
        ...existingProviderOverrides,
        baseUrl,
        apiKey,
        api: apiType,
        models: provider.models.map((m) => {
          const synced = m as OpenClawSyncModel
          const existing = existingModelMap.get(m.id)
          return {
            ...(supportsModelField('maxTokens') && synced.maxTokens !== undefined
              ? { maxTokens: synced.maxTokens }
              : {}),
            ...(supportsModelField('reasoning') && synced.reasoning !== undefined
              ? { reasoning: synced.reasoning }
              : {}),
            ...(supportsModelField('input') && synced.input ? { input: synced.input } : {}),
            ...(supportsModelField('cost') && synced.cost ? { cost: synced.cost } : {}),
            ...(supportsModelField('contextWindow') ? { contextWindow: synced.contextWindow ?? 128000 } : {}),
            ...pickSchemaSupportedProperties(configSchema, modelSchemaPath, existing),
            id: m.id,
            name: m.name
          }
        })
      }
      if (supportsProviderField('headers')) {
        const existingHeaders = existingProviderOverrides.headers as Record<string, string> | undefined
        const headers = { ...providerHeaders, ...existingHeaders }
        if (Object.keys(headers).length > 0) openclawProvider.headers = headers
      } else {
        delete openclawProvider.headers
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
          logger.warn('Failed to remove OpenClaw config validation candidate', cleanupError as Error)
        })
      }

      logger.info(`Synced provider ${provider.id} to OpenClaw config`)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to sync provider config:', error as Error)
      return { success: false, message: errorMessage }
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
    // Special-case the built-in Copilot provider: its host should
    // not have a `/v1` suffix appended by default (renderer applies
    // `formatApiHost(..., false)`). Mirror that behavior here
    // to avoid constructing incorrect endpoints that return 404.
    if (provider.id === 'copilot') {
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

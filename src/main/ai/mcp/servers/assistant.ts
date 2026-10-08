import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { type CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { app } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { createAgent as createAgentCommand } from '@main/ai/agents/createAgent'
import { type AssistantToolName, DEFAULT_ASSISTANT_TOOL_NAMES } from '@main/ai/toolApproval/assistantToolNames'
import { providerChatBaseUrl } from '@main/utils/providerEndpoint'
import { ErrorCode as DataApiErrorCode, isDataApiError } from '@shared/data/api/errors'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { DoctorRunTier } from '@shared/types/doctor'
import {
  DIAGNOSTIC_DESCRIPTION_MAX_BYTES,
  diagnosticDescriptionByteLength,
  normalizeDiagnosticDescription
} from '@shared/utils/diagnostics'
import { projectDoctorReport } from '@shared/utils/doctor'
import { isAllowedNavigationPath } from '@shared/utils/navigationPath'
import { isExternalCliProvider } from '@shared/utils/provider'
import { redactUrlToOrigin } from '@shared/utils/redaction'

const logger = loggerService.withContext('McpServer:Assistant')

/**
 * Whether `read_source` must refuse a file as sensitive. Covers every dotenv variant
 * (`.env`, `.env.local`, `.env.production`, …) except the `.env.example` template,
 * credential files, SSH private keys, and private-key/cert material. Case-insensitive.
 */
export function isBlockedSourceFile(basename: string): boolean {
  const name = basename.toLowerCase()
  const isSensitiveEnv = name.startsWith('.env') && name !== '.env.example'
  const isPrivateKeyOrCert = /\.(pem|key|p12|pfx)$/.test(name)
  const isExactSensitive = ['credentials.json', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(name)
  return isSensitiveEnv || isPrivateKeyOrCert || isExactSensitive
}

/**
 * Resolve a path through any symlinks, falling back to the nearest existing ancestor when the
 * target itself does not exist yet. Mirrors the filesystem server's
 * `resolveRealOrNearestExistingPath` so symlink escapes are caught before the containment check.
 */
function resolveRealOrNearestExistingPath(targetPath: string): string {
  try {
    return path.normalize(fs.realpathSync(targetPath))
  } catch {
    let currentPath = path.dirname(targetPath)

    while (true) {
      try {
        const realCurrentPath = fs.realpathSync(currentPath)
        const relativeSuffix = path.relative(currentPath, targetPath)
        return path.normalize(path.join(realCurrentPath, relativeSuffix))
      } catch {
        const parentPath = path.dirname(currentPath)
        if (parentPath === currentPath) {
          logger.warn('Could not resolve any existing ancestor for path', { targetPath })
          return path.normalize(targetPath)
        }
        currentPath = parentPath
      }
    }
  }
}

// Whitelist of settings Cherry Assistant can write directly. Each entry binds
// a `setting` key to a value validator and an `apply` function that performs
// the write. Settings not in this map are rejected — adding a new one
// requires explicit code change so a destructive or sensitive setting can
// never be flipped via prompt injection.
interface ApplySettingEntry {
  allowed: readonly string[]
  apply: (value: string) => Promise<string> | string
  /** Human-readable hint shown in the tool description. */
  hint: string
}

// Only settings whose change is observable to the user without an app restart
// are listed here.
const APPLY_SETTING_REGISTRY = {
  theme: {
    allowed: [ThemeMode.light, ThemeMode.dark, ThemeMode.system],
    hint: 'theme: light | dark | system',
    apply: async (value) => {
      await application.get('PreferenceService').set('ui.theme_mode', value as ThemeMode)
      return `Theme switched to ${value}.`
    }
  }
} satisfies Record<string, ApplySettingEntry>

type ApplySettingName = keyof typeof APPLY_SETTING_REGISTRY

const HEALTH_CACHE_TTL = 30_000 // 30 seconds
const HEALTH_TIMEOUT_MS = 10_000
const healthCacheKey = (providerId: string) => `assistant:health:${providerId}`

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function textResult(text: string, isError?: true): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError } : {}) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readProductManifest(): Record<string, unknown> {
  const manifestPath = application.getPath('feature.agents.assistant.manifest.file')
  let rawManifest: string
  try {
    rawManifest = fs.readFileSync(manifestPath, 'utf-8')
  } catch {
    throw new Error('Product manifest is unavailable')
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(rawManifest)
  } catch {
    throw new Error('Product manifest contains invalid JSON')
  }
  const manifestRecord =
    typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>)
      : undefined
  const packageRecord =
    typeof manifestRecord?.package === 'object' &&
    manifestRecord.package !== null &&
    !Array.isArray(manifestRecord.package)
      ? (manifestRecord.package as Record<string, unknown>)
      : undefined
  if (
    manifestRecord?.schemaVersion !== 1 ||
    typeof packageRecord?.version !== 'string' ||
    packageRecord.version.trim().length === 0
  ) {
    throw new Error('Product manifest schema is invalid')
  }
  return manifestRecord
}

function getManifestNavigationRoutes(manifest: Record<string, unknown>): string[] {
  const routes = manifest.routes
  if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) {
    throw new Error('Product manifest routes are invalid')
  }
  const allRoutes = (routes as Record<string, unknown>).all
  if (!Array.isArray(allRoutes)) {
    throw new Error('Product manifest routes are invalid')
  }

  return allRoutes.filter(
    (route): route is string =>
      typeof route === 'string' &&
      (route === '/settings' || route.startsWith('/settings/') || route.startsWith('/app/'))
  )
}

const NavigateInputSchema = z.object({
  path: z.string().min(1).describe('A current package route returned by product_info.'),
  query: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional URL query parameters, e.g. { "id": "anthropic" }')
})

function navigate(args: z.infer<typeof NavigateInputSchema>): CallToolResult {
  const normalizedPath = args.path.startsWith('/') ? args.path : `/${args.path}`

  const allowedRoutes = getManifestNavigationRoutes(readProductManifest())
  if (!isAllowedNavigationPath(normalizedPath, allowedRoutes)) {
    throw new Error(`Blocked navigation to disallowed route: ${normalizedPath}`)
  }

  const qs = new URLSearchParams(args.query).toString()
  const fullPath = qs ? `${normalizedPath}?${qs}` : normalizedPath

  // Don't actually navigate here — the renderer will show a clickable button
  // that the user can click to navigate. This keeps the tool non-blocking.
  logger.info('Navigate tool called (deferred to user click)', { path: fullPath })
  return textResult(`Navigate link created: ${fullPath}`)
}

const ProductInfoInputSchema = z.strictObject({
  source: z.enum(['manifest']).describe('Current installed package facts.'),
  section: z
    .string()
    .optional()
    .describe(
      'Optional for manifest. Use a section name returned by the compact manifest index (for example routes, commands, providers, locales, or agents). Use all only when several sections are genuinely needed.'
    )
})

function productInfo({ section }: z.infer<typeof ProductInfoInputSchema>): CallToolResult {
  const manifest = readProductManifest()
  const manifestVersion = (manifest.package as Record<string, unknown>).version as string

  let result: Record<string, unknown>
  if (section === undefined) {
    result = {
      runtimeVersion: app.getVersion(),
      manifestVersion,
      sections: Object.keys(manifest).filter((key) => key !== 'schemaVersion')
    }
  } else if (section === 'all') {
    result = { runtimeVersion: app.getVersion(), manifestVersion, section, manifest }
  } else if (Object.prototype.hasOwnProperty.call(manifest, section)) {
    result = { runtimeVersion: app.getVersion(), manifestVersion, section, data: manifest[section] }
  } else {
    throw new Error(`Unknown product manifest section: ${section}`)
  }

  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

const ApplySettingInputSchema = z.object({
  setting: z
    .enum(Object.keys(APPLY_SETTING_REGISTRY) as [ApplySettingName, ...ApplySettingName[]])
    .describe('Which setting to change.'),
  value: z.string().describe('New value for the selected setting.')
})

async function applySetting({ setting, value }: z.infer<typeof ApplySettingInputSchema>): Promise<CallToolResult> {
  const entry: ApplySettingEntry = APPLY_SETTING_REGISTRY[setting]
  if (!entry.allowed.includes(value)) {
    throw new Error(`Value '${value}' is not valid for setting '${setting}'. Allowed: ${entry.allowed.join(', ')}`)
  }

  const message = await entry.apply(value)
  logger.info('apply_setting succeeded', { setting, value })
  return textResult(message)
}

const CreateAgentInputSchema = z.object({
  name: z.string().trim().min(1).describe('Short human-readable name (e.g. "Python Reviewer", "周报助手"). Required.'),
  description: z
    .string()
    .optional()
    .describe('One-line description shown in the agent list. Optional but recommended.'),
  instructions: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The agent's system prompt — role, behavior, output format. Required. Write it in the user's preferred language. Keep concise (under ~300 lines)."
    ),
  model: z
    .string()
    .optional()
    .describe(
      'Optional model id in the form "providerId::modelId" (e.g. "cherryin::agent/glm-5.1", "anthropic::claude-sonnet"). When omitted, the new agent uses Cherry Assistant\'s current model.'
    )
})

const CreateAgentOutputSchema = z.object({
  ok: z.literal(true),
  agentId: z.string(),
  name: z.string(),
  model: z.string()
})

async function createAgent(
  args: z.infer<typeof CreateAgentInputSchema>,
  defaultModel: UniqueModelId | undefined
): Promise<CallToolResult> {
  const { name, instructions } = args
  const model = args.model?.trim() || defaultModel
  const description = args.description?.trim() || undefined

  if (!model) throw new Error("'model' is required when no default model is configured")

  const parsedModel = UniqueModelIdSchema.safeParse(model)
  if (!parsedModel.success) {
    throw new Error(`'model' must be in the form "providerId::modelId" (got "${model}")`)
  }

  const { providerId, modelId } = parseUniqueModelId(parsedModel.data)
  try {
    modelService.getByKey(providerId, modelId)
  } catch (error) {
    if (isDataApiError(error) && error.code === DataApiErrorCode.NOT_FOUND) {
      throw new Error(`Model is not configured in Cherry Studio: ${parsedModel.data}`)
    }
    throw error
  }

  try {
    const result = await createAgentCommand({
      type: 'claude-code',
      name,
      description,
      instructions,
      model: parsedModel.data,
      configuration: {
        permission_mode: 'default',
        env_vars: {}
      }
    })
    logger.info('create_agent succeeded', { agentId: result.id, name })
    const output = { ok: true as const, agentId: result.id, name: result.name, model: result.model }
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output
    }
  } catch (error) {
    const msg = errorMessage(error)
    logger.error('create_agent failed', { error: msg, name })
    throw new Error(`Failed to create agent: ${msg}`)
  }
}

const PrepareDiagnosticReportInputSchema = z.strictObject({
  description: z
    .string()
    .describe('Editable report description. Maximum 4096 UTF-8 bytes after line endings are normalized to CRLF.')
})

const PrepareDiagnosticReportOutputSchema = z.object({
  ok: z.literal(true),
  description: z.string()
})

function prepareDiagnosticReport(args: z.infer<typeof PrepareDiagnosticReportInputSchema>): CallToolResult {
  const description = normalizeDiagnosticDescription(args.description.trim())
  if (!description) throw new Error('description must not be blank')
  if (diagnosticDescriptionByteLength(description) > DIAGNOSTIC_DESCRIPTION_MAX_BYTES) {
    throw new Error(
      `description must not exceed ${DIAGNOSTIC_DESCRIPTION_MAX_BYTES} UTF-8 bytes after CRLF normalization`
    )
  }

  const output = { ok: true as const, description }
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output
  }
}

const DiagnoseInputSchema = z
  .object({
    action: z
      .enum(['info', 'providers', 'health', 'doctor', 'logs', 'errors', 'mcp_status', 'read_source', 'config'])
      .describe(
        'info: app version/paths/system. providers: list configured providers. health: layered reachability of a provider endpoint (DNS/TLS/proxy/HTTP, cached 30s). doctor: run the System Doctor checks and return the report (quick = local checks, live = quick + network probes). logs: read recent log entries. errors: extract only ERROR/WARN entries from logs. mcp_status: check MCP server states. read_source: read a source file (read-only). config: read user settings (theme, language, proxy, default model, etc).'
      ),
    provider_id: z.string().optional().describe('Provider ID for the health action'),
    tier: z.enum(['quick', 'live']).optional().describe('Doctor tier for the doctor action (default quick)'),
    lines: z.coerce.number().optional().describe('Number of log lines to return (default 50, max 500)'),
    file_path: z
      .string()
      .optional()
      .describe('Relative file path for read_source action, e.g. src/main/ai/mcp/McpRuntimeService.ts')
  })
  .superRefine((args, ctx) => {
    if (args.action === 'health' && !args.provider_id)
      ctx.addIssue({ code: 'custom', message: "'provider_id' is required for health action", path: ['provider_id'] })
    if (args.action === 'read_source' && !args.file_path)
      ctx.addIssue({ code: 'custom', message: "'file_path' is required for read_source action", path: ['file_path'] })
  })

async function diagnose(args: z.infer<typeof DiagnoseInputSchema>, signal: AbortSignal): Promise<CallToolResult> {
  switch (args.action) {
    case 'info':
      return diagnoseInfo()
    case 'providers':
      return diagnoseProviders()
    case 'health':
      return await diagnoseHealth(args.provider_id!, signal)
    case 'doctor':
      return await diagnoseDoctor(args.tier ?? 'quick')
    case 'logs':
      return diagnoseLogs(args.lines)
    case 'errors':
      return diagnoseErrors(args.lines)
    case 'mcp_status':
      return diagnoseMcpStatus()
    case 'read_source':
      return readSource(args.file_path!, args.lines)
    case 'config':
      return await diagnoseConfig()
  }
}

function diagnoseInfo(): CallToolResult {
  const info = {
    app: {
      version: app.getVersion(),
      name: app.getName(),
      isPackaged: app.isPackaged,
      locale: app.getLocale()
    },
    paths: {
      userData: application.getPath('app.userdata'),
      logs: application.getPath('app.logs'),
      temp: application.getPath('sys.temp')
    },
    runtime: {
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      v8: process.versions.v8
    },
    system: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
      freeMemory: `${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`,
      cpus: os.cpus().length,
      hostname: os.hostname()
    }
  }

  return jsonResult(info)
}

function diagnoseProviders(): CallToolResult {
  try {
    const providers = providerService.list({})

    const summary = providers.map((p) => ({
      id: p.id,
      name: p.name,
      authType: p.authType,
      endpoints: p.endpointConfigs ? Object.keys(p.endpointConfigs) : [],
      defaultChatEndpoint: p.defaultChatEndpoint ?? null,
      hasApiKey: p.apiKeys.length > 0,
      enabled: p.isEnabled
    }))

    return jsonResult({ providerCount: summary.length, providers: summary })
  } catch (error) {
    return textResult(`Failed to read provider config: ${errorMessage(error)}`, true)
  }
}

async function diagnoseHealth(providerId: string, signal: AbortSignal): Promise<CallToolResult> {
  const cacheService = application.get('CacheService')
  const cached = cacheService.get<CallToolResult>(healthCacheKey(providerId))
  if (cached) return cached

  try {
    let provider: ReturnType<typeof providerService.getByProviderId> | null = null
    try {
      provider = providerService.getByProviderId(providerId)
    } catch {
      provider = null
    }

    if (!provider) return textResult(`Provider not found: ${providerId}`, true)

    const apiHost = providerChatBaseUrl(provider) ?? ''
    const host = redactUrlToOrigin(apiHost)

    // External-CLI providers (e.g. Claude Code) authenticate through the CLI's own login, not an app key.
    if (provider.apiKeys.length === 0 && !isExternalCliProvider(provider)) {
      const result = jsonResult({ providerId, status: 'error', error: 'No API key configured', host })
      cacheService.set(healthCacheKey(providerId), result, HEALTH_CACHE_TTL)
      return result
    }

    // Same layered probe the System Doctor uses; only the origin and the layer verdicts leave here.
    const diagnosis = await application
      .get('NetworkService')
      .diagnoseEndpoint(
        { id: `provider:${providerId}`, url: apiHost },
        AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)])
      )
    const layer = (result: { status: string; kind?: string; code?: string; durationMs: number }) => ({
      status: result.status,
      ...(result.kind ? { kind: result.kind } : {}),
      ...(result.code ? { code: result.code } : {}),
      latencyMs: Math.round(result.durationMs)
    })
    const result = jsonResult({
      providerId,
      status: diagnosis.verdict,
      host,
      dns: layer(diagnosis.dns),
      tls: layer(diagnosis.tls),
      proxy: {
        mode: diagnosis.proxy.configuredMode,
        ...(diagnosis.proxy.mismatch ? { mismatch: diagnosis.proxy.mismatch } : {})
      },
      http: {
        ...layer(diagnosis.http),
        ...(diagnosis.http.status === 'ok' ? { httpStatus: diagnosis.http.data.status } : {})
      }
    })
    cacheService.set(healthCacheKey(providerId), result, HEALTH_CACHE_TTL)
    return result
  } catch (error) {
    return textResult(`Health check failed: ${errorMessage(error)}`, true)
  }
}

/** The System Doctor report in its `upload` projection: nothing local-only reaches the model. */
async function diagnoseDoctor(tier: DoctorRunTier): Promise<CallToolResult> {
  const outcome = await application.get('DoctorService').run({ tier, subject: { kind: 'global' } })
  if (outcome.status !== 'completed') return jsonResult(outcome)
  return jsonResult(projectDoctorReport(outcome.report, 'upload'))
}

function diagnoseLogs(requestedLines?: number): CallToolResult {
  const maxLines = 500
  const lines = Math.min(Math.max(requestedLines || 50, 1), maxLines)

  try {
    const logsDir = application.getPath('app.logs')
    if (!fs.existsSync(logsDir)) return textResult(`Logs directory not found: ${logsDir}`, true)

    // Find the most recent .log file
    const logFiles = fs
      .readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({
        name: f,
        mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime)

    if (logFiles.length === 0) return textResult('No log files found', true)

    const latestLog = logFiles[0]
    const logPath = path.join(logsDir, latestLog.name)
    const content = fs.readFileSync(logPath, 'utf-8')
    const allLines = content.split('\n')
    const tailLines = allLines.slice(-lines).join('\n')

    return textResult(`=== ${latestLog.name} (last ${lines} lines) ===\n${tailLines}`)
  } catch (error) {
    return textResult(`Failed to read logs: ${errorMessage(error)}`, true)
  }
}

function diagnoseErrors(requestedLines?: number): CallToolResult {
  const maxEntries = 200
  const limit = Math.min(Math.max(requestedLines || 50, 1), maxEntries)

  try {
    const logsDir = application.getPath('app.logs')
    if (!fs.existsSync(logsDir)) return textResult('Logs directory not found', true)

    const logFiles = fs
      .readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)

    if (logFiles.length === 0) return textResult('No log files found', true)

    // Scan up to 3 most recent log files for error/warn lines
    const errorLines: string[] = []
    const errorPattern = /\b(ERROR|WARN|error|warn)\b/

    for (const logFile of logFiles.slice(0, 3)) {
      if (errorLines.length >= limit) break
      const content = fs.readFileSync(path.join(logsDir, logFile.name), 'utf-8')
      const lines = content.split('\n')
      for (let i = lines.length - 1; i >= 0 && errorLines.length < limit; i--) {
        if (errorPattern.test(lines[i])) {
          errorLines.push(`[${logFile.name}] ${lines[i]}`)
        }
      }
    }

    if (errorLines.length === 0) return textResult('No ERROR/WARN entries found in recent logs')

    return textResult(`=== ${errorLines.length} error/warn entries ===\n${errorLines.reverse().join('\n')}`)
  } catch (error) {
    return textResult(`Failed to read errors: ${errorMessage(error)}`, true)
  }
}

function diagnoseMcpStatus(): CallToolResult {
  try {
    const { items: mcpServers } = mcpServerService.list({})

    const summary = mcpServers.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type ?? 'stdio',
      isActive: s.isActive,
      command: s.command,
      baseUrl: s.baseUrl ? redactUrlToOrigin(s.baseUrl) : undefined
    }))

    return jsonResult({ serverCount: summary.length, servers: summary })
  } catch (error) {
    return textResult(`Failed to read MCP status: ${errorMessage(error)}`, true)
  }
}

/** Parse a stored UniqueModelId ("provider::modelId") into a diagnostic summary. */
function describeModelId(uniqueId: string | null) {
  if (!uniqueId) return null
  try {
    const { providerId, modelId } = parseUniqueModelId(uniqueId as UniqueModelId)
    return { id: uniqueId, provider: providerId, modelId }
  } catch {
    return { id: uniqueId, provider: '(unparseable)', modelId: '' }
  }
}

async function diagnoseConfig(): Promise<CallToolResult> {
  try {
    const preferenceService = application.get('PreferenceService')

    const proxy = preferenceService.get('app.proxy.url')
    const settings = {
      language: preferenceService.get('app.language'),
      theme: preferenceService.get('ui.theme_mode'),
      proxy: proxy ? redactUrlToOrigin(proxy) : proxy,
      zoomFactor: preferenceService.get('app.zoom_factor'),
      defaultModel: describeModelId(preferenceService.get('chat.default_model_id')),
      quickModel: describeModelId(preferenceService.get('feature.quick_assistant.model_id')),
      tray: preferenceService.get('app.tray.enabled'),
      trayOnClose: preferenceService.get('app.tray.on_close'),
      launchToTray: preferenceService.get('app.tray.on_launch'),
      autoUpdate: preferenceService.get('app.dist.auto_update.enabled'),
      enableQuickAssistant: preferenceService.get('feature.quick_assistant.enabled'),
      selectionAssistantEnabled: preferenceService.get('feature.selection.enabled'),
      enableDeveloperMode: preferenceService.get('app.developer_mode.enabled'),
      disableHardwareAcceleration: preferenceService.get('BootConfig.app.disable_hardware_acceleration'),
      useSystemTitleBar: preferenceService.get('app.use_system_title_bar')
    }

    return jsonResult(settings)
  } catch (error) {
    return textResult(`Failed to read config: ${errorMessage(error)}`, true)
  }
}

function readSource(filePath: string, requestedLines?: number): CallToolResult {
  // Resolve against app root (source repo in dev, app.asar in prod)
  const appRoot = application.getPath('app.root')
  // Realpath-resolve both the app root and the target (or its nearest existing ancestor) so a
  // symlink inside appRoot cannot point outside it and bypass the containment / .env checks.
  const realAppRoot = resolveRealOrNearestExistingPath(appRoot)
  const resolved = resolveRealOrNearestExistingPath(path.resolve(appRoot, filePath))

  // Security: only allow reading within app root and node_modules
  const allowedRoots = [realAppRoot, path.join(realAppRoot, 'node_modules')]
  if (!allowedRoots.some((root) => resolved.startsWith(root + path.sep) || resolved === root)) {
    throw new Error('Access denied: path must be within the app directory')
  }

  // Block sensitive files (dotenv variants, credentials, private keys).
  if (isBlockedSourceFile(path.basename(resolved))) {
    throw new Error('Access denied: cannot read sensitive files')
  }

  if (!fs.existsSync(resolved)) return textResult(`File not found: ${filePath}`, true)

  const stat = fs.statSync(resolved)
  if (stat.isDirectory()) {
    // List directory contents
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    const listing = entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n')
    return textResult(`=== ${filePath} ===\n${listing}`)
  }

  // Limit file size to prevent token explosion (max 200KB)
  if (stat.size > 200 * 1024) {
    return textResult(
      `File too large (${Math.round(stat.size / 1024)}KB). Use lines parameter to read a portion.`,
      true
    )
  }

  try {
    const content = fs.readFileSync(resolved, 'utf-8')
    if (requestedLines && requestedLines > 0) {
      const allLines = content.split('\n')
      const limited = allLines.slice(0, Math.min(requestedLines, 1000)).join('\n')
      return textResult(
        `=== ${filePath} (first ${Math.min(requestedLines, allLines.length)} of ${allLines.length} lines) ===\n${limited}`
      )
    }
    return textResult(`=== ${filePath} ===\n${content}`)
  } catch (error) {
    return textResult(`Failed to read file: ${errorMessage(error)}`, true)
  }
}

const ASSISTANT_TOOLS: Record<AssistantToolName, (server: McpServer, defaultModel?: UniqueModelId) => void> = {
  navigate: (server) =>
    server.registerTool(
      'navigate',
      {
        description:
          'Create a clickable entry for a route returned by product_info. Use this in the same turn whenever answering where to find, open, configure, or use a Cherry Studio page or feature; written UI steps are not a substitute.',
        inputSchema: NavigateInputSchema
      },
      async (args) => navigate(args)
    ),
  diagnose: (server) =>
    server.registerTool(
      'diagnose',
      {
        description:
          'Read Cherry Studio runtime state for troubleshooting. Use this to inspect app info, provider config, connectivity, logs, and MCP server status.',
        inputSchema: DiagnoseInputSchema
      },
      async (args, ctx) => diagnose(args, ctx.mcpReq.signal)
    ),
  product_info: (server) =>
    server.registerTool(
      'product_info',
      {
        description:
          'Read current Cherry Studio product facts from the installed package manifest. Request only the relevant section to keep context small.',
        inputSchema: ProductInfoInputSchema
      },
      async (args) => productInfo(args)
    ),
  apply_setting: (server) =>
    server.registerTool(
      'apply_setting',
      {
        description: `Apply a low-risk Cherry Studio setting change directly. Only the whitelist below is supported; destructive operations are never exposed here.

Supported settings:
${Object.values(APPLY_SETTING_REGISTRY)
  .map((entry) => `- ${entry.hint}`)
  .join('\n')}`,
        inputSchema: ApplySettingInputSchema
      },
      async (args) => applySetting(args)
    ),
  create_agent: (server, defaultModel) =>
    server.registerTool(
      'create_agent',
      {
        description: `Create a new Cherry Studio Agent on behalf of the user. Use this when the user explicitly asks to create / build / make a new agent (e.g. "帮我建一个专门做 Python 代码 review 的 Agent"). MUST collect requirements via conversation first, then SHOW the proposed config to the user for confirmation, and only call this tool after explicit user agreement.

Safety rules:
- type is fixed to 'claude-code' (channel-backed agents are out of scope here)
- a workspace is selected when the user opens a session for the new agent
- permission_mode defaults to 'default' (read-mostly); user can change later in the UI

The tool returns the new agent details, and Cherry Studio presents a Go to chat action. Do not call navigate after a successful creation.`,
        inputSchema: CreateAgentInputSchema,
        outputSchema: CreateAgentOutputSchema
      },
      async (args) => createAgent(args, defaultModel)
    ),
  prepare_diagnostic_report: (server) =>
    server.registerTool(
      'prepare_diagnostic_report',
      {
        description:
          'Prepare an editable diagnostic report description for Cherry Studio to present as a user-clickable review action. This tool only prepares draft data; it DOES NOT open UI, acknowledge user consent, collect diagnostics, write files, or submit a report.',
        inputSchema: PrepareDiagnosticReportInputSchema,
        outputSchema: PrepareDiagnosticReportOutputSchema
      },
      async (args) => prepareDiagnosticReport(args)
    )
}

export function createAssistantServer(
  defaultModel?: UniqueModelId,
  enabledToolNames: readonly AssistantToolName[] = DEFAULT_ASSISTANT_TOOL_NAMES
): McpServer {
  const server = new McpServer({ name: 'assistant', version: '1.0.0' })
  for (const name of new Set(enabledToolNames)) ASSISTANT_TOOLS[name](server, defaultModel)
  return server
}

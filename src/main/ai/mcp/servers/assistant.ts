import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { redactUrlToOrigin } from '@main/utils/redactUrl'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { ErrorCode as DataApiErrorCode, isDataApiError } from '@shared/data/api/errors'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { app } from 'electron'

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

export function isAllowedAssistantNavigationPath(path: string, allowedRoutes: readonly string[]): boolean {
  const pathSegments = getNavigationPathSegments(path)
  if (!pathSegments) return false

  return allowedRoutes.some((route) => {
    const routeSegments = getNavigationPathSegments(route)
    if (!routeSegments) return false

    for (let index = 0; index < routeSegments.length; index++) {
      const routeSegment = routeSegments[index]
      if (routeSegment === '$') {
        return index === routeSegments.length - 1 && pathSegments.length > index
      }
      if (routeSegment.startsWith('$')) {
        if (!pathSegments[index]) return false
        continue
      }
      if (pathSegments[index] !== routeSegment) return false
    }

    return pathSegments.length === routeSegments.length
  })
}

function getNavigationPathSegments(value: string): string[] | undefined {
  if (!value.startsWith('/') || value.includes('?') || value.includes('#') || value.includes('\\')) return undefined

  const segments = value.slice(1).split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return undefined
  return segments
}

const NAVIGATE_TOOL: Tool = {
  name: 'navigate',
  description: 'Create a clickable link to a route returned by product_info for the current Cherry Studio package.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'A current package route returned by product_info.'
      },
      query: {
        type: 'object',
        description: 'Optional URL query parameters, e.g. { "id": "anthropic" }',
        additionalProperties: { type: 'string' }
      }
    },
    required: ['path']
  }
}

const DIAGNOSE_TOOL: Tool = {
  name: 'diagnose',
  description:
    'Read Cherry Studio runtime state for troubleshooting. Use this to inspect app info, provider config, connectivity, logs, and MCP server status.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['info', 'providers', 'health', 'logs', 'errors', 'mcp_status', 'read_source', 'config'],
        description:
          'info: app version/paths/system. providers: list configured providers. health: test provider connectivity (cached 30s). logs: read recent log entries. errors: extract only ERROR/WARN entries from logs. mcp_status: check MCP server states. read_source: read a source file (read-only). config: read user settings (theme, language, proxy, default model, etc).'
      },
      provider_id: {
        type: 'string',
        description: 'Provider ID for the health action'
      },
      lines: {
        type: 'number',
        description: 'Number of log lines to return (default 50, max 500)'
      },
      file_path: {
        type: 'string',
        description: 'Relative file path for read_source action, e.g. src/main/ai/mcp/McpRuntimeService.ts'
      }
    },
    required: ['action']
  }
}

const PRODUCT_INFO_TOOL: Tool = {
  name: 'product_info',
  description:
    'Read current Cherry Studio product facts from the installed package manifest. Request only the relevant section to keep context small.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['manifest'],
        description: 'Current installed package facts.'
      },
      section: {
        type: 'string',
        description:
          'Optional for manifest. Use a section name returned by the compact manifest index (for example routes, commands, providers, locales, or agents). Use all only when several sections are genuinely needed.'
      }
    },
    required: ['source'],
    additionalProperties: false
  }
}

// Whitelist of settings Cherry Assistant can write directly. Each entry binds
// a `setting` key to a value validator and an `apply` function that performs
// the write. Settings not in this map are rejected — adding a new one
// requires explicit code change so a destructive or sensitive setting can
// never be flipped via prompt injection.
//
// All booleans are passed as the string 'true' / 'false' (MCP tool inputs
// are JSON Schema strings); the handler parses them. Returns the message
// shown back to the agent (and through it, the user).
interface ApplySettingEntry {
  allowed: readonly string[]
  apply: (value: string) => Promise<string> | string
  /** Human-readable hint shown in the tool description. */
  hint: string
}

// Only settings whose change is observable to the user without an app restart
// are listed here. Restart-required or background-only persisted toggles were
// audited and deliberately excluded — see Cherry Assistant PR for the matrix.
const APPLY_SETTING_REGISTRY: Record<string, ApplySettingEntry> = {
  theme: {
    allowed: [ThemeMode.light, ThemeMode.dark, ThemeMode.system],
    hint: 'theme: light | dark | system',
    apply: async (value) => {
      await application.get('PreferenceService').set('ui.theme_mode', value as ThemeMode)
      return `Theme switched to ${value}.`
    }
  }
}

const CREATE_AGENT_TOOL: Tool = {
  name: 'create_agent',
  description: `Create a new Cherry Studio Agent on behalf of the user. Use this when the user explicitly asks to create / build / make a new agent (e.g. "帮我建一个专门做 Python 代码 review 的 Agent"). MUST collect requirements via conversation first, then SHOW the proposed config to the user for confirmation, and only call this tool after explicit user agreement.

Safety rules:
- type is fixed to 'claude-code' (channel-backed agents are out of scope here)
- a workspace is selected when the user opens a session for the new agent
- permission_mode defaults to 'default' (read-mostly); user can change later in the UI

The tool returns the new agent id. After creation, query product_info and navigate to the current package's Agents route.`,
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short human-readable name (e.g. "Python Reviewer", "周报助手"). Required.'
      },
      description: {
        type: 'string',
        description: 'One-line description shown in the agent list. Optional but recommended.'
      },
      instructions: {
        type: 'string',
        description:
          "The agent's system prompt — role, behavior, output format. Required. Write it in the user's preferred language. Keep concise (under ~300 lines)."
      },
      model: {
        type: 'string',
        description:
          'Optional model id in the form "providerId::modelId" (e.g. "cherryin::agent/glm-5.1", "anthropic::claude-sonnet"). When omitted, the new agent uses Cherry Assistant\'s current model.'
      }
    },
    required: ['name', 'instructions']
  }
}

const APPLY_SETTING_TOOL: Tool = {
  name: 'apply_setting',
  description: `Apply a low-risk Cherry Studio setting change directly. Only the whitelist below is supported; destructive operations are never exposed here.

Supported settings:
${Object.values(APPLY_SETTING_REGISTRY)
  .map((entry) => `- ${entry.hint}`)
  .join('\n')}`,
  inputSchema: {
    type: 'object',
    properties: {
      setting: {
        type: 'string',
        enum: Object.keys(APPLY_SETTING_REGISTRY),
        description: 'Which setting to change.'
      },
      value: {
        type: 'string',
        description: 'New value. For booleans use the literal string "true" or "false".'
      }
    },
    required: ['setting', 'value']
  }
}

// Health check cache: { providerId -> { result, timestamp } }
const healthCache = new Map<string, { result: unknown; timestamp: number }>()
const HEALTH_CACHE_TTL = 30_000 // 30 seconds

class AssistantServer {
  public mcpServer: McpServer

  constructor(private readonly defaultModel?: UniqueModelId) {
    this.mcpServer = new McpServer(
      {
        name: 'assistant',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [NAVIGATE_TOOL, DIAGNOSE_TOOL, PRODUCT_INFO_TOOL, APPLY_SETTING_TOOL, CREATE_AGENT_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = request.params.arguments ?? {}

      try {
        switch (toolName) {
          case 'navigate':
            return await this.navigate(args as Record<string, string | Record<string, string> | undefined>)
          case 'diagnose':
            return await this.diagnose(args)
          case 'product_info':
            return await this.productInfo(args)
          case 'apply_setting':
            return await this.applySetting(args as Record<string, string | undefined>)
          case 'create_agent':
            return await this.createAgent(args as Record<string, string | undefined>)
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private readProductManifest(): Record<string, unknown> {
    const manifestPath = application.getPath('feature.agents.assistant.manifest.file')
    let rawManifest: string
    try {
      rawManifest = fs.readFileSync(manifestPath, 'utf-8')
    } catch {
      throw new McpError(ErrorCode.InternalError, 'Product manifest is unavailable')
    }

    let manifest: unknown
    try {
      manifest = JSON.parse(rawManifest)
    } catch {
      throw new McpError(ErrorCode.InternalError, 'Product manifest contains invalid JSON')
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
      throw new McpError(ErrorCode.InternalError, 'Product manifest schema is invalid')
    }
    return manifestRecord
  }

  private getManifestNavigationRoutes(manifest: Record<string, unknown>): string[] {
    const routes = manifest.routes
    if (typeof routes !== 'object' || routes === null || Array.isArray(routes)) {
      throw new McpError(ErrorCode.InternalError, 'Product manifest routes are invalid')
    }
    const allRoutes = (routes as Record<string, unknown>).all
    if (!Array.isArray(allRoutes)) {
      throw new McpError(ErrorCode.InternalError, 'Product manifest routes are invalid')
    }

    return allRoutes.filter(
      (route): route is string =>
        typeof route === 'string' &&
        (route === '/settings' || route.startsWith('/settings/') || route.startsWith('/app/'))
    )
  }

  private async productInfo(args: Record<string, unknown>) {
    const unsupportedArgument = Object.keys(args).find((key) => key !== 'source' && key !== 'section')
    if (unsupportedArgument) {
      throw new McpError(ErrorCode.InvalidParams, `Unsupported product_info argument: ${unsupportedArgument}`)
    }

    if (args.source !== 'manifest') {
      throw new McpError(ErrorCode.InvalidParams, `Unknown product_info source: ${String(args.source)}`)
    }

    const manifest = this.readProductManifest()
    const packageRecord = manifest.package as Record<string, unknown>
    const manifestVersion = packageRecord.version as string
    const section = args.section
    if (section !== undefined && (typeof section !== 'string' || section.trim().length === 0)) {
      throw new McpError(ErrorCode.InvalidParams, "'section' must be a non-empty string")
    }

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
      throw new McpError(ErrorCode.InvalidParams, `Unknown product manifest section: ${section}`)
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }]
    }
  }

  private async navigate(args: Record<string, string | Record<string, string> | undefined>) {
    const targetPath = args.path as string | undefined
    if (!targetPath) throw new McpError(ErrorCode.InvalidParams, "'path' is required for navigate")

    const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`

    const allowedRoutes = this.getManifestNavigationRoutes(this.readProductManifest())
    if (!isAllowedAssistantNavigationPath(normalizedPath, allowedRoutes)) {
      throw new McpError(ErrorCode.InvalidParams, `Blocked navigation to disallowed route: ${normalizedPath}`)
    }

    // Serialize query params if provided
    const queryObj = args.query as Record<string, string> | undefined
    let fullPath = normalizedPath
    if (queryObj && typeof queryObj === 'object') {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(queryObj)) {
        if (typeof value === 'string') {
          params.set(key, value)
        }
      }
      const qs = params.toString()
      if (qs) {
        fullPath = `${normalizedPath}?${qs}`
      }
    }

    // Don't actually navigate here — the renderer will show a clickable button
    // that the user can click to navigate. This keeps the tool non-blocking.
    logger.info('Navigate tool called (deferred to user click)', { path: fullPath })
    return {
      content: [{ type: 'text' as const, text: `Navigate link created: ${fullPath}` }]
    }
  }

  private async applySetting(args: Record<string, string | undefined>) {
    const setting = args.setting
    const value = args.value
    if (!setting) throw new McpError(ErrorCode.InvalidParams, "'setting' is required for apply_setting")
    if (!value) throw new McpError(ErrorCode.InvalidParams, "'value' is required for apply_setting")

    const entry = APPLY_SETTING_REGISTRY[setting]
    if (!entry) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Setting '${setting}' is not on the apply_setting whitelist. Allowed: ${Object.keys(APPLY_SETTING_REGISTRY).join(', ')}`
      )
    }
    if (!entry.allowed.includes(value)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Value '${value}' is not valid for setting '${setting}'. Allowed: ${entry.allowed.join(', ')}`
      )
    }

    const message = await entry.apply(value)
    logger.info('apply_setting succeeded', { setting, value })
    return {
      content: [{ type: 'text' as const, text: message }]
    }
  }

  private async createAgent(args: Record<string, string | undefined>) {
    const name = args.name?.trim()
    const instructions = args.instructions?.trim()
    const model = args.model?.trim() || this.defaultModel
    const description = args.description?.trim() || undefined

    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for create_agent")
    if (!instructions) throw new McpError(ErrorCode.InvalidParams, "'instructions' is required for create_agent")
    if (!model) {
      throw new McpError(ErrorCode.InvalidParams, "'model' is required when no default model is configured")
    }

    const parsedModel = UniqueModelIdSchema.safeParse(model)
    if (!parsedModel.success) {
      throw new McpError(ErrorCode.InvalidParams, `'model' must be in the form "providerId::modelId" (got "${model}")`)
    }

    const { providerId, modelId } = parseUniqueModelId(parsedModel.data)
    try {
      modelService.getByKey(providerId, modelId)
    } catch (error) {
      if (isDataApiError(error) && error.code === DataApiErrorCode.NOT_FOUND) {
        throw new McpError(ErrorCode.InvalidParams, `Model is not configured in Cherry Studio: ${parsedModel.data}`)
      }
      throw error
    }

    try {
      const result = agentService.createAgent({
        type: 'claude-code',
        name,
        description,
        instructions,
        model: parsedModel.data,
        configuration: {
          permission_mode: 'default',
          max_turns: 100,
          env_vars: {}
        }
      })
      logger.info('create_agent succeeded', { agentId: result.id, name })
      return {
        content: [
          {
            type: 'text' as const,
            text: `Agent created. id=${result.id}, name=${result.name}, model=${result.model}. Query product_info for the current Agents route, then use navigate to open it.`
          }
        ]
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logger.error('create_agent failed', { error: msg, name })
      throw new McpError(ErrorCode.InternalError, `Failed to create agent: ${msg}`)
    }
  }

  private async diagnose(args: Record<string, unknown>) {
    const action = args.action as string
    if (!action) throw new McpError(ErrorCode.InvalidParams, "'action' is required for diagnose")

    switch (action) {
      case 'info':
        return this.diagnoseInfo()
      case 'providers':
        return this.diagnoseProviders()
      case 'health':
        return await this.diagnoseHealth(args.provider_id as string | undefined)
      case 'logs':
        return this.diagnoseLogs(args.lines as number | undefined)
      case 'errors':
        return this.diagnoseErrors(args.lines as number | undefined)
      case 'mcp_status':
        return this.diagnoseMcpStatus()
      case 'read_source':
        return this.readSource(args.file_path as string | undefined, args.lines as number | undefined)
      case 'config':
        return await this.diagnoseConfig()
      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown diagnose action: ${action}`)
    }
  }

  private diagnoseInfo() {
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

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(info, null, 2) }]
    }
  }

  private diagnoseProviders() {
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

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ providerCount: summary.length, providers: summary }, null, 2)
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read provider config: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private async diagnoseHealth(providerId?: string) {
    if (!providerId) {
      throw new McpError(ErrorCode.InvalidParams, "'provider_id' is required for health action")
    }

    // Check cache first (30s TTL)
    const cached = healthCache.get(providerId)
    if (cached && Date.now() - cached.timestamp < HEALTH_CACHE_TTL) {
      return cached.result as ReturnType<typeof this.diagnoseHealth>
    }

    try {
      let provider: ReturnType<typeof providerService.getByProviderId> | null = null
      try {
        provider = providerService.getByProviderId(providerId)
      } catch {
        provider = null
      }

      if (!provider) {
        return {
          content: [{ type: 'text' as const, text: `Provider not found: ${providerId}` }],
          isError: true
        }
      }

      const endpointConfigs = provider.endpointConfigs ?? {}
      const apiHost =
        (provider.defaultChatEndpoint && endpointConfigs[provider.defaultChatEndpoint]?.baseUrl) ||
        Object.values(endpointConfigs)[0]?.baseUrl ||
        ''

      if (provider.apiKeys.length === 0) {
        const result = {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  providerId,
                  status: 'error',
                  error: 'No API key configured'
                },
                null,
                2
              )
            }
          ]
        }
        healthCache.set(providerId, { result, timestamp: Date.now() })
        return result
      }

      // Simple connectivity test — try to reach the API host
      const startTime = Date.now()
      const host = redactUrlToOrigin(apiHost)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const testUrl = apiHost.startsWith('http') ? apiHost : `https://${apiHost}`
        const controller = new AbortController()
        timeout = setTimeout(() => controller.abort(), 10000)
        const response = await fetch(testUrl, {
          method: 'HEAD',
          signal: controller.signal
        })
        const latency = Date.now() - startTime

        const result = {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  providerId,
                  status: response.ok || response.status === 401 || response.status === 403 ? 'reachable' : 'error',
                  httpStatus: response.status,
                  latencyMs: latency,
                  host
                },
                null,
                2
              )
            }
          ]
        }
        healthCache.set(providerId, { result, timestamp: Date.now() })
        return result
      } catch (fetchError) {
        const latency = Date.now() - startTime
        const result = {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  providerId,
                  status: 'unreachable',
                  error:
                    fetchError instanceof Error && fetchError.name === 'AbortError' ? 'timeout' : 'connection failure',
                  latencyMs: latency,
                  host
                },
                null,
                2
              )
            }
          ]
        }
        healthCache.set(providerId, { result, timestamp: Date.now() })
        return result
      } finally {
        if (timeout !== undefined) clearTimeout(timeout)
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Health check failed: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private diagnoseLogs(requestedLines?: number) {
    const maxLines = 500
    const lines = Math.min(Math.max(requestedLines || 50, 1), maxLines)

    try {
      const logsDir = application.getPath('app.logs')
      if (!fs.existsSync(logsDir)) {
        return {
          content: [{ type: 'text' as const, text: `Logs directory not found: ${logsDir}` }],
          isError: true
        }
      }

      // Find the most recent .log file
      const logFiles = fs
        .readdirSync(logsDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => ({
          name: f,
          mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime)

      if (logFiles.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No log files found' }],
          isError: true
        }
      }

      const latestLog = logFiles[0]
      const logPath = path.join(logsDir, latestLog.name)
      const content = fs.readFileSync(logPath, 'utf-8')
      const allLines = content.split('\n')
      const tailLines = allLines.slice(-lines).join('\n')

      return {
        content: [
          {
            type: 'text' as const,
            text: `=== ${latestLog.name} (last ${lines} lines) ===\n${tailLines}`
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read logs: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private diagnoseErrors(requestedLines?: number) {
    const maxEntries = 200
    const limit = Math.min(Math.max(requestedLines || 50, 1), maxEntries)

    try {
      const logsDir = application.getPath('app.logs')
      if (!fs.existsSync(logsDir)) {
        return { content: [{ type: 'text' as const, text: 'Logs directory not found' }], isError: true }
      }

      const logFiles = fs
        .readdirSync(logsDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime)

      if (logFiles.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No log files found' }], isError: true }
      }

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

      if (errorLines.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No ERROR/WARN entries found in recent logs' }] }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `=== ${errorLines.length} error/warn entries ===\n${errorLines.reverse().join('\n')}`
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read errors: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private diagnoseMcpStatus() {
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

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ serverCount: summary.length, servers: summary }, null, 2)
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read MCP status: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  /** Parse a stored UniqueModelId ("provider::modelId") into a diagnostic summary. */
  private describeModelId(uniqueId: string | null) {
    if (!uniqueId) return null
    try {
      const { providerId, modelId } = parseUniqueModelId(uniqueId as UniqueModelId)
      return { id: uniqueId, provider: providerId, modelId }
    } catch {
      return { id: uniqueId, provider: '(unparseable)', modelId: '' }
    }
  }

  private async diagnoseConfig() {
    try {
      const preferenceService = application.get('PreferenceService')

      const proxy = preferenceService.get('app.proxy.url')
      const settings = {
        language: preferenceService.get('app.language'),
        theme: preferenceService.get('ui.theme_mode'),
        proxy: proxy ? redactUrlToOrigin(proxy) : proxy,
        zoomFactor: preferenceService.get('app.zoom_factor'),
        defaultModel: this.describeModelId(preferenceService.get('chat.default_model_id')),
        topicNamingModel: this.describeModelId(preferenceService.get('topic.naming.model_id')),
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

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(settings, null, 2)
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read config: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }

  private readSource(filePath?: string, requestedLines?: number) {
    if (!filePath) {
      throw new McpError(ErrorCode.InvalidParams, "'file_path' is required for read_source action")
    }

    // Resolve against app root (source repo in dev, app.asar in prod)
    const appRoot = app.getAppPath()
    // Realpath-resolve both the app root and the target (or its nearest existing ancestor) so a
    // symlink inside appRoot cannot point outside it and bypass the containment / .env checks.
    const realAppRoot = resolveRealOrNearestExistingPath(appRoot)
    const resolved = resolveRealOrNearestExistingPath(path.resolve(appRoot, filePath))

    // Security: only allow reading within app root and node_modules
    const allowedRoots = [realAppRoot, path.join(realAppRoot, 'node_modules')]
    if (!allowedRoots.some((root) => resolved.startsWith(root + path.sep) || resolved === root)) {
      throw new McpError(ErrorCode.InvalidParams, `Access denied: path must be within the app directory`)
    }

    // Block sensitive files (dotenv variants, credentials, private keys).
    if (isBlockedSourceFile(path.basename(resolved))) {
      throw new McpError(ErrorCode.InvalidParams, `Access denied: cannot read sensitive files`)
    }

    if (!fs.existsSync(resolved)) {
      return {
        content: [{ type: 'text' as const, text: `File not found: ${filePath}` }],
        isError: true
      }
    }

    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      // List directory contents
      const entries = fs.readdirSync(resolved, { withFileTypes: true })
      const listing = entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`).join('\n')
      return {
        content: [{ type: 'text' as const, text: `=== ${filePath} ===\n${listing}` }]
      }
    }

    // Limit file size to prevent token explosion (max 200KB)
    if (stat.size > 200 * 1024) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `File too large (${Math.round(stat.size / 1024)}KB). Use lines parameter to read a portion.`
          }
        ],
        isError: true
      }
    }

    try {
      const content = fs.readFileSync(resolved, 'utf-8')
      if (requestedLines && requestedLines > 0) {
        const allLines = content.split('\n')
        const limited = allLines.slice(0, Math.min(requestedLines, 1000)).join('\n')
        return {
          content: [
            {
              type: 'text' as const,
              text: `=== ${filePath} (first ${Math.min(requestedLines, allLines.length)} of ${allLines.length} lines) ===\n${limited}`
            }
          ]
        }
      }
      return {
        content: [{ type: 'text' as const, text: `=== ${filePath} ===\n${content}` }]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`
          }
        ],
        isError: true
      }
    }
  }
}

export default AssistantServer

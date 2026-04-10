import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import { app } from 'electron'

const logger = loggerService.withContext('MCPServer:Assistant')

// Allowed route prefixes to prevent arbitrary navigation
const ALLOWED_ROUTES = [
  '/settings/',
  '/agents',
  '/knowledge',
  '/openclaw',
  '/paintings',
  '/translate',
  '/files',
  '/notes',
  '/apps',
  '/code',
  '/store',
  '/launchpad',
  '/'
]

const NAVIGATE_TOOL: Tool = {
  name: 'navigate',
  description:
    'Navigate Cherry Studio to a specific page. Refer to the route table in your skills for available paths.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The route path to navigate to, e.g. /settings/provider, /settings/mcp/servers'
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
        enum: ['info', 'providers', 'health', 'logs', 'errors', 'mcp_status', 'read_source', 'config', 'check_update'],
        description:
          'info: app version/paths/system. providers: list configured providers. health: test provider connectivity (cached 30s). logs: read recent log entries. errors: extract only ERROR/WARN entries from logs. mcp_status: check MCP server states. read_source: read a source file (read-only). config: read user settings (theme, language, proxy, default model, etc). check_update: compare current version with latest GitHub release.'
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
        description: 'Relative file path for read_source action, e.g. src/main/services/MCPService.ts'
      }
    },
    required: ['action']
  }
}

// Health check cache: { providerId -> { result, timestamp } }
const healthCache = new Map<string, { result: unknown; timestamp: number }>()
const HEALTH_CACHE_TTL = 30_000 // 30 seconds

class AssistantServer {
  public mcpServer: McpServer

  constructor() {
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
      tools: [NAVIGATE_TOOL, DIAGNOSE_TOOL]
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

  private async navigate(args: Record<string, string | Record<string, string> | undefined>) {
    const targetPath = args.path as string | undefined
    if (!targetPath) throw new McpError(ErrorCode.InvalidParams, "'path' is required for navigate")

    const normalizedPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`

    if (!ALLOWED_ROUTES.some((route) => normalizedPath === route || normalizedPath.startsWith(route))) {
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

  private async diagnose(args: Record<string, unknown>) {
    const action = args.action as string
    if (!action) throw new McpError(ErrorCode.InvalidParams, "'action' is required for diagnose")

    switch (action) {
      case 'info':
        return this.diagnoseInfo()
      case 'providers':
        return await this.diagnoseProviders()
      case 'health':
        return await this.diagnoseHealth(args.provider_id as string | undefined)
      case 'logs':
        return this.diagnoseLogs(args.lines as number | undefined)
      case 'errors':
        return this.diagnoseErrors(args.lines as number | undefined)
      case 'mcp_status':
        return await this.diagnoseMcpStatus()
      case 'read_source':
        return this.readSource(args.file_path as string | undefined, args.lines as number | undefined)
      case 'config':
        return await this.diagnoseConfig()
      case 'check_update':
        return await this.checkUpdate()
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
        userData: app.getPath('userData'),
        logs: app.getPath('logs'),
        temp: app.getPath('temp')
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

  private async diagnoseProviders() {
    try {
      const { configManager } = await import('@main/services/ConfigManager')
      const providers = configManager.get<unknown[]>('providers', [])

      const summary = (providers as Record<string, unknown>[]).map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        apiHost: p.apiHost || p.anthropicApiHost || '(default)',
        hasApiKey: !!(p.apiKey && typeof p.apiKey === 'string' && p.apiKey.length > 0),
        enabled: p.enabled !== false,
        modelCount: Array.isArray(p.models) ? p.models.length : 0
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
      const { configManager } = await import('@main/services/ConfigManager')
      const providers = configManager.get<unknown[]>('providers', []) as Record<string, unknown>[]
      const provider = providers.find((p) => p.id === providerId)

      if (!provider) {
        return {
          content: [{ type: 'text' as const, text: `Provider not found: ${providerId}` }],
          isError: true
        }
      }

      const apiKey = provider.apiKey as string | undefined
      const apiHost = (provider.apiHost || provider.anthropicApiHost || '') as string

      if (!apiKey) {
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
      try {
        const testUrl = apiHost.startsWith('http') ? apiHost : `https://${apiHost}`
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const response = await fetch(testUrl, {
          method: 'HEAD',
          signal: controller.signal
        })
        clearTimeout(timeout)
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
                  host: testUrl
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
                  error: fetchError instanceof Error ? fetchError.message : String(fetchError),
                  latencyMs: latency,
                  host: apiHost || '(no host configured)'
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
      const logsDir = app.getPath('logs')
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
      const logsDir = app.getPath('logs')
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

  private async diagnoseMcpStatus() {
    try {
      const { configManager } = await import('@main/services/ConfigManager')
      const mcpServers = configManager.get<unknown[]>('mcpServers', []) as Record<string, unknown>[]

      const summary = mcpServers.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type || 'stdio',
        isActive: s.isActive ?? false,
        command: s.command,
        baseUrl: s.baseUrl
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

  private async diagnoseConfig() {
    try {
      const { configManager } = await import('@main/services/ConfigManager')

      // Default model info
      const defaultModel = configManager.get<Record<string, unknown>>('defaultModel', {})
      const topicNamingModel = configManager.get<Record<string, unknown>>('topicNamingModel', {})

      const settings = {
        language: configManager.getLanguage(),
        theme: configManager.getTheme(),
        proxy: configManager.get<string>('proxy', ''),
        zoomFactor: configManager.getZoomFactor(),
        defaultModel: defaultModel
          ? { id: defaultModel.id, name: defaultModel.name, provider: defaultModel.provider }
          : null,
        topicNamingModel: topicNamingModel ? { id: topicNamingModel.id, name: topicNamingModel.name } : null,
        tray: configManager.getTray(),
        trayOnClose: configManager.getTrayOnClose(),
        launchToTray: configManager.getLaunchToTray(),
        autoUpdate: configManager.getAutoUpdate(),
        enableQuickAssistant: configManager.getEnableQuickAssistant(),
        selectionAssistantEnabled: configManager.getSelectionAssistantEnabled(),
        enableDeveloperMode: configManager.getEnableDeveloperMode(),
        disableHardwareAcceleration: configManager.getDisableHardwareAcceleration(),
        useSystemTitleBar: configManager.getUseSystemTitleBar()
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

  private async checkUpdate() {
    try {
      const currentVersion = app.getVersion()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = await fetch('https://api.github.com/repos/CherryHQ/cherry-studio/releases/latest', {
        method: 'GET',
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'CherryStudio' },
        signal: controller.signal
      })
      clearTimeout(timeout)

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ currentVersion, error: `GitHub API returned ${response.status}` }, null, 2)
            }
          ]
        }
      }

      const data = (await response.json()) as { tag_name: string; name: string; html_url: string; published_at: string }
      const latestVersion = data.tag_name.replace(/^v/, '')

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                currentVersion,
                latestVersion,
                isUpToDate: currentVersion === latestVersion,
                releaseName: data.name,
                releaseUrl: data.html_url,
                publishedAt: data.published_at
              },
              null,
              2
            )
          }
        ]
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                currentVersion: app.getVersion(),
                error: error instanceof Error ? error.message : String(error),
                hint: 'GitHub may be unreachable. Check network connectivity.'
              },
              null,
              2
            )
          }
        ]
      }
    }
  }

  private readSource(filePath?: string, requestedLines?: number) {
    if (!filePath) {
      throw new McpError(ErrorCode.InvalidParams, "'file_path' is required for read_source action")
    }

    // Resolve against app root (source repo in dev, app.asar in prod)
    const appRoot = app.getAppPath()
    const resolved = path.resolve(appRoot, filePath)

    // Security: only allow reading within app root and node_modules
    const allowedRoots = [appRoot, path.join(appRoot, 'node_modules')]
    if (!allowedRoots.some((root) => resolved.startsWith(root + path.sep) || resolved === root)) {
      throw new McpError(ErrorCode.InvalidParams, `Access denied: path must be within the app directory`)
    }

    // Block sensitive files
    const basename = path.basename(resolved).toLowerCase()
    if (basename === '.env' || basename.endsWith('.env.local') || basename === 'credentials.json') {
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

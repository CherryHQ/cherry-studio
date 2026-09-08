/**
 * Builtin (preset) MCP server definitions
 *
 * Single source of truth for user-installable built-in MCP servers.
 *
 * Note: The `hub` server (@cherry/hub) is intentionally excluded because:
 * - It's a meta-server that aggregates all other MCP servers
 * - It's designed for LLM code mode, not direct user interaction
 * - It should be auto-enabled internally when needed, not manually installed
 */
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServerType } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames } from '@shared/utils/mcp'

/** A builtin server as declared in code; database identity and timestamps are assigned on install. */
export type McpServerPreset = Readonly<
  Omit<CreateMcpServerDto, 'name' | 'sortOrder' | 'installedAt' | 'trustedAt'> & {
    name: BuiltinMcpServerName
    type: McpServerType
    installSource: 'builtin'
    isTrusted: true
  }
>

/** Frozen because renderer consumers read these objects live. */
const freezePresets = (presets: McpServerPreset[]): readonly Readonly<McpServerPreset>[] =>
  Object.freeze(
    presets.map((preset) => {
      if (preset.env) Object.freeze(preset.env)
      if (preset.headers) Object.freeze(preset.headers)
      if (preset.args) Object.freeze(preset.args)
      return Object.freeze(preset)
    })
  )

const filesystemManualApprovalTools = ['write', 'edit', 'delete'] as const

export const PRESET_MCP_SERVERS = freezePresets([
  {
    name: BuiltinMcpServerNames.flomo,
    reference: 'https://flomoapp.com',
    type: 'streamableHttp',
    baseUrl: 'https://flomoapp.com/mcp',
    headers: { APP: 'Cherry Studio' },
    isActive: false,
    provider: 'flomo',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.qveris,
    reference: 'https://qveris.ai/docs/mcp-server',
    type: 'streamableHttp',
    baseUrl: 'https://mcp.qveris.ai/mcp',
    headers: { APP: 'Cherry Studio' },
    isActive: false,
    env: {
      QVERIS_API_KEY: ''
    },
    shouldConfig: true,
    provider: 'QVeris',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.mcpAutoInstall,
    reference: 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.memory,
    reference: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    type: 'inProcess',
    isActive: true,
    env: {
      MEMORY_FILE_PATH: 'YOUR_MEMORY_FILE_PATH'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.sequentialThinking,
    type: 'inProcess',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.braveSearch,
    type: 'inProcess',
    isActive: false,
    env: {
      BRAVE_API_KEY: 'YOUR_API_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.fetch,
    type: 'inProcess',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.filesystem,
    type: 'inProcess',
    args: ['/Users/username/Desktop'],
    disabledAutoApproveTools: [...filesystemManualApprovalTools],
    shouldConfig: true,
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.difyKnowledge,
    type: 'inProcess',
    isActive: false,
    env: {
      DIFY_KEY: 'YOUR_DIFY_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.python,
    type: 'inProcess',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.didiMcp,
    reference: 'https://mcp.didichuxing.com/',
    type: 'inProcess',
    isActive: false,
    env: {
      DIDI_API_KEY: 'YOUR_DIDI_API_KEY'
    },
    shouldConfig: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.browser,
    type: 'inProcess',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.nowledgeMem,
    reference: 'https://mem.nowledge.co/',
    type: 'streamableHttp',
    baseUrl: 'http://127.0.0.1:14242/mcp',
    headers: { APP: 'Cherry Studio' },
    isActive: false,
    provider: 'Nowledge',
    installSource: 'builtin',
    isTrusted: true
  }
])

const MCP_SERVER_PRESET_BY_NAME: ReadonlyMap<BuiltinMcpServerName, Readonly<McpServerPreset>> = new Map(
  PRESET_MCP_SERVERS.map((preset) => [preset.name, preset])
)

export const getMcpServerPreset = (name: unknown): Readonly<McpServerPreset> | undefined => {
  return typeof name === 'string' ? MCP_SERVER_PRESET_BY_NAME.get(name as BuiltinMcpServerName) : undefined
}

export interface McpServerConnectionDraft {
  name?: unknown
  type?: unknown
  baseUrl?: unknown
  command?: unknown
  installSource?: unknown
}

export interface McpServerConnectionResolution {
  type: McpServerType | null
  preset?: Readonly<McpServerPreset>
  disable: boolean
  warning?: string
}

/** Normalizes v1 connection labels without admitting `inMemory` into the v2 entity model. */
export function resolveMcpServerConnection(draft: McpServerConnectionDraft): McpServerConnectionResolution {
  const preset = getMcpServerPreset(draft.name)
  const type = typeof draft.type === 'string' ? draft.type : undefined
  const hasCommand = typeof draft.command === 'string' && draft.command.trim().length > 0
  const hasBaseUrl = typeof draft.baseUrl === 'string' && draft.baseUrl.trim().length > 0

  if (
    preset &&
    (type === 'inMemory' ||
      type === 'inProcess' ||
      (type === undefined && draft.installSource === 'builtin' && !hasCommand && !hasBaseUrl))
  ) {
    return { type: preset.type, preset, disable: false }
  }

  if (type === 'inMemory' || type === 'inProcess') {
    if (hasCommand) return { type: 'stdio', disable: false }
    if (hasBaseUrl) {
      return {
        type: (draft.baseUrl as string).endsWith('/mcp') ? 'streamableHttp' : 'sse',
        disable: false
      }
    }
    return {
      type: null,
      disable: true,
      warning: `Disabled unknown legacy ${type} MCP server: ${String(draft.name ?? 'unknown')}`
    }
  }

  if (type === 'stdio' || type === 'sse' || type === 'streamableHttp') {
    return { type, disable: false }
  }
  if (type?.includes('http')) return { type: 'streamableHttp', disable: false }
  if (type === undefined) {
    if (hasCommand) return { type: 'stdio', disable: false }
    if (hasBaseUrl) {
      return {
        type: (draft.baseUrl as string).endsWith('/mcp') ? 'streamableHttp' : 'sse',
        disable: false
      }
    }
  }
  return { type: null, disable: false }
}

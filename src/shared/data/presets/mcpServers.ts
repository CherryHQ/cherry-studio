/**
 * Builtin (preset) MCP server definitions
 *
 * Single source of truth for the built-in MCP servers: the renderer lists them for install,
 * and `BuiltinMcpServerSeeder` reconciles already-installed rows against them.
 *
 * Note: The `hub` server (@cherry/hub) is intentionally excluded because:
 * - It's a meta-server that aggregates all other MCP servers
 * - It's designed for LLM code mode, not direct user interaction
 * - It should be auto-enabled internally when needed, not manually installed
 */
import type { McpServer } from '@shared/data/types/mcpServer'
import { type BuiltinMcpServerName, BuiltinMcpServerNames } from '@shared/utils/mcp'

/** A builtin server as declared in code; the `id` is assigned by the database on install. */
export type McpServerPreset = Omit<McpServer, 'id' | 'name'> & { name: BuiltinMcpServerName }

/** Frozen because both the renderer catalog and the seeder read these objects live. */
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
    type: 'inMemory',
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
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.braveSearch,
    type: 'inMemory',
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
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.filesystem,
    type: 'inMemory',
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
    type: 'inMemory',
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
    type: 'inMemory',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    name: BuiltinMcpServerNames.didiMcp,
    reference: 'https://mcp.didichuxing.com/',
    type: 'inMemory',
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
    type: 'inMemory',
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

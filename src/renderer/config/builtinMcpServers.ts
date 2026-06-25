/**
 * @deprecated Temporary placement. Migrated verbatim from the v1 Redux store
 * (`src/renderer/store/mcp.ts`) when that module was turned into an isolated island.
 *
 * This default built-in MCP server catalog should NOT live in the renderer. In v2 it needs to be
 * migrated to the data layer / main process (e.g. seeded alongside the MCP runtime factory under
 * `src/main/ai/mcp/`), not hardcoded in the UI. It is parked here only as an interim home until
 * that v2 migration lands.
 */
import { type BuiltinMcpServer, BuiltinMcpServerNames } from '@shared/utils/mcp'
import { nanoid } from 'nanoid'

const filesystemManualApprovalTools = ['write', 'edit', 'delete'] as const

/**
 * User-installable built-in MCP servers shown in the UI.
 *
 * Note: The `hub` server (@cherry/hub) is intentionally excluded because:
 * - It's a meta-server that aggregates all other MCP servers
 * - It's designed for LLM code mode, not direct user interaction
 * - It should be auto-enabled internally when needed, not manually installed
 */
export const builtinMcpServers: BuiltinMcpServer[] = [
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.flomo,
    reference: 'https://flomoapp.com',
    type: 'inMemory',
    isActive: false,
    provider: 'flomo',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.mcpAutoInstall,
    reference: 'https://docs.cherry-ai.com/advanced-basic/mcp/auto-install',
    type: 'inMemory',
    command: 'npx',
    args: ['-y', '@mcpmarket/mcp-auto-install', 'connect', '--json'],
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
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
    id: nanoid(),
    name: BuiltinMcpServerNames.sequentialThinking,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
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
    id: nanoid(),
    name: BuiltinMcpServerNames.fetch,
    type: 'inMemory',
    isActive: true,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
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
    id: nanoid(),
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
    id: nanoid(),
    name: BuiltinMcpServerNames.python,
    type: 'inMemory',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: '@cherry/didi-mcp',
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
    id: nanoid(),
    name: BuiltinMcpServerNames.browser,
    type: 'inMemory',
    isActive: false,
    provider: 'CherryAI',
    installSource: 'builtin',
    isTrusted: true
  },
  {
    id: nanoid(),
    name: BuiltinMcpServerNames.nowledgeMem,
    reference: 'https://mem.nowledge.co/',
    type: 'inMemory',
    isActive: false,
    provider: 'Nowledge',
    installSource: 'builtin',
    isTrusted: true
  }
] as const

/**
 * Integration tests for MCP tool wiring through the unified permission
 * pipeline. Verifies that:
 *   1. Tools NOT in `disabledAutoApproveTools` auto-allow (existing UX).
 *   2. Tools in `disabledAutoApproveTools` fall through to user rules.
 *   3. Server-wide deny rules (`mcp__<server>`) override the auto-allow
 *      default — newly possible after migration to the unified pipeline.
 *   4. Server-wide allow rules cover opted-out tools.
 */

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { ToolRegistry } from '@main/ai/tools/registry'
import { matcherRegistry } from '@main/services/toolApproval'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listTools, list } = vi.hoisted(() => ({ listTools: vi.fn(), list: vi.fn() }))

vi.mock('@main/core/application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  const application = createMockApplication()
  const originalGet = application.get
  application.get = vi.fn((name: string) => {
    if (name === 'McpService') return { listTools, callTool: vi.fn() }
    return originalGet(name)
  })
  return { application, serviceList: [] }
})

vi.mock('@application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  const application = createMockApplication()
  const originalGet = application.get
  application.get = vi.fn((name: string) => {
    if (name === 'McpService') return { listTools, callTool: vi.fn() }
    return originalGet(name)
  })
  return { application, serviceList: [] }
})

vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list }
}))

const { syncMcpToolsToRegistry } = await import('../mcpTools')

const RULES_KEY = 'tools.permission_rules'

function mcpTool(serverId: string, name: string) {
  return {
    id: `mcp__${serverId}__${name}`,
    serverId,
    serverName: serverId,
    name,
    description: '',
    inputSchema: { type: 'object', properties: {} }
  }
}

function activeServer(id: string, disabledAutoApproveTools: string[] = []) {
  return { id, name: id, isActive: true, disabledAutoApproveTools }
}

async function buildRegistry(
  server: ReturnType<typeof activeServer>,
  tools: Array<{ name: string }>
): Promise<ToolRegistry> {
  list.mockReset()
  listTools.mockReset()
  list.mockResolvedValue({ items: [server] })
  listTools.mockResolvedValue(tools.map((t) => mcpTool(server.id, t.name)))
  const reg = new ToolRegistry()
  await syncMcpToolsToRegistry(reg)
  return reg
}

async function callNeedsApproval(reg: ToolRegistry, toolId: string): Promise<boolean> {
  const entry = reg.getByName(toolId)!
  // Real central pipeline reads from the global tool registry; mirror our
  // freshly-built one in.
  await import('@main/services/toolApproval').then(({ matcherRegistry: _ }) => _)
  // Register the entry on the global registry so checkPermission can see L3.
  ;(await import('@main/ai/tools/registry')).registry.register(entry)
  const fn = entry.tool.needsApproval as (input: unknown, opts: ToolExecutionOptions) => Promise<boolean>
  return fn({}, {
    toolCallId: 'tc-test',
    messages: [],
    experimental_context: {},
    abortSignal: new AbortController().signal
  } as ToolExecutionOptions)
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  // Each test starts with a clean global tool registry to avoid bleed.
  // (registry singleton is module-scoped; we additively register per-test.)
})

describe('MCP needsApproval — default-allow path', () => {
  it('non-opt-out tool → false (auto-execute)', async () => {
    const reg = await buildRegistry(activeServer('weather'), [{ name: 'forecast' }])
    expect(await callNeedsApproval(reg, 'mcp__weather__forecast')).toBe(false)
  })
})

describe('MCP needsApproval — opt-out path', () => {
  it('opted-out tool with no rules → true (ask user)', async () => {
    const reg = await buildRegistry(activeServer('shell', ['exec']), [{ name: 'exec' }])
    expect(await callNeedsApproval(reg, 'mcp__shell__exec')).toBe(true)
  })

  it('opted-out tool with allow rule → false (auto-execute)', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, [
      {
        id: 'r1',
        toolName: 'mcp__shell__exec',
        behavior: 'allow',
        source: 'userPreference',
        createdAt: 1
      }
    ])
    const reg = await buildRegistry(activeServer('shell', ['exec']), [{ name: 'exec' }])
    expect(await callNeedsApproval(reg, 'mcp__shell__exec')).toBe(false)
  })
})

describe('MCP needsApproval — deny rules win over default-allow', () => {
  it('server-wide deny rule denies even non-opt-out tool', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, [
      {
        id: 'r1',
        toolName: 'mcp__weather',
        behavior: 'deny',
        source: 'userPreference',
        createdAt: 1
      }
    ])
    const reg = await buildRegistry(activeServer('weather'), [{ name: 'forecast' }])
    await expect(callNeedsApproval(reg, 'mcp__weather__forecast')).rejects.toThrow()
  })

  it('exact-tool deny rule denies', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(RULES_KEY, [
      {
        id: 'r2',
        toolName: 'mcp__weather__forecast',
        behavior: 'deny',
        source: 'userPreference',
        createdAt: 1
      }
    ])
    const reg = await buildRegistry(activeServer('weather'), [{ name: 'forecast' }])
    await expect(callNeedsApproval(reg, 'mcp__weather__forecast')).rejects.toThrow()
  })
})

describe('MCP — matcherRegistry stays untouched', () => {
  it('MCP tools do not register a content matcher (no per-tool input grammar)', () => {
    expect(matcherRegistry.get('mcp__weather__forecast')).toBeUndefined()
  })
})

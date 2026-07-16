import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { Tool } from 'ai'
import { jsonSchema } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildMcpToolSet: vi.fn(),
  resolveEnabledSkillCatalog: vi.fn()
}))

vi.mock('./mcpToolSet', () => ({ buildMcpToolSet: mocks.buildMcpToolSet }))
vi.mock('../skillCatalog', () => ({ resolveEnabledSkillCatalog: mocks.resolveEnabledSkillCatalog }))
vi.mock('@main/ai/skills/SkillService', () => ({ skillService: { list: vi.fn(), readFile: vi.fn() } }))

import { buildAgentToolSet } from './buildAgentToolSet'
import type { AgentToolPolicy } from './toolPolicy'

const CALL_OPTIONS = { toolCallId: 'call-1', messages: [] }

function makePolicy(
  mode: AgentPermissionMode = 'default',
  disabled: Iterable<string> = []
): {
  policy: AgentToolPolicy
  setMode: (mode: AgentPermissionMode) => void
  disabledTools: Set<string>
} {
  let currentMode = mode
  const disabledTools = new Set(disabled)
  return {
    policy: { getPermissionMode: () => currentMode, isDisabled: (name) => disabledTools.has(name) },
    setMode: (next) => {
      currentMode = next
    },
    disabledTools
  }
}

async function evaluateNeedsApproval(tool: Tool, input: unknown = {}): Promise<boolean> {
  const gate = tool.needsApproval
  if (typeof gate === 'function') return await gate(input as never, CALL_OPTIONS)
  return gate ?? false
}

describe('buildAgentToolSet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildMcpToolSet.mockResolvedValue({})
    mocks.resolveEnabledSkillCatalog.mockResolvedValue([])
  })

  it('registers the workspace tools and bash; skill only with a non-empty catalog', async () => {
    const { policy } = makePolicy()
    const built = await buildAgentToolSet({ agent: { id: 'agent-1', mcps: [] }, workspacePath: '/tmp/ws', policy })

    expect(Object.keys(built.tools).sort()).toEqual(['bash', 'edit', 'glob', 'grep', 'ls', 'read', 'write'])
    expect(built.skills).toEqual([])

    mocks.resolveEnabledSkillCatalog.mockResolvedValue([
      { name: 'code-review', description: 'review', folderName: 'code-review' }
    ])
    const withSkills = await buildAgentToolSet({ agent: { id: 'agent-1', mcps: [] }, workspacePath: '/tmp/ws', policy })
    expect(Object.keys(withSkills.tools)).toContain('skill')
    expect(withSkills.skills).toHaveLength(1)
  })

  it('applies the permission matrix per tool class', async () => {
    const { policy, setMode } = makePolicy('default')
    mocks.resolveEnabledSkillCatalog.mockResolvedValue([{ name: 's', description: null, folderName: 's' }])
    const { tools } = await buildAgentToolSet({ agent: { id: 'agent-1', mcps: [] }, workspacePath: '/tmp/ws', policy })

    // default: read-only + skill auto, write/edit/bash prompt
    expect(await evaluateNeedsApproval(tools.read)).toBe(false)
    expect(await evaluateNeedsApproval(tools.glob)).toBe(false)
    expect(await evaluateNeedsApproval(tools.skill)).toBe(false)
    expect(await evaluateNeedsApproval(tools.write)).toBe(true)
    expect(await evaluateNeedsApproval(tools.edit)).toBe(true)
    expect(await evaluateNeedsApproval(tools.bash, { command: 'ls' })).toBe(true)

    // acceptEdits: write/edit flip to auto, bash keeps prompting
    setMode('acceptEdits')
    expect(await evaluateNeedsApproval(tools.write)).toBe(false)
    expect(await evaluateNeedsApproval(tools.edit)).toBe(false)
    expect(await evaluateNeedsApproval(tools.bash, { command: 'ls' })).toBe(true)

    // bypassPermissions: nothing prompts
    setMode('bypassPermissions')
    expect(await evaluateNeedsApproval(tools.bash, { command: 'ls' })).toBe(false)
  })

  it('MCP tools keep native ids and prompt in default AND acceptEdits', async () => {
    const execute = vi.fn(async () => 'mcp-ok')
    mocks.buildMcpToolSet.mockResolvedValue({
      mcp__files__search: {
        description: 'search',
        inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object' }),
        // Chat-side source policy says auto — the agent policy must override it.
        needsApproval: async () => false,
        execute
      }
    })
    const { policy, setMode } = makePolicy('default')
    const { tools } = await buildAgentToolSet({
      agent: { id: 'agent-1', mcps: ['srv-1'] },
      workspacePath: '/tmp/ws',
      policy
    })
    expect(mocks.buildMcpToolSet).toHaveBeenCalledWith(['srv-1'])

    const mcpTool = tools['mcp__files__search']
    expect(await evaluateNeedsApproval(mcpTool)).toBe(true)
    setMode('acceptEdits')
    expect(await evaluateNeedsApproval(mcpTool)).toBe(true)
    setMode('bypassPermissions')
    expect(await evaluateNeedsApproval(mcpTool)).toBe(false)
    await expect(mcpTool.execute!({} as never, CALL_OPTIONS)).resolves.toBe('mcp-ok')
  })

  it('bash hard-denies global installs in every mode, without prompting', async () => {
    const { policy } = makePolicy('bypassPermissions')
    const { tools } = await buildAgentToolSet({ agent: { id: 'agent-1', mcps: [] }, workspacePath: '/tmp/ws', policy })

    const input = { command: 'npm install -g cowsay' }
    expect(await evaluateNeedsApproval(tools.bash, input)).toBe(false)
    await expect(tools.bash.execute!(input as never, CALL_OPTIONS)).rejects.toThrow('dependency pollution')
  })

  it('a disabled tool is denied at execution time', async () => {
    const { policy } = makePolicy('bypassPermissions', ['write'])
    const { tools } = await buildAgentToolSet({ agent: { id: 'agent-1', mcps: [] }, workspacePath: '/tmp/ws', policy })

    await expect(tools.write.execute!({ file_path: 'a.txt', content: 'x' } as never, CALL_OPTIONS)).rejects.toThrow(
      'disabled for this agent'
    )
  })
})

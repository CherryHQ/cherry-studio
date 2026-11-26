import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAgentBuiltinTools } from '../builtinTools'

const platform = vi.hoisted(() => ({ current: 'darwin' }))
vi.mock('@renderer/utils/platform', () => ({
  get platform() {
    return platform.current
  }
}))

const knowledgeTools = [
  {
    id: 'mcp__cherry-tools__kb_search',
    labelKey: 'agent.tools.builtin.CherryKbSearch.label',
    category: 'context'
  },
  {
    id: 'mcp__cherry-tools__kb_manage',
    labelKey: 'agent.tools.builtin.CherryKbManage.label',
    category: 'context'
  }
]
const isKnowledgeTool = ({ id }: { id: string }) => id.startsWith('mcp__cherry-tools__kb_')

describe('getAgentBuiltinTools', () => {
  beforeEach(() => {
    platform.current = 'darwin'
  })

  it.each(['claude-code', 'pi', 'pi-durable'] as const)(
    'adds only the two knowledge switches when %s is bound',
    (runtime) => {
      const unbound = getAgentBuiltinTools(runtime, false)
      const bound = getAgentBuiltinTools(runtime, true)

      expect(unbound.filter(isKnowledgeTool)).toEqual([])
      expect(bound.filter(isKnowledgeTool)).toMatchObject(knowledgeTools)
      expect(bound.filter((tool) => !isKnowledgeTool(tool))).toEqual(unbound)
      expect(bound).toHaveLength(unbound.length + 2)
    }
  )

  it.each([
    ['pi', ['read', 'bash', 'edit', 'write', 'vcc_recall', 'tool_search', 'codemode'], 9],
    ['pi-durable', ['read', 'bash', 'edit', 'write', 'tool_search', 'codemode'], 8]
  ] as const)('preserves native %s rows and their order on macOS', (runtime, nativeIds, boundTotal) => {
    expect(getAgentBuiltinTools(runtime, false).map((tool) => tool.id)).toEqual(nativeIds)
    expect(getAgentBuiltinTools(runtime, true)).toHaveLength(boundTotal)
  })

  it.each(['darwin', 'linux', 'win32'])('platform-gates Pi PowerShell on %s', (os) => {
    platform.current = os
    for (const runtime of ['pi', 'pi-durable'] as const) {
      expect(getAgentBuiltinTools(runtime, true).some((tool) => tool.id === 'powershell')).toBe(os === 'win32')
    }
  })
})

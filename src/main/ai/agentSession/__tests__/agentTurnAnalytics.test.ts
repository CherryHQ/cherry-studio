import { describe, expect, it } from 'vitest'

import { analyticsToolName, summarizeAgentTurnTools } from '../agentTurnAnalytics'

const tool = (name: string, state = 'output-available') =>
  ({ type: `tool-${name}`, toolCallId: `${name}-${Math.random()}`, state, input: {} }) as never

describe('agent turn tool analytics', () => {
  it('keeps built-in names and never reports a user MCP server or tool name', () => {
    expect(analyticsToolName('Bash')).toBe('Bash')
    expect(analyticsToolName('read')).toBe('read')
    expect(analyticsToolName('mcp__cherry-tools__web_search')).toBe('mcp__cherry-tools__web_search')
    expect(analyticsToolName('mcp__agent_memory__memory')).toBe('mcp__agent_memory__memory')
    expect(analyticsToolName('mcp__3f1c2a9e-1111-4111-8111-111111111111__send_invoice')).toBe('mcp_custom')
    expect(analyticsToolName('my_private_tool')).toBe('other')
    // A chat wire id for a custom server named "Browser": the slug looks built-in, the digest is its identity.
    expect(analyticsToolName('mcp__browser__sendInvoice_0a1b2c3d4e5f60718293')).toBe('mcp_custom')
  })

  it('counts tools per name, failures, subagents, and skills in one turn', () => {
    const summary = summarizeAgentTurnTools([
      { type: 'text', text: 'hi' } as never,
      tool('Bash'),
      tool('Bash', 'output-error'),
      tool('Task'),
      tool('Skill'),
      tool('mcp__0a__secret_tool')
    ])
    expect(summary).toEqual({
      toolCallCount: 5,
      toolErrorCount: 1,
      subagentCount: 1,
      skillCount: 1,
      tools: { 'tool:Bash': 2, 'tool:Task': 1, 'tool:Skill': 1, 'tool:mcp_custom': 1 }
    })
  })

  it('reports an empty summary when the turn has no message yet', () => {
    expect(summarizeAgentTurnTools(undefined)).toMatchObject({ toolCallCount: 0, tools: {} })
  })
})

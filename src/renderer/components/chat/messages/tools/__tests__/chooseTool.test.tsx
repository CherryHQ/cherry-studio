import type { NormalToolResponse } from '@renderer/types'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Stub the leaf cards so we can assert ONLY which branch chooseTool routes to.
vi.mock('../meta/MessageMetaTool', () => ({
  default: () => <div data-testid="meta-card" />,
  isMetaToolName: (name: string) => name === 'tool_search' || name === 'tool_inspect' || name === 'tool_invoke'
}))
vi.mock('../knowledge/MessageKnowledgeSearch', () => ({
  MessageKnowledgeSearchToolTitle: () => <div data-testid="kb-card" />
}))
vi.mock('../web-search/MessageWebSearch', () => ({
  MessageWebSearchToolTitle: () => <div data-testid="web-card" />
}))
vi.mock('../agent', () => ({
  AgentExecutionTimeline: () => <div data-testid="agent-card" />
}))
// Empty enum → isAgentTool only matches the `mcp__` prefix, not our builtin names.
vi.mock('../agent/types', () => ({ AgentToolsType: {}, isAskUserQuestionToolName: () => false }))

const { chooseTool } = await import('../chooseTool')

function resp(name: string, type?: string): NormalToolResponse {
  return { tool: { name, type } } as unknown as NormalToolResponse
}

function testIdOf(node: React.ReactNode): string | null {
  const { container } = render(<>{node}</>)
  return container.querySelector('[data-testid]')?.getAttribute('data-testid') ?? null
}

describe('chooseTool', () => {
  it('routes the kb_search / web_search wire names to their title cards', () => {
    expect(testIdOf(chooseTool(resp('kb_search')))).toBe('kb-card')
    expect(testIdOf(chooseTool(resp('web_search')))).toBe('web-card')
  })

  it('renders no card for a provider-side web_search (the provider already shows results inline)', () => {
    expect(chooseTool(resp('web_search', 'provider'))).toBeNull()
  })
})

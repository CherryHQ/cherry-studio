import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Stub the leaf cards so we can assert ONLY which branch chooseTool routes to.
vi.mock('../meta/MessageMetaTool', () => ({
  default: () => <div data-testid="meta-card" />,
  isMetaToolName: (name: string) =>
    [
      'tool_search',
      'tool_inspect',
      'tool_invoke',
      'cherry_tool_search',
      'cherry_tool_inspect',
      'cherry_tool_invoke'
    ].includes(name)
}))
vi.mock('../knowledge/MessageKnowledgeSearch', () => ({
  MessageKnowledgeSearchToolTitle: () => <div data-testid="kb-card" />
}))
vi.mock('../webSearch/MessageWebSearch', () => ({
  MessageWebSearchToolTitle: () => <div data-testid="web-card" />
}))
vi.mock('../agent', () => ({
  AgentExecutionTimeline: () => <div data-testid="agent-card" />
}))
vi.mock('../painting/MessageGenerateImage', () => ({
  MessageGenerateImageToolTitle: () => <div data-testid="image-card" />
}))
// Empty enum → isAgentTool only matches the `mcp__` prefix, not our builtin names.
vi.mock('../shared/agentToolTypes', () => ({ AgentToolsType: {}, isAskUserQuestionToolName: () => false }))

const { chooseTool } = await import('../chooseTool')
const { buildToolResponseFromPart } = await import('../toolResponse')

function resp(name: string, type?: string): NormalToolResponse {
  return { tool: { name, type } } as unknown as NormalToolResponse
}

function testIdOf(node: React.ReactNode): string | null {
  const { container } = render(<>{node}</>)
  return container.querySelector('[data-testid]')?.getAttribute('data-testid') ?? null
}

describe('chooseTool', () => {
  it('routes current and legacy knowledge/web search names to their title cards', () => {
    expect(testIdOf(chooseTool(resp('kb_search')))).toBe('kb-card')
    expect(testIdOf(chooseTool(resp('cherry_kb_search')))).toBe('kb-card')
    expect(testIdOf(chooseTool(resp('cherry_web_search')))).toBe('web-card')
    expect(testIdOf(chooseTool(resp('web_search')))).toBe('web-card')
  })

  it('renders no card for a provider-side web_search (the provider already shows results inline)', () => {
    expect(chooseTool(resp('web_search', 'provider'))).toBeNull()
  })

  it('routes chat and agent generate_image responses to the image card', () => {
    expect(testIdOf(chooseTool(resp('cherry_generate_image')))).toBe('image-card')
    expect(testIdOf(chooseTool(resp('generate_image')))).toBe('image-card')
    expect(testIdOf(chooseTool(resp('generate_image', 'mcp')))).toBe('image-card')
    expect(testIdOf(chooseTool(resp('mcp__cherry-tools__generate_image')))).toBe('image-card')
  })

  it('keeps an AI SDK dynamic cherry_generate_image part on the builtin image-card path', () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'image-call',
      toolName: 'cherry_generate_image',
      state: 'output-available',
      input: { prompt: 'a cat' },
      output: [{ id: 'file-1', name: 'cat.png' }]
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.tool.type).toBe('builtin')
    expect(testIdOf(chooseTool(response as NormalToolResponse))).toBe('image-card')
  })

  it('renders every remaining Cherry client function through the standard card', () => {
    for (const name of [
      'cherry_kb_list',
      'cherry_kb_read',
      'cherry_kb_manage',
      'cherry_read_file',
      'cherry_web_fetch'
    ]) {
      expect(testIdOf(chooseTool(resp(name)))).toBe('agent-card')
    }
  })

  it('recognizes current and persisted meta-tool names', () => {
    expect(testIdOf(chooseTool(resp('cherry_tool_search')))).toBe('meta-card')
    expect(testIdOf(chooseTool(resp('tool_search')))).toBe('meta-card')
  })
})

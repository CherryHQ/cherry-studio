import type { NormalToolResponse } from '@renderer/types/mcpTool'
import type { CherryMessagePart } from '@shared/data/types/message'
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// Stub the leaf cards so we can assert ONLY which branch chooseTool routes to.
vi.mock('../meta/MessageMetaTool', () => ({
  default: () => <div data-testid="meta-card" />,
  isMetaToolName: (name: string) => name === 'tool_search' || name === 'tool_inspect' || name === 'tool_invoke'
}))
vi.mock('../knowledge/MessageKnowledgeSearch', () => ({
  MessageKnowledgeSearchToolTitle: () => <div data-testid="kb-card" />
}))
vi.mock('../webSearch/MessageWebSearch', () => ({
  MessageWebSearchToolTitle: () => <div data-testid="web-card" />
}))
vi.mock('../agent/AgentExecutionTimeline', () => ({
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

async function testIdOf(node: React.ReactNode): Promise<string | null> {
  const { container } = render(<>{node}</>)
  await act(async () => {})
  return container.querySelector('[data-testid]')?.getAttribute('data-testid') ?? null
}

describe('chooseTool', () => {
  it('renders all knowledge-base wire names', async () => {
    expect(await testIdOf(chooseTool(resp('kb_search')))).toBe('kb-card')
    expect(await testIdOf(chooseTool(resp('kb_list')))).toBe('agent-card')
    expect(await testIdOf(chooseTool(resp('kb_read')))).toBe('agent-card')
    expect(await testIdOf(chooseTool(resp('kb_manage')))).toBe('agent-card')
  })

  it('routes the web_search wire name to its title card', async () => {
    expect(await testIdOf(chooseTool(resp('web_search')))).toBe('web-card')
  })

  it('routes cross-session tools to their dedicated agent cards', async () => {
    expect(await testIdOf(chooseTool(resp('session_create')))).toBe('agent-card')
    expect(await testIdOf(chooseTool(resp('session_send')))).toBe('agent-card')
  })

  it('routes provider-executed web search wire names to the web card', async () => {
    expect(await testIdOf(chooseTool(resp('web_search', 'provider')))).toBe('web-card')
    expect(await testIdOf(chooseTool(resp('webSearch', 'provider')))).toBe('web-card')
  })

  it('routes chat and agent generate_image responses to the image card', async () => {
    expect(await testIdOf(chooseTool(resp('generate_image')))).toBe('image-card')
    expect(await testIdOf(chooseTool(resp('generate_image', 'mcp')))).toBe('image-card')
    expect(await testIdOf(chooseTool(resp('mcp__cherry-tools__generate_image')))).toBe('image-card')
  })

  it('keeps an AI SDK dynamic generate_image part on the builtin image-card path', async () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'image-call',
      toolName: 'generate_image',
      state: 'output-available',
      input: { prompt: 'a cat' },
      output: [{ id: 'file-1', name: 'cat.png' }]
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.tool.type).toBe('builtin')
    expect(await testIdOf(chooseTool(response as NormalToolResponse))).toBe('image-card')
  })

  it('routes pi runtime built-ins to the generic agent card', async () => {
    expect(await testIdOf(chooseTool(resp('read', 'provider')))).toBe('agent-card')
    expect(await testIdOf(chooseTool(resp('bash', 'provider')))).toBe('agent-card')
    expect(chooseTool(resp('read', 'builtin'))).toBeNull()
  })

  it('routes actual Pi builtin metadata through the response adapter to the agent card', async () => {
    const part = {
      type: 'dynamic-tool',
      toolCallId: 'pi-read',
      toolName: 'read',
      state: 'output-available',
      input: { path: '/workspace/file.md' },
      output: 'content',
      callProviderMetadata: {
        cherry: { transport: 'pi-agent', tool: { type: 'builtin', name: 'read' } }
      }
    } as unknown as CherryMessagePart

    const response = buildToolResponseFromPart(part)
    expect(response?.tool.type).toBe('provider')
    expect(await testIdOf(chooseTool(response as NormalToolResponse))).toBe('agent-card')
  })

  it('returns null for an unknown non-Cherry tool', async () => {
    expect(await testIdOf(chooseTool(resp('totally_unknown_tool', 'builtin')))).toBeNull()
  })
})

import type { NormalToolResponse } from '@renderer/types'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MessageTool from '../MessageTool'

vi.mock('../MessageAgentTools', () => ({
  MessageAgentTools: ({ toolResponse }: { toolResponse: NormalToolResponse }) => (
    <div data-testid="agent-tool">Agent: {toolResponse.tool.name}</div>
  )
}))

vi.mock('../MessageKnowledgeSearch', () => ({
  MessageKnowledgeSearchToolTitle: () => <div data-testid="knowledge-tool">Knowledge</div>
}))

vi.mock('../MessageMemorySearch', () => ({
  MessageMemorySearchToolTitle: () => <div data-testid="memory-tool">Memory</div>
}))

vi.mock('../MessageWebSearch', () => ({
  MessageWebSearchToolTitle: () => <div data-testid="web-search-tool">Web search</div>
}))

const createBlock = (name: string, type: NormalToolResponse['tool']['type']): ToolMessageBlock => {
  const toolResponse: NormalToolResponse = {
    id: `response-${name}`,
    tool: { id: name, name, description: `${name} description`, type },
    arguments: {},
    status: 'done',
    response: 'output',
    toolCallId: `call-${name}`
  }

  return {
    type: 'tool',
    id: `block-${name}`,
    messageId: 'message-1',
    toolId: name,
    metadata: { rawMcpToolResponse: toolResponse }
  } as ToolMessageBlock
}

describe('MessageTool', () => {
  it('routes PowerShell provider tools to the Agent renderer', () => {
    render(<MessageTool block={createBlock('PowerShell', 'provider')} />)

    expect(screen.getByTestId('agent-tool')).toHaveTextContent('Agent: PowerShell')
  })

  it('routes an unknown future provider tool to the Agent generic-renderer path', () => {
    render(<MessageTool block={createBlock('FutureProviderTool', 'provider')} />)

    expect(screen.getByTestId('agent-tool')).toHaveTextContent('Agent: FutureProviderTool')
  })

  it('preserves prefixed knowledge routing for provider tools', () => {
    render(<MessageTool block={createBlock('builtin_knowledge_search', 'provider')} />)

    expect(screen.getByTestId('knowledge-tool')).toBeInTheDocument()
  })

  it('keeps an unknown builtin tool unrendered', () => {
    const { container } = render(<MessageTool block={createBlock('builtin_future_tool', 'builtin')} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('preserves provider web search suppression', () => {
    const { container } = render(<MessageTool block={createBlock('builtin_web_search', 'provider')} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('preserves builtin web search routing', () => {
    render(<MessageTool block={createBlock('builtin_web_search_preview', 'builtin')} />)

    expect(screen.getByTestId('web-search-tool')).toBeInTheDocument()
  })

  it.each([
    ['builtin_knowledge_search', 'knowledge-tool'],
    ['builtin_memory_search', 'memory-tool']
  ])('preserves %s routing', (toolName, testId) => {
    render(<MessageTool block={createBlock(toolName, 'builtin')} />)

    expect(screen.getByTestId(testId)).toBeInTheDocument()
  })

  it('preserves MCP Agent routing', () => {
    render(<MessageTool block={createBlock('mcp__filesystem__read_file', 'mcp')} />)

    expect(screen.getByTestId('agent-tool')).toHaveTextContent('Agent: mcp__filesystem__read_file')
  })
})

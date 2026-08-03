import { ToolCallChunkHandler } from '@renderer/aiCore/chunk/handleToolCallChunk'
import type { NormalToolResponse } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import { ChunkType } from '@renderer/types/chunk'
import type { ToolMessageBlock } from '@renderer/types/newMessage'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MessageTool from '../MessageTool'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/KnowledgeService', () => ({
  processKnowledgeReferences: vi.fn()
}))

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

  it('routes an unknown prefixed provider tool to the Agent generic-renderer path', () => {
    render(<MessageTool block={createBlock('builtin_FutureProviderTool', 'provider')} />)

    expect(screen.getByTestId('agent-tool')).toHaveTextContent('Agent: builtin_FutureProviderTool')
  })

  it('preserves unknown prefixed provider classification through streaming and final rendering', () => {
    const emittedChunks: Chunk[] = []
    const handler = new ToolCallChunkHandler((chunk) => emittedChunks.push(chunk), [])
    const toolCallId = 'future-provider-call'
    const toolName = 'builtin_FutureProviderTool'
    const input = { command: 'Get-FutureData' }
    const startChunk: Parameters<ToolCallChunkHandler['handleToolInputStart']>[0] = {
      type: 'tool-input-start',
      id: toolCallId,
      toolName,
      providerExecuted: true
    }

    expect(startChunk.providerExecuted).toBe(true)
    handler.handleToolInputStart(startChunk)

    const streamingChunk = emittedChunks[0]
    expect(streamingChunk.type).toBe(ChunkType.MCP_TOOL_STREAMING)
    if (streamingChunk.type !== ChunkType.MCP_TOOL_STREAMING) {
      throw new Error('Expected an MCP_TOOL_STREAMING chunk')
    }
    expect(streamingChunk.responses[0].tool.type).toBe('provider')

    handler.handleToolInputDelta({
      type: 'tool-input-delta',
      id: toolCallId,
      delta: JSON.stringify(input)
    })
    handler.handleToolInputEnd({ type: 'tool-input-end', id: toolCallId })
    handler.handleToolCall({
      type: 'tool-call',
      toolCallId,
      toolName,
      input,
      providerExecuted: true
    } as Parameters<ToolCallChunkHandler['handleToolCall']>[0])

    expect(ToolCallChunkHandler.getActiveToolCalls().get(toolCallId)?.tool.type).toBe('provider')

    handler.handleToolResult({
      type: 'tool-result',
      toolCallId,
      toolName,
      input,
      output: 'future provider output'
    } as Parameters<ToolCallChunkHandler['handleToolResult']>[0])

    const completeChunk = emittedChunks.find((chunk) => chunk.type === ChunkType.MCP_TOOL_COMPLETE)
    expect(completeChunk?.type).toBe(ChunkType.MCP_TOOL_COMPLETE)
    if (!completeChunk || completeChunk.type !== ChunkType.MCP_TOOL_COMPLETE) {
      throw new Error('Expected an MCP_TOOL_COMPLETE chunk')
    }

    const finalResponse = completeChunk.responses[0] as NormalToolResponse
    expect(finalResponse.tool.type).toBe('provider')
    expect(finalResponse.tool.name).toBe(toolName)
    expect(finalResponse.arguments).toEqual(input)
    expect(finalResponse.response).toBe('future provider output')

    const block = createBlock(toolName, 'provider')
    if (block.metadata) {
      block.metadata.rawMcpToolResponse = finalResponse
    }
    render(<MessageTool block={block} />)

    expect(screen.getByTestId('agent-tool')).toHaveTextContent(`Agent: ${toolName}`)
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

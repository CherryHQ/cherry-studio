import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

import { MessagePartsScopeProvider } from '../../blocks/MessagePartsContext'
import MessageTools from '../MessageTools'

const { useToolResultMock, renderedResponses, topicIdMock } = vi.hoisted(() => ({
  useToolResultMock: vi.fn(),
  renderedResponses: [] as unknown[],
  topicIdMock: vi.fn<() => string | undefined>(() => 'topic-1')
}))

vi.mock('@renderer/hooks/useToolResult', () => ({ useToolResult: useToolResultMock }))
vi.mock('../../MessageListProvider', () => ({ useOptionalMessageListTopicId: () => topicIdMock() }))
vi.mock('../MessageTool', () => ({
  default: ({ toolResponse }: { toolResponse: unknown }) => {
    renderedResponses.push(toolResponse)
    return <div data-testid="message-tool" />
  },
  canRenderMessageToolResponse: () => true
}))
vi.mock('../mcp/MessageMcpTool', () => ({ default: () => <div data-testid="mcp-tool" /> }))
vi.mock('../agent', () => ({
  isReportArtifactsToolResponse: () => false,
  MessageChannelConfigTool: () => null
}))
vi.mock('../channelConfigTool', () => ({ isChannelAuthQrToolResponse: () => false }))

const entitiesEnvelope = {
  $persistedToolOutput: {
    shape: 'entities',
    skeleton: [{ id: 'cite-0', url: 'https://a.example', content: 'snippet…' }],
    blobRefs: [
      {
        key: '/0/content',
        fileEntryId: 'entry-1',
        vfsFilename: 'vfs_1.txt',
        head: 'head excerpt',
        tail: 'tail excerpt',
        totalChars: 100_000,
        totalLines: 2_000
      }
    ]
  }
}

function toolResponseWith(response: unknown): NormalToolResponse {
  return {
    id: 'call-1',
    tool: { id: 'call-1', name: 'web_fetch', type: 'builtin' },
    arguments: undefined,
    status: 'done',
    response,
    toolCallId: 'call-1'
  }
}

function renderInScope(response: unknown) {
  return render(
    <MessagePartsScopeProvider messageId="m1" parts={[]}>
      <MessageTools toolResponse={toolResponseWith(response)} />
    </MessagePartsScopeProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  renderedResponses.length = 0
  topicIdMock.mockReturnValue('topic-1')
  useToolResultMock.mockReturnValue({ output: undefined, error: undefined, isLoading: true })
})

describe('MessageTools cold-reload self-defer', () => {
  it('converts a bare persisted envelope into a resolvable deferred reference', () => {
    renderInScope(entitiesEnvelope)
    expect(useToolResultMock).toHaveBeenCalledWith({ topicId: 'topic-1', messageId: 'm1', toolCallId: 'call-1' })
  })

  it('shows the envelope excerpt while the full value loads', () => {
    renderInScope(entitiesEnvelope)
    expect(renderedResponses.at(-1)).toMatchObject({ response: 'head excerpt\n…\ntail excerpt' })
  })

  it('renders the resolved output once the fetch lands', () => {
    useToolResultMock.mockReturnValue({
      output: [{ id: 'cite-0', content: 'full text' }],
      error: undefined,
      isLoading: false
    })
    renderInScope(entitiesEnvelope)
    expect(renderedResponses.at(-1)).toMatchObject({ response: [{ id: 'cite-0', content: 'full text' }] })
  })

  it('leaves the raw envelope in place outside a message list scope', () => {
    topicIdMock.mockReturnValue(undefined)
    renderInScope(entitiesEnvelope)
    expect(useToolResultMock).toHaveBeenCalledWith(undefined)
    expect(renderedResponses.at(-1)).toMatchObject({ response: entitiesEnvelope })
  })

  it('still resolves an already-projected deferred output as before', () => {
    renderInScope({
      $deferredToolResult: { topicId: 'topic-9', messageId: 'm9', toolCallId: 'call-1' },
      excerpt: { head: 'p-head', tail: 'p-tail', totalChars: 10, totalLines: 2 }
    })
    expect(useToolResultMock).toHaveBeenCalledWith({ topicId: 'topic-9', messageId: 'm9', toolCallId: 'call-1' })
    expect(renderedResponses.at(-1)).toMatchObject({ response: 'p-head\n…\np-tail' })
  })
})

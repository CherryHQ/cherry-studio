import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatMarkdown from '../ChatMarkdown'

const mocks = vi.hoisted(() => ({
  markdown: vi.fn(),
  streamingMarkdown: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Markdown: (props: { children: string }) => {
    mocks.markdown(props)
    return <div data-testid="static-markdown">{props.children}</div>
  },
  StreamingMarkdown: (props: { animated?: false; children: string; parseIncompleteMarkdown?: boolean }) => {
    mocks.streamingMarkdown(props)
    return (
      <div
        data-testid="streaming-markdown"
        data-animated={String(props.animated)}
        data-parse-incomplete={String(props.parseIncompleteMarkdown)}>
        {props.children}
      </div>
    )
  },
  withChatPlugins: () => ({})
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false, codeFancyBlock: true }),
  useOptionalMessageListActions: () => undefined,
  useOptionalMessageListUi: () => undefined
}))

vi.mock('@renderer/components/markdown', () => ({
  useMarkdownComponents: () => ({})
}))

vi.mock('@renderer/components/chat/messages/tools/shared/ClickableFilePath', () => ({
  ClickableFilePath: ({ path }: { path: string }) => <span>{path}</span>
}))

describe('ChatMarkdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['success', 'error'])('keeps the streaming renderer but disables live semantics on %s', (status) => {
    const { rerender } = render(
      <ChatMarkdown block={{ id: 'message-part', content: '[unfinished](', status: 'streaming' }} />
    )
    const streamingNode = screen.getByTestId('streaming-markdown')

    expect(streamingNode).toHaveAttribute('data-animated', 'undefined')
    expect(streamingNode).toHaveAttribute('data-parse-incomplete', 'true')

    rerender(<ChatMarkdown block={{ id: 'message-part', content: '[unfinished](', status }} />)

    expect(screen.getByTestId('streaming-markdown')).toBe(streamingNode)
    expect(streamingNode).toHaveAttribute('data-animated', 'false')
    expect(streamingNode).toHaveAttribute('data-parse-incomplete', 'false')
    expect(mocks.markdown).not.toHaveBeenCalled()
  })
})

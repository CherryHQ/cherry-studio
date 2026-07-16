import { removeSvgEmptyLines } from '@renderer/utils/formats'
import { processLatexBrackets } from '@renderer/utils/markdown'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatMarkdown from '../ChatMarkdown'

function processContent(text: string): string {
  return removeSvgEmptyLines(processLatexBrackets(text))
}

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
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false })
}))

vi.mock('../useChatMarkdownComponents', () => ({
  useChatMarkdownComponents: () => ({})
}))

function makeLines(lineCount: number, suffix = ''): string {
  return Array.from({ length: lineCount }, (_, i) => `line ${i}${suffix}`).join('\n')
}

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

  it('renders plain text instead of markdown while streaming a very long response', () => {
    const longContent = makeLines(2500)
    render(<ChatMarkdown block={{ id: 'part', content: longContent, status: 'streaming' }} />)

    expect(screen.getByTestId('plain-text-stream')).toHaveTextContent('line 0')
    expect(screen.queryByTestId('streaming-markdown')).toBeNull()
    expect(mocks.markdown).not.toHaveBeenCalled()
  })

  it('renders the full content once a very long response finishes streaming', () => {
    const longContent = makeLines(2500)
    const { rerender } = render(<ChatMarkdown block={{ id: 'part', content: longContent, status: 'streaming' }} />)

    rerender(<ChatMarkdown block={{ id: 'part', content: longContent, status: 'success' }} />)

    expect(screen.queryByTestId('plain-text-stream')).toBeNull()
    // The completed message mounts the streaming renderer once with the full
    // (unthrottled, non-plain-text) content for a single final parse.
    const finalNode = screen.getByTestId('streaming-markdown')
    expect(finalNode).toHaveAttribute('data-parse-incomplete', 'false')
    // Assert against the processed value (same pipeline the component uses),
    // not the raw fixture — the fixture is intentionally a processor no-op.
    expect(mocks.streamingMarkdown.mock.calls.at(-1)?.[0].children).toBe(processContent(longContent))
  })

  it('throttles markdown re-parsing for long (but not huge) streaming responses', () => {
    const base = makeLines(800)
    const { rerender } = render(<ChatMarkdown block={{ id: 'part', content: base, status: 'streaming' }} />)

    // Rapid tiny increments within the commit window must NOT each re-parse.
    const increments = 20
    act(() => {
      for (let i = 1; i <= increments; i++) {
        rerender(<ChatMarkdown block={{ id: 'part', content: base + ' '.repeat(i), status: 'streaming' }} />)
      }
    })

    // Streaming renderer stays mounted (throttled path, not plain-text).
    expect(screen.getByTestId('streaming-markdown')).toBeTruthy()
    expect(screen.queryByTestId('plain-text-stream')).toBeNull()
    // The streaming renderer received far fewer distinct parses than the
    // number of re-renders — i.e. the per-frame markdown cost is bounded.
    expect(mocks.streamingMarkdown.mock.calls.length).toBeLessThan(increments)
  })

  it('does not throttle short streaming responses', () => {
    const { rerender } = render(<ChatMarkdown block={{ id: 'part', content: 'short', status: 'streaming' }} />)
    act(() => {
      rerender(<ChatMarkdown block={{ id: 'part', content: 'short extra', status: 'streaming' }} />)
    })
    // Short messages re-parse on every change (no throttle gate engaged).
    expect(mocks.streamingMarkdown.mock.calls.at(-1)?.[0].children).toBe('short extra')
  })

  it('commits on the STREAM_COMMIT_MIN_MS time gate when deltas stay small', () => {
    // Control `performance.now()` so the 120ms wall-clock branch is exercised
    // (the synchronous-increment test above only covers the char-delta path).
    let clock = 1000
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => clock)

    const base = makeLines(800) // > THROTTLE_STREAM_LINE_THRESHOLD, < PLAIN_TEXT threshold
    const { rerender } = render(<ChatMarkdown block={{ id: 'part', content: base, status: 'streaming' }} />)

    // Many tiny increments, each < STREAM_COMMIT_DELTA_CHARS, all within <120ms.
    act(() => {
      for (let i = 1; i <= 10; i++) {
        clock += 10 // 10ms between renders, well under the 120ms gate
        rerender(<ChatMarkdown block={{ id: 'part', content: base + ' '.repeat(i), status: 'streaming' }} />)
      }
    })
    const callsBeforeTimeGate = mocks.streamingMarkdown.mock.calls.length

    // Advance past the time gate without adding a large delta, then re-render.
    act(() => {
      clock += 200
      rerender(<ChatMarkdown block={{ id: 'part', content: base + ' x', status: 'streaming' }} />)
    })

    // The time gate must have triggered at least one additional commit.
    expect(mocks.streamingMarkdown.mock.calls.length).toBeGreaterThan(callsBeforeTimeGate)
    expect(mocks.streamingMarkdown.mock.calls.at(-1)?.[0].children).toBe(base + ' x')

    nowSpy.mockRestore()
  })
})

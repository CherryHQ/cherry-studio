import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatMarkdown from '../ChatMarkdownRuntime'
import { remarkHtmlArtifact } from '../plugins/remarkHtmlArtifact'

const mocks = vi.hoisted(() => ({
  markdown: vi.fn(),
  streamingMarkdown: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  defaultMarkdownPlugins: {},
  Markdown: (props: { children: string; remarkPlugins?: unknown[] }) => {
    mocks.markdown(props)
    return <div data-testid="static-markdown">{props.children}</div>
  },
  StreamingMarkdown: (props: {
    animated?: false
    children: string
    parseIncompleteMarkdown?: boolean
    remarkPlugins?: unknown[]
  }) => {
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
  withMath: () => ({})
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false })
}))

vi.mock('../ChatMarkdownRenderers', () => ({
  CHAT_MARKDOWN_COMPONENTS: {},
  CHAT_MARKDOWN_COMPONENTS_WITH_STYLE: { style: () => null }
}))

describe('ChatMarkdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the streaming renderer but disables live semantics on terminal status', () => {
    const { rerender } = render(
      <ChatMarkdown block={{ id: 'message-part', content: '[unfinished](', status: 'streaming' }} />
    )
    const streamingNode = screen.getByTestId('streaming-markdown')

    expect(streamingNode).toHaveAttribute('data-animated', 'undefined')
    expect(streamingNode).toHaveAttribute('data-parse-incomplete', 'true')

    rerender(<ChatMarkdown block={{ id: 'message-part', content: '[unfinished](', status: 'success' }} />)

    expect(screen.getByTestId('streaming-markdown')).toBe(streamingNode)
    expect(streamingNode).toHaveAttribute('data-animated', 'false')
    expect(streamingNode).toHaveAttribute('data-parse-incomplete', 'false')
    expect(mocks.markdown).not.toHaveBeenCalled()
  })

  it('enables raw HTML artifacts only for inline HTML preview messages', () => {
    const block = { id: 'message-part', content: 'Before\n\n<div>Preview</div>', status: 'success' as const }
    const { rerender } = render(<ChatMarkdown block={block} />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ remarkPlugins: undefined }))

    rerender(<ChatMarkdown block={block} inlineHtmlPreviewMode="ready" />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ remarkPlugins: [remarkHtmlArtifact] }))
  })

  it('keeps raw and fenced HTML source unchanged during Markdown preprocessing', () => {
    const rawHtml = String.raw`<script>const re = /\(x\)/</script>`
    const fencedHtml = `\`\`\`html
${rawHtml}
\`\`\``
    const block = {
      id: 'message-part',
      content: String.raw`Outside \(y\)

${rawHtml}

${fencedHtml}`,
      status: 'success' as const
    }

    render(
      <ChatMarkdown
        block={block}
        inlineHtmlPreviewMode="ready"
        postProcess={(content) => content.replace('Outside', 'Processed')}
      />
    )

    expect(mocks.markdown).toHaveBeenLastCalledWith(
      expect.objectContaining({
        children: `Processed $y$

${rawHtml}

${fencedHtml}`
      })
    )
  })
})

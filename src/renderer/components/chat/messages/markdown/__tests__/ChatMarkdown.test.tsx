import { remarkLatexMath } from '@renderer/components/markdown'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatMarkdown from '../ChatMarkdownRuntime'
import { remarkHtmlArtifact } from '../plugins/remarkHtmlArtifact'
import { remarkLiteralAutolinkFix } from '../plugins/remarkLiteralAutolinkFix'

const mocks = vi.hoisted(() => ({
  actions: undefined as
    | {
        notifyError?: (message: string) => void
        openArtifactFile?: (path: string) => void | Promise<void>
        openPath?: (path: string) => void | Promise<void>
        isDirectory?: (path: string) => Promise<boolean>
      }
    | undefined,
  markdown: vi.fn(),
  renderProvider: vi.fn(),
  streamingMarkdown: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  defaultMarkdownPlugins: {},
  Markdown: (props: { children: string; preserveFileLinkHrefs?: boolean; remarkPlugins?: unknown[] }) => {
    mocks.markdown(props)
    return <div data-testid="static-markdown">{props.children}</div>
  },
  StreamingMarkdown: (props: {
    animated?: false
    children: string
    parseIncompleteMarkdown?: boolean
    preserveFileLinkHrefs?: boolean
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
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false }),
  useOptionalMessageListActions: () => mocks.actions
}))

vi.mock('../ChatMarkdownRenderContext', () => ({
  ChatMarkdownRenderProvider: (props: { children: ReactNode; openFilePath?: (path: string) => Promise<void> }) => {
    mocks.renderProvider(props)
    return props.children
  }
}))

vi.mock('../ChatMarkdownRenderers', () => ({
  CHAT_MARKDOWN_COMPONENTS: {},
  CHAT_MARKDOWN_COMPONENTS_WITH_STYLE: { style: () => null }
}))

describe('ChatMarkdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actions = undefined
  })

  it('keeps the streaming renderer but disables live semantics on terminal status', () => {
    const { rerender } = render(
      <ChatMarkdown block={{ id: 'message-part', content: '[unfinished](', status: 'streaming' }} />
    )
    const streamingNode = screen.getByTestId('streaming-markdown')

    expect(streamingNode).toHaveAttribute('data-animated', 'undefined')
    expect(streamingNode).toHaveAttribute('data-parse-incomplete', 'true')
    expect(mocks.streamingMarkdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ remarkPlugins: [remarkLiteralAutolinkFix, remarkLatexMath] })
    )

    rerender(<ChatMarkdown block={{ id: 'message-part', content: '[unfinished](', status: 'success' }} />)

    expect(screen.getByTestId('streaming-markdown')).toBe(streamingNode)
    expect(streamingNode).toHaveAttribute('data-animated', 'false')
    expect(streamingNode).toHaveAttribute('data-parse-incomplete', 'false')
    expect(mocks.markdown).not.toHaveBeenCalled()
  })

  it('registers LaTeX math after autolink repair and before optional HTML artifacts', () => {
    const block = { id: 'message-part', content: 'Before\n\n<div>Preview</div>', status: 'success' as const }
    const { rerender } = render(<ChatMarkdown block={block} />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ remarkPlugins: [remarkLiteralAutolinkFix, remarkLatexMath] })
    )

    rerender(<ChatMarkdown block={block} inlineHtmlPreviewMode="ready" />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(
      expect.objectContaining({ remarkPlugins: [remarkLiteralAutolinkFix, remarkLatexMath, remarkHtmlArtifact] })
    )
  })

  it('keeps LaTeX and raw or fenced HTML source unchanged during preprocessing', () => {
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
        children: `Processed \\(y\\)

${rawHtml}

${fencedHtml}`
      })
    )
  })

  it('enables exact file hrefs only when the workspace opener is available', async () => {
    const block = { id: 'message-part', content: '[README](./README.md)', status: 'success' as const }
    const view = render(<ChatMarkdown block={block} />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ preserveFileLinkHrefs: false }))

    const openPath = vi.fn()
    mocks.actions = { openPath }
    view.rerender(<ChatMarkdown block={block} />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ preserveFileLinkHrefs: false }))
    expect(mocks.renderProvider.mock.calls.at(-1)?.[0].openFilePath).toBeUndefined()

    const openArtifactFile = vi.fn()
    const isDirectory = vi.fn().mockResolvedValue(true)
    mocks.actions = { openArtifactFile, openPath, isDirectory }
    view.rerender(<ChatMarkdown block={block} />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ preserveFileLinkHrefs: true }))
    const provider = mocks.renderProvider.mock.calls.at(-1)?.[0]
    await provider.openFilePath('./docs')
    expect(isDirectory).toHaveBeenCalledWith('./docs')
    expect(openPath).toHaveBeenCalledWith('./docs')
    expect(openArtifactFile).not.toHaveBeenCalled()

    view.rerender(<ChatMarkdown block={{ ...block, status: 'streaming' }} />)
    expect(mocks.streamingMarkdown).toHaveBeenLastCalledWith(expect.objectContaining({ preserveFileLinkHrefs: true }))
  })
})

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ChatMarkdown from '../ChatMarkdown'
import { remarkHtmlArtifact } from '../plugins/remarkHtmlArtifact'

const mocks = vi.hoisted(() => ({
  markdown: vi.fn(),
  streamingMarkdown: vi.fn(),
  // Set per-test to emulate each host surface's action set.
  actions: undefined as any
}))

// The mocked renderers read the injected MarkdownHost so tests can assert which
// capabilities the host exposes (e.g. whether file-link interception is wired).
vi.mock('@cherrystudio/ui', async () => {
  const { use } = await import('react')
  const { MarkdownHostContext } = await import('@renderer/hooks/useMarkdownHost')
  return {
    Markdown: (props: { children: string; disableLinkHardening?: boolean; remarkPlugins?: unknown[] }) => {
      mocks.markdown(props)
      const host = use(MarkdownHostContext)
      return (
        <div
          data-testid="static-markdown"
          data-has-open-file-path={String(!!host?.openFilePath)}
          data-disable-link-hardening={String(!!props.disableLinkHardening)}>
          {props.children}
        </div>
      )
    },
    StreamingMarkdown: (props: {
      animated?: false
      children: string
      disableLinkHardening?: boolean
      parseIncompleteMarkdown?: boolean
      remarkPlugins?: unknown[]
    }) => {
      mocks.streamingMarkdown(props)
      const host = use(MarkdownHostContext)
      return (
        <div
          data-testid="streaming-markdown"
          data-has-open-file-path={String(!!host?.openFilePath)}
          data-disable-link-hardening={String(!!props.disableLinkHardening)}
          data-animated={String(props.animated)}
          data-parse-incomplete={String(props.parseIncompleteMarkdown)}>
          {props.children}
        </div>
      )
    },
    withChatPlugins: () => ({})
  }
})

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => ({ mathEnableSingleDollar: false, codeFancyBlock: true }),
  useOptionalMessageListActions: () => mocks.actions,
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
    mocks.actions = undefined
  })

  // A markdown file-link opener is only safe where the host can resolve+open the target.
  // `openArtifactFile` is that workspace-aware capability (agent sessions with an artifact pane).
  // Link hardening must stay ON wherever we DON'T intercept, or relative links degrade to raw
  // un-hardened anchors instead of Streamdown's safe default; so both flip together.
  describe('file-link opener gating', () => {
    const block = { id: 'message-part', content: '[README](README.md)', status: 'success' as const }

    it('omits openFilePath and keeps hardening when the host has no actions (Quick Assistant / selection window)', () => {
      mocks.actions = undefined
      render(<ChatMarkdown block={block} />)
      const node = screen.getByTestId('static-markdown')
      expect(node).toHaveAttribute('data-has-open-file-path', 'false')
      expect(node).toHaveAttribute('data-disable-link-hardening', 'false')
    })

    it('omits openFilePath and keeps hardening for a host with only openPath and no workspace base (Home chat)', () => {
      mocks.actions = { openPath: vi.fn(), notifyError: vi.fn() }
      render(<ChatMarkdown block={block} />)
      const node = screen.getByTestId('static-markdown')
      expect(node).toHaveAttribute('data-has-open-file-path', 'false')
      expect(node).toHaveAttribute('data-disable-link-hardening', 'false')
    })

    it('exposes openFilePath and drops hardening only when the host can open workspace files (agent session)', () => {
      mocks.actions = { openArtifactFile: vi.fn(), openPath: vi.fn(), isDirectory: vi.fn(), notifyError: vi.fn() }
      render(<ChatMarkdown block={block} />)
      const node = screen.getByTestId('static-markdown')
      expect(node).toHaveAttribute('data-has-open-file-path', 'true')
      expect(node).toHaveAttribute('data-disable-link-hardening', 'true')
    })
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

  it('enables raw HTML artifacts only for inline HTML preview messages', () => {
    const block = { id: 'message-part', content: 'Before\n\n<div>Preview</div>', status: 'success' as const }
    const { rerender } = render(<ChatMarkdown block={block} />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ remarkPlugins: undefined }))

    rerender(<ChatMarkdown block={block} inlineHtmlPreviewMode="ready" />)

    expect(mocks.markdown).toHaveBeenLastCalledWith(expect.objectContaining({ remarkPlugins: [remarkHtmlArtifact] }))
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fragment, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUI from '@cherrystudio/ui'
import type { ReadOnlyComposerFileTokenPreview } from '@renderer/components/composer/tokenView'
import type { Citation } from '@renderer/types/message'
import type { Model } from '@renderer/types/model'
import { WEB_SEARCH_SOURCE } from '@renderer/types/webSearchProvider'
import type * as CitationUtils from '@renderer/utils/citation'
import type { ComposerMessageSnapshot } from '@shared/data/types/uiParts'

import MainTextBlock from '../MainTextBlock'

// Mock dependencies
const mockRenderConfig = vi.hoisted(() => ({
  renderInputMessageAsMarkdown: false
}))
const imagePreviewShowMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

const mockTranslations = vi.hoisted(() => ({
  'message.message.user_content.expand': 'Expand',
  'message.message.user_content.collapse': 'Collapse'
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mockRenderConfig,
  useOptionalMessageListActions: () => undefined
}))

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: {
    show: imagePreviewShowMock
  }
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUI>()
  const React = await import('react')
  const { createPortal } = await import('react-dom')
  const PopoverContext = React.createContext<{
    open: boolean
    triggerRef: { current: HTMLElement | null }
  }>({ open: false, triggerRef: { current: null } })
  return {
    ...actual,
    Flex: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    NormalTooltip: ({
      children,
      content,
      contentProps,
      delayDuration,
      open,
      side,
      sideOffset,
      triggerProps
    }: {
      children: ReactNode
      content: ReactNode
      contentProps?: { className?: string }
      delayDuration?: number
      open?: boolean
      side?: string
      sideOffset?: number
      triggerProps?: Record<string, unknown>
    }) => (
      <>
        <span
          data-content-class-name={contentProps?.className}
          data-delay-duration={delayDuration}
          data-open={String(Boolean(open))}
          data-side={side}
          data-side-offset={sideOffset}
          data-testid="composer-message-token-tooltip">
          {React.isValidElement(children)
            ? // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild trigger props
              React.cloneElement(children, {
                ...triggerProps,
                'data-tooltip-trigger': 'true'
              } as Record<string, unknown>)
            : children}
        </span>
        {createPortal(<span data-testid="composer-message-token-tooltip-content">{content}</span>, document.body)}
      </>
    ),
    Popover: ({ children, open }: { children: ReactNode; open?: boolean }) => {
      const triggerRef = React.useRef<HTMLElement | null>(null)

      return (
        <PopoverContext value={{ open: Boolean(open), triggerRef }}>
          <span data-open={String(Boolean(open))} data-testid="composer-message-token-popover">
            {children}
          </span>
        </PopoverContext>
      )
    },
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const { triggerRef } = React.use(PopoverContext)
      if (!React.isValidElement(children)) return children

      const childRef = (children.props as { ref?: Ref<HTMLElement> }).ref
      const setTriggerRef = (node: HTMLElement | null) => {
        triggerRef.current = node
        if (typeof childRef === 'function') {
          childRef(node)
        } else if (childRef) {
          childRef.current = node
        }
      }

      // eslint-disable-next-line @eslint-react/no-clone-element -- mock reproduces Radix asChild trigger props
      return React.cloneElement(children, {
        'data-popover-trigger': 'true',
        ref: setTriggerRef
      } as Record<string, unknown>)
    },
    PopoverContent: ({
      ref,
      children,
      className,
      align,
      side,
      sideOffset,
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      ref?: Ref<HTMLDivElement>
      align?: string
      side?: string
      sideOffset?: number
      onOpenAutoFocus?: (event: Event) => void
      onCloseAutoFocus?: (event: Event) => void
    }) => {
      const { open, triggerRef } = React.use(PopoverContext)
      const contentRef = React.useRef<HTMLDivElement | null>(null)
      const previousOpenRef = React.useRef(open)

      React.useEffect(() => {
        if (!open) return

        let defaultPrevented = false
        onOpenAutoFocus?.({
          preventDefault: () => {
            defaultPrevented = true
          }
        } as Event)

        if (!defaultPrevented) {
          contentRef.current?.focus()
        }
      }, [onOpenAutoFocus, open])

      React.useEffect(() => {
        if (previousOpenRef.current && !open) {
          let defaultPrevented = false
          onCloseAutoFocus?.({
            preventDefault: () => {
              defaultPrevented = true
            }
          } as Event)

          if (!defaultPrevented) {
            triggerRef.current?.focus()
          }
        }
        previousOpenRef.current = open
      }, [onCloseAutoFocus, open, triggerRef])

      if (!open) return null

      const setContentRef = (node: HTMLDivElement | null) => {
        contentRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      }

      return (
        <div
          {...props}
          ref={setContentRef}
          tabIndex={-1}
          className={className}
          data-align={align}
          data-side={side}
          data-side-offset={sideOffset}
          data-testid="composer-message-token-popover-content">
          {children}
        </div>
      )
    },
    Scrollbar: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>
  }
})

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => mockTranslations[key as keyof typeof mockTranslations] ?? key
  })
}))

// Mock citation utilities. Only the tag-emitting entry points are stubbed — the marker pattern and
// the code-block-aware walker stay real so the strip path under test behaves like production.
vi.mock('@renderer/utils/citation', async (importOriginal) => ({
  ...(await importOriginal<typeof CitationUtils>()),
  toTooltipCitation: vi.fn((citation: Citation) => citation),
  withCitationTags: vi.fn((content: string, citations: any[]) => {
    if (citations.length > 0) {
      return `${content} [processed-citations]`
    }
    return content
  }),
  determineCitationSource: vi.fn((citationReferences: any[]) => {
    if (citationReferences?.length) {
      const validReference = citationReferences.find((ref) => ref.citationBlockSource)
      return validReference?.citationBlockSource
    }
    return undefined
  })
}))

// Mock Markdown component
const capturedChatMarkdownProps = vi.hoisted(() => [] as any[])

vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedChatMarkdownProps.push(props)
    const { block, inlineHtmlPreviewMode, postProcess, components } = props
    const content = postProcess ? postProcess(block.content) : block.content
    const tokenPlaceholderPattern =
      /<span data-composer-token-index="(\d+)" data-composer-token-block="([^"]+)"><\/span>/g
    const nodes: any[] = []
    let cursor = 0
    for (const match of content.matchAll(tokenPlaceholderPattern)) {
      const index = match.index ?? 0
      if (index > cursor) nodes.push(content.slice(cursor, index))
      const tokenIndex = match[1]
      const tokenBlock = match[2]
      nodes.push(
        <Fragment key={`token-${tokenIndex}-${index}`}>
          {components?.span?.({
            dataComposerTokenIndex: tokenIndex,
            dataComposerTokenBlock: tokenBlock,
            children: null
          }) ?? match[0]}
        </Fragment>
      )
      cursor = index + match[0].length
    }
    if (cursor < content.length) nodes.push(content.slice(cursor))

    return (
      <div data-testid="mock-markdown" data-content={content} data-inline-html-preview-mode={inlineHtmlPreviewMode}>
        Markdown: {nodes}
      </div>
    )
  }
}))

describe('MainTextBlock', () => {
  let mockWithCitationTags: any
  let mockDetermineCitationSource: any

  beforeEach(async () => {
    vi.clearAllMocks()
    capturedChatMarkdownProps.length = 0

    const { withCitationTags, determineCitationSource } = await import('@renderer/utils/citation')
    mockWithCitationTags = withCitationTags as any
    mockDetermineCitationSource = determineCitationSource as any

    mockRenderConfig.renderInputMessageAsMarkdown = false
  })

  // Helper functions
  const renderMainTextBlock = (props: {
    id?: string
    content: string
    inlineHtmlPreviewMode?: 'generating' | 'ready'
    isStreaming?: boolean
    citations?: Citation[]
    citationReferences?: { citationBlockId?: string; citationBlockSource?: any }[]
    role: 'user' | 'assistant'
    mentions?: Model[]
    composer?: ComposerMessageSnapshot
    readOnlyFilePreviews?: ReadonlyMap<string, ReadOnlyComposerFileTokenPreview>
  }) => {
    return render(
      <MainTextBlock
        id={props.id ?? 'test-block-1'}
        content={props.content}
        inlineHtmlPreviewMode={props.inlineHtmlPreviewMode}
        isStreaming={props.isStreaming ?? false}
        citations={props.citations}
        citationReferences={props.citationReferences}
        role={props.role}
        mentions={props.mentions}
        composer={props.composer}
        readOnlyFilePreviews={props.readOnlyFilePreviews}
      />
    )
  }

  const getRenderedMarkdown = () => screen.queryByTestId('mock-markdown')
  const getRenderedPlainText = () => screen.queryByRole('paragraph')

  describe('basic rendering', () => {
    it('should render in markdown mode for assistant messages', () => {
      renderMainTextBlock({ content: 'Assistant response', role: 'assistant' })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: Assistant response')).toBeInTheDocument()
      expect(getRenderedPlainText()).not.toBeInTheDocument()
    })

    it('keeps inline HTML generating until smoothed content reaches the completed source', () => {
      const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
      const view = render(
        <MainTextBlock
          id="html-block"
          content="```html\n<div>"
          inlineHtmlPreviewMode="generating"
          isStreaming
          role="assistant"
        />
      )

      try {
        view.rerender(
          <MainTextBlock
            id="html-block"
            content="```html\n<div>Complete</div>\n```"
            inlineHtmlPreviewMode="ready"
            isStreaming={false}
            role="assistant"
          />
        )

        expect(getRenderedMarkdown()).toHaveAttribute('data-inline-html-preview-mode', 'generating')
      } finally {
        view.unmount()
        requestAnimationFrameSpy.mockRestore()
      }
    })

    it('renders completed inline HTML as ready when no smoothed content is pending', () => {
      renderMainTextBlock({
        content: '```html\n<div>Complete</div>\n```',
        inlineHtmlPreviewMode: 'ready',
        role: 'assistant'
      })

      expect(getRenderedMarkdown()).toHaveAttribute('data-inline-html-preview-mode', 'ready')
    })

    it('should render in plain text mode for user messages when setting disabled', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({ content: 'User message\nWith line breaks', role: 'user' })

      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedPlainText()!.textContent).toBe('User message\nWith line breaks')
      expect(getRenderedMarkdown()).not.toBeInTheDocument()
    })

    it('should render user messages as markdown when setting enabled', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({ content: 'User **bold** content', role: 'user' })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: User **bold** content')).toBeInTheDocument()
    })

    it('should preserve composer token rendering when markdown rendering is enabled for user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: '> quoted line\n\nReply',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'quote-1',
              kind: 'quote',
              label: 'Quote',
              description: 'quoted line',
              index: 0,
              textOffset: 0,
              promptText: '> quoted line'
            }
          ]
        }
      })

      const markdown = getRenderedMarkdown()!
      expect(markdown).toBeInTheDocument()
      expect(markdown).toHaveAttribute(
        'data-content',
        '<span data-composer-token-index="0" data-composer-token-block="test-block-1"></span>\n\nReply'
      )
      expect(markdown).toHaveTextContent('Quote')
      expect(markdown).toHaveTextContent('Reply')
      expect(markdown).not.toHaveTextContent('> quoted line')
      expect(markdown.querySelector('[data-composer-token-kind="quote"]')).toBeInTheDocument()
    })

    it('should preserve link token rendering in sent user messages', () => {
      const url = 'https://www.example.com/docs'
      renderMainTextBlock({
        content: url,
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'link-token-1',
              kind: 'link',
              label: 'example.com/docs',
              index: 0,
              textOffset: 0,
              promptText: url
            }
          ]
        }
      })

      expect(screen.getByRole('link', { name: url })).toHaveTextContent('example.com/docs')
      expect(document.querySelector('[data-composer-link-favicon]')).toBeInTheDocument()
      expect(getRenderedPlainText()).not.toHaveTextContent(url)
    })

    it('should keep quote token tooltip content in markdown-rendered user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: '<blockquote>\n\nSelected message text\n</blockquote>\n\nReply',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'quote-1',
              kind: 'quote',
              label: 'Quote',
              index: 0,
              textOffset: 0,
              promptText: '<blockquote>\n\nSelected message text\n</blockquote>'
            }
          ]
        }
      })

      expect(screen.getByTestId('composer-message-token-tooltip-content')).toHaveTextContent('Selected message text')
      expect(screen.getByTestId('composer-message-token-tooltip-content')).not.toHaveTextContent('<blockquote>')
    })

    it('should render stale quote composer metadata as plain text in markdown mode', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: 'Edited quoted line\n\nReply',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'quote-1',
              kind: 'quote',
              label: 'Quote',
              description: 'quoted line',
              index: 0,
              textOffset: 0,
              promptText: '> quoted line'
            }
          ]
        }
      })

      const markdown = getRenderedMarkdown()!
      expect(markdown).toHaveAttribute('data-content', 'Edited quoted line\n\nReply')
      expect(markdown.querySelector('[data-composer-token-kind="quote"]')).not.toBeInTheDocument()
    })

    it('should render stale quote composer metadata as plain text in plain text mode', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Edited quoted line\n\nReply',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'quote-1',
              kind: 'quote',
              label: 'Quote',
              description: 'quoted line',
              index: 0,
              textOffset: 0,
              promptText: '> quoted line'
            }
          ]
        }
      })

      expect(screen.getByText('Edited quoted line Reply')).toBeInTheDocument()
      expect(document.querySelector('[data-composer-token-kind="quote"]')).not.toBeInTheDocument()
    })

    it('should preserve complex formatting in plain text mode', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      const complexContent = `Line 1
  Indented line
**Bold not parsed**
- List not parsed`

      renderMainTextBlock({ content: complexContent, role: 'user' })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe(complexContent)
    })

    it('should not show the collapse toggle for user messages with up to five effective lines', () => {
      const fiveEffectiveLines = ['Line 1', '', 'Line 2', 'Line 3', 'Line 4', 'Line 5'].join('\n')

      renderMainTextBlock({ content: fiveEffectiveLines, role: 'user' })

      expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument()
      expect(document.body).toHaveTextContent('Line 5')
    })

    it('should preview the first five effective lines for long plain text user messages', () => {
      const longContent = [
        'Line 1',
        '',
        '',
        'Line 2',
        'Line 3',
        'Line 4',
        'Line 5',
        'Line 6',
        'Line 7',
        'Line 8',
        'Line 9',
        'Line 10',
        'Line 11'
      ].join('\n')

      renderMainTextBlock({ content: longContent, role: 'user' })

      const content = screen
        .getByText(/Line 1/)
        .closest('[data-user-message-collapsible-content-preview]') as HTMLElement
      const button = screen.getByRole('button', { name: 'Expand' })

      expect(content.style.maxHeight).toBe('')
      expect(content.style.overflow).toBe('')
      expect(content.textContent).toContain('Line 1\n\n\nLine 2')
      expect(document.body).toHaveTextContent('Line 5')
      expect(document.body).not.toHaveTextContent('Line 6')
      expect(button).toHaveAttribute('aria-expanded', 'false')

      fireEvent.click(button)

      expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true')
      expect(document.body).toHaveTextContent('Line 11')
    })

    it('should preview long markdown-rendered user messages without rendering the full markdown DOM', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: Array.from({ length: 11 }, (_, index) => `User **bold** content ${index + 1}`).join('\n'),
        role: 'user'
      })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
      expect(getRenderedMarkdown()).toHaveAttribute(
        'data-content',
        Array.from({ length: 5 }, (_, index) => `User **bold** content ${index + 1}`).join('\n')
      )
      expect(getRenderedMarkdown()).not.toHaveAttribute('data-content', expect.stringContaining('content 11'))
    })

    it('should preview long user messages that render composer tokens', () => {
      const tokenPrefix = 'Intro line\n\n\nOpen '
      const content = [tokenPrefix + 'src/chat.ts now']
        .concat(Array.from({ length: 9 }, (_, index) => `Line ${index + 3}`))
        .join('\n')
      renderMainTextBlock({
        content,
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-1',
              kind: 'file',
              label: 'chat.ts',
              index: 0,
              textOffset: tokenPrefix.length,
              promptText: 'src/chat.ts'
            }
          ]
        }
      })

      expect(document.querySelector('[data-composer-token-kind="file"]')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
      expect(document.body).toHaveTextContent('Line 5')
      expect(document.body).not.toHaveTextContent('Line 6')
    })

    it('does not collapse a short visible message because a reference token contains a long transcript', () => {
      const promptText = `<referenced-conversation type="topic" name="Project">
[user]
Old question

[assistant]
Old answer

[user]
More context
</referenced-conversation>`
      renderMainTextBlock({
        content: `${promptText} Start the demo`,
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'reference:topic:project',
              kind: 'reference',
              label: 'Project',
              index: 0,
              textOffset: 0,
              promptText
            }
          ]
        }
      })

      expect(document.querySelector('[data-composer-token-kind="reference"]')).toHaveTextContent('Project')
      expect(document.body).toHaveTextContent('Start the demo')
      expect(document.body).not.toHaveTextContent('Old question')
      expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
    })

    it('collapses long visible content after a reference token without exposing its transcript', () => {
      const promptText = `<referenced-conversation type="topic" name="Project">
[user]
Hidden question

[assistant]
Hidden answer
</referenced-conversation>`
      renderMainTextBlock({
        content: `${promptText} ${Array.from({ length: 7 }, (_, index) => `Visible line ${index + 1}`).join('\n')}`,
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'reference:topic:project',
              kind: 'reference',
              label: 'Project',
              index: 0,
              textOffset: 0,
              promptText
            }
          ]
        }
      })

      expect(document.querySelector('[data-composer-token-kind="reference"]')).toHaveTextContent('Project')
      expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
      expect(document.body).toHaveTextContent('Visible line 5')
      expect(document.body).not.toHaveTextContent('Visible line 6')
      expect(document.body).not.toHaveTextContent('Hidden question')
    })

    it('should not collapse assistant messages', () => {
      const content = Array.from({ length: 11 }, (_, index) => `Assistant response ${index + 1}`).join('\n')
      renderMainTextBlock({ content, role: 'assistant' })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(document.body).toHaveTextContent('Assistant response 11')
      expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
    })

    it('should render composer tokens as inline chips without leaking hidden prompt text', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Open src/chat.ts now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-1',
              kind: 'file',
              label: 'chat.ts',
              index: 0,
              textOffset: 5,
              promptText: 'src/chat.ts'
            }
          ]
        }
      })

      const textElement = getRenderedPlainText()!
      expect(textElement).toHaveTextContent('Open chat.ts now')
      expect(textElement).not.toHaveTextContent('src/chat.ts')
      const token = textElement.querySelector('[data-composer-token-kind="file"]')
      expect(token).toBeInTheDocument()
      expect(token?.querySelector('[data-file-token-icon="code"]')).toBeInTheDocument()
    })

    it('should render composer tokens while preserving markdown for user text segments', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: 'Use the find-skills skill. **hello**',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'skill:find-skills',
              kind: 'skill',
              label: 'find-skills',
              index: 0,
              textOffset: 0,
              promptText: 'Use the find-skills skill.'
            }
          ]
        }
      })

      const markdown = getRenderedMarkdown()!
      expect(markdown).toBeInTheDocument()
      expect(markdown).toHaveAttribute(
        'data-content',
        '<span data-composer-token-index="0" data-composer-token-block="test-block-1"></span> **hello**'
      )
      expect(markdown).toHaveTextContent('Markdown: find-skills **hello**')
      expect(markdown).not.toHaveTextContent('Use the find-skills skill.')
      expect(markdown.querySelector('[data-composer-token-kind="skill"]')).toBeInTheDocument()
    })

    it('should render file composer tokens through ComposerToken in markdown mode', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({
        content: 'Open src/chat.ts **now**',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-1',
              kind: 'file',
              label: 'chat.ts',
              index: 0,
              textOffset: 5,
              promptText: 'src/chat.ts'
            }
          ]
        }
      })

      const markdown = getRenderedMarkdown()!
      expect(markdown).toBeInTheDocument()
      expect(markdown).toHaveAttribute(
        'data-content',
        'Open <span data-composer-token-index="0" data-composer-token-block="test-block-1"></span> **now**'
      )
      expect(markdown).toHaveTextContent('Markdown: Open chat.ts **now**')
      expect(markdown).not.toHaveTextContent('src/chat.ts')
      const token = markdown.querySelector('[data-composer-token-kind="file"]')
      expect(token).toBeInTheDocument()
      expect(token?.querySelector('[data-file-token-icon="code"]')).toBeInTheDocument()
    })

    it('should preserve the pdf file token variant in sent messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Read test.pdf now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-pdf',
              kind: 'file',
              label: 'test.pdf',
              index: 0,
              textOffset: 5,
              promptText: 'test.pdf',
              payload: {
                type: 'document',
                ext: '.pdf',
                name: 'test.pdf',
                origin_name: 'test.pdf',
                size: 2048
              }
            }
          ]
        }
      })

      const token = getRenderedPlainText()!.querySelector('[data-composer-token-kind="file"]')
      expect(token).toHaveAttribute('data-file-token-variant', 'pdf')
      expect(token?.querySelector('[data-file-token-icon="pdf"]')).toBeInTheDocument()
    })

    it.each([false, true])(
      'should show the linked internal file path and size after send when markdown mode is %s',
      (renderAsMarkdown) => {
        mockRenderConfig.renderInputMessageAsMarkdown = renderAsMarkdown
        renderMainTextBlock({
          content: 'Read /Users/jd/private/report.pdf now',
          role: 'user',
          composer: {
            version: 1,
            tokens: [
              {
                id: 'file:source-report',
                kind: 'file',
                label: 'report.pdf',
                index: 0,
                textOffset: 5,
                promptText: '/Users/jd/private/report.pdf',
                payload: {
                  type: 'document',
                  ext: '.pdf',
                  name: 'report.pdf',
                  origin_name: 'report.pdf',
                  size: 2048
                }
              }
            ]
          },
          readOnlyFilePreviews: new Map([
            [
              'source-report',
              {
                url: 'file:///internal/message-files/report.pdf',
                mediaType: 'application/pdf'
              }
            ]
          ])
        })

        const token = document.querySelector('[data-composer-token-kind="file"]') as HTMLElement
        const tooltip = screen.getByTestId('composer-message-token-tooltip')
        const tooltipContent = screen.getByTestId('composer-message-token-tooltip-content')

        expect(token).not.toHaveAttribute('title')
        expect(token).toHaveAttribute('data-tooltip-trigger', 'true')
        expect(token).toHaveAttribute('tabindex', '0')
        expect(token).toHaveAccessibleName('report.pdf')
        expect(tooltip).toHaveAttribute('data-delay-duration', '300')
        expect(tooltip).toHaveAttribute('data-side', 'top')
        expect(tooltip).toHaveAttribute('data-side-offset', '6')
        expect(tooltipContent.querySelector('[data-token-path]')).toHaveTextContent(
          '/internal/message-files/report.pdf'
        )
        expect(tooltipContent.querySelector('[data-token-size]')).toHaveTextContent('2 KB')
        expect(document.body).not.toHaveTextContent('/Users/jd/private/report.pdf')

        token.focus()
        expect(token).toHaveFocus()
      }
    )

    it('should open the shared image preview when a sent image token is activated', async () => {
      const user = userEvent.setup()
      renderMainTextBlock({
        content: 'View photo.png now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file:source-photo',
              kind: 'file',
              label: 'photo.png',
              index: 0,
              textOffset: 5,
              promptText: 'photo.png',
              payload: {
                type: 'image',
                ext: '.png',
                name: 'photo.png',
                origin_name: 'photo.png',
                size: 1024
              }
            }
          ]
        },
        readOnlyFilePreviews: new Map([
          ['source-photo', { url: 'file:///internal/message-files/photo.png', mediaType: 'image/png' }]
        ])
      })

      const token = document.querySelector('[data-composer-token-kind="file"]') as HTMLElement
      const trigger = token.closest('[data-popover-trigger="true"]') as HTMLElement
      expect(token).not.toHaveAttribute('title')
      expect(trigger).toHaveAttribute('role', 'button')
      expect(trigger).toHaveAttribute('tabindex', '0')

      await user.click(trigger)
      expect(imagePreviewShowMock).toHaveBeenCalledWith('file:///internal/message-files/photo.png')
      expect(screen.queryByTestId('composer-message-token-popover-content')).toBeNull()

      trigger.focus()
      await user.keyboard('{Enter}')
      expect(imagePreviewShowMock).toHaveBeenCalledTimes(2)
      expect(imagePreviewShowMock).toHaveBeenLastCalledWith('file:///internal/message-files/photo.png')
      expect(screen.queryByTestId('composer-message-token-popover-content')).toBeNull()
    })

    it('should apply the shared dangerous-file safety rule to a linked sent image preview', async () => {
      const user = userEvent.setup()
      renderMainTextBlock({
        content: 'View icon.svg now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file:source-icon',
              kind: 'file',
              label: 'icon.svg',
              index: 0,
              textOffset: 5,
              promptText: 'icon.svg',
              payload: {
                type: 'image',
                ext: '.svg',
                name: 'icon.svg',
                origin_name: 'icon.svg',
                size: 1024
              }
            }
          ]
        },
        readOnlyFilePreviews: new Map([
          ['source-icon', { url: 'file:///internal/message-files/icon.svg', mediaType: 'image/svg+xml' }]
        ])
      })

      const token = document.querySelector('[data-composer-token-kind="file"]') as HTMLElement
      const trigger = token.closest('[data-popover-trigger="true"]') as HTMLElement
      await user.click(trigger)

      expect(imagePreviewShowMock).toHaveBeenCalledWith('file:///internal/message-files')
    })

    it('should preview sent pasted text from the linked internal file without persisting its path', async () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      const readText = vi.fn().mockResolvedValue('Persisted pasted text preview')
      Object.defineProperty(window, 'api', {
        configurable: true,
        value: {
          ...window.api,
          fs: { ...window.api?.fs, readText }
        }
      })

      renderMainTextBlock({
        content: 'Read pasted text.txt now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file:source-pasted-text',
              kind: 'file',
              label: 'pasted text.txt',
              index: 0,
              textOffset: 5,
              promptText: 'pasted text.txt',
              payload: {
                type: 'text',
                ext: '.txt',
                name: 'pasted_text.txt',
                origin_name: 'pasted text.txt',
                size: 4096
              }
            }
          ]
        },
        readOnlyFilePreviews: new Map([
          [
            'source-pasted-text',
            {
              url: 'file:///internal/message-files/pasted%20text.txt',
              mediaType: 'text/plain',
              composerFileKind: 'pasted-text'
            }
          ]
        ])
      })

      const token = document.querySelector('[data-composer-token-kind="file"]') as HTMLElement
      const trigger = token.closest('[data-popover-trigger="true"]') as HTMLElement
      trigger.focus()
      fireEvent.keyDown(trigger, { key: ' ' })

      await waitFor(() =>
        expect(screen.getByTestId('composer-message-token-popover-content')).toHaveTextContent(
          'Persisted pasted text preview'
        )
      )
      expect(readText).toHaveBeenCalledWith('/internal/message-files/pasted text.txt')
      expect(screen.getByTestId('composer-message-token-popover-content')).not.toHaveTextContent(
        '/internal/message-files/pasted text.txt'
      )
      expect(token).not.toHaveAttribute('title')

      fireEvent.keyDown(trigger, { key: 'Escape' })
      expect(screen.queryByTestId('composer-message-token-popover-content')).toBeNull()
      expect(trigger).toHaveFocus()
    })

    it('keeps command tokens on the legacy chip renderer and reference tokens on the composer chip', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Run docs',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'command:web-search',
              kind: 'command',
              label: 'web-search',
              index: 0,
              textOffset: 0,
              promptText: 'Run'
            },
            {
              id: 'reference:docs',
              kind: 'reference',
              label: 'Docs',
              index: 1,
              textOffset: 4,
              promptText: 'docs'
            }
          ]
        }
      })

      const textElement = getRenderedPlainText()!
      expect(textElement).toHaveTextContent('web-search Docs')
      expect(textElement.querySelector('[data-composer-token-kind="command"]')).toBeInTheDocument()
      expect(textElement.querySelector('[data-composer-token-kind="reference"]')).toBeInTheDocument()
    })

    it('should ignore unsupported raw composer metadata tokens in user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Ask now',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'model-1',
              kind: 'model',
              label: 'GPT',
              index: 0,
              textOffset: 0
            },
            {
              id: 'mcp-prompt-1',
              kind: 'mcpPrompt',
              label: 'Prompt',
              index: 1,
              textOffset: 0
            },
            {
              id: 'mcp-resource-1',
              kind: 'mcpResource',
              label: 'Resource',
              index: 2,
              textOffset: 0
            },
            {
              id: 'environment-1',
              kind: 'environment',
              label: 'Computer',
              index: 3,
              textOffset: 0
            }
          ]
        } as never
      })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe('Ask now')
      expect(textElement).not.toHaveTextContent('GPT')
      expect(textElement).not.toHaveTextContent('Prompt')
      expect(textElement).not.toHaveTextContent('Resource')
      expect(textElement).not.toHaveTextContent('Computer')
      expect(textElement.querySelector('[data-composer-token-kind="model"]')).not.toBeInTheDocument()
      expect(textElement.querySelector('[data-composer-token-kind="mcpPrompt"]')).not.toBeInTheDocument()
      expect(textElement.querySelector('[data-composer-token-kind="mcpResource"]')).not.toBeInTheDocument()
      expect(textElement.querySelector('[data-composer-token-kind="environment"]')).not.toBeInTheDocument()
    })

    it('should ignore prompt-variable composer metadata in user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Route from Shanghai',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'prompt-variable:0:from',
              kind: 'promptVariable',
              label: 'from',
              index: 0,
              textOffset: 11,
              promptText: 'Shanghai'
            }
          ]
        } as never
      })

      const textElement = getRenderedPlainText()!
      expect(textElement.textContent).toBe('Route from Shanghai')
      expect(textElement.querySelector('[data-composer-token-kind="promptVariable"]')).not.toBeInTheDocument()
    })
  })

  describe('mentions functionality', () => {
    it('should display model mentions when provided', () => {
      const mentions = [
        { id: 'model-1', name: 'deepseek-r1', provider: 'test' } as Model,
        { id: 'model-2', name: 'claude-sonnet-4', provider: 'test' } as Model
      ]

      renderMainTextBlock({ content: 'Content with mentions', role: 'assistant', mentions })

      expect(screen.getByText('@deepseek-r1')).toBeInTheDocument()
      expect(screen.getByText('@claude-sonnet-4')).toBeInTheDocument()
    })
  })

  describe('citation processing', () => {
    it('should process content with citations when all conditions are met', () => {
      const citations: Citation[] = [
        { number: 1, url: 'https://example.com', title: 'Example Citation', content: 'Citation content' }
      ]
      const citationReferences = [{ citationBlockSource: WEB_SEARCH_SOURCE.OPENAI }]

      renderMainTextBlock({
        content: 'Content with citation [1]',
        role: 'assistant',
        citations,
        citationReferences
      })

      expect(mockDetermineCitationSource).toHaveBeenCalledWith(citationReferences)
      expect(mockWithCitationTags).toHaveBeenCalledWith(
        'Content with citation [1]',
        citations,
        WEB_SEARCH_SOURCE.OPENAI
      )
      expect(screen.getByText('Markdown: Content with citation [1] [processed-citations]')).toBeInTheDocument()
    })

    it('should skip citation processing when no citationReferences', () => {
      renderMainTextBlock({ content: 'Content [1]', role: 'assistant', citations: [] })

      expect(getRenderedMarkdown()).toBeInTheDocument()
      expect(screen.getByText('Markdown: Content [1]')).toBeInTheDocument()
      expect(mockWithCitationTags).not.toHaveBeenCalled()
    })

    it('should skip citation processing when no citations data', () => {
      const citationReferences = [{ citationBlockSource: 'DEFAULT' as any }]

      renderMainTextBlock({
        content: 'Content [1]',
        role: 'assistant',
        citations: [],
        citationReferences
      })

      expect(screen.getByText('Markdown: Content [1]')).toBeInTheDocument()
      expect(mockWithCitationTags).not.toHaveBeenCalled()
    })

    // #19771: the reported answer reused a `[cite:…]` id minted by an earlier turn, so this
    // message resolved no citation of its own and the internal id was printed verbatim.
    it('drops [cite:id] markers from an assistant message that resolved no citation', () => {
      renderMainTextBlock({
        content: '1. 工程立项审计；[cite:2598d0ab-1]\n2. 工程采购审计；[cite:2598d0ab-1]',
        role: 'assistant'
      })

      expect(getRenderedMarkdown()).toHaveAttribute('data-content', '1. 工程立项审计；\n2. 工程采购审计；')
    })

    it('keeps a literal [cite:id] typed by the user', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      renderMainTextBlock({ content: 'What does [cite:2598d0ab-1] mean?', role: 'user' })

      expect(getRenderedMarkdown()).toHaveAttribute('data-content', 'What does [cite:2598d0ab-1] mean?')
    })
  })

  describe('prop identity stability', () => {
    // A fresh trustedCitations array per render cascades into ChatMarkdown's
    // Streamdown components map and forces every markdown block to re-parse
    // and re-animate on each streaming tick.
    it('keeps trustedCitations identity stable across re-renders without citations', () => {
      const view = render(
        <MainTextBlock id="stable-1" content="chunk one" isStreaming role="assistant" citations={[]} />
      )
      view.rerender(<MainTextBlock id="stable-1" content="chunk one two" isStreaming role="assistant" citations={[]} />)

      expect(capturedChatMarkdownProps.length).toBeGreaterThanOrEqual(2)
      const [first, ...rest] = capturedChatMarkdownProps
      expect(first.trustedCitations).toEqual([])
      for (const props of rest) {
        expect(props.trustedCitations).toBe(first.trustedCitations)
      }
    })
  })
})

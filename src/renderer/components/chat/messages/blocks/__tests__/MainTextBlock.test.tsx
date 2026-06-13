import type * as CherryUI from '@cherrystudio/ui'
import type { Citation, Model } from '@renderer/types'
import { WEB_SEARCH_SOURCE } from '@renderer/types'
import type { ComposerMessageSnapshot } from '@shared/data/types/uiParts'
import { fireEvent, render, screen } from '@testing-library/react'
import { Fragment, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MainTextBlock from '../MainTextBlock'

// Mock dependencies
const mockRenderConfig = vi.hoisted(() => ({
  renderInputMessageAsMarkdown: false
}))

const mockTranslations = vi.hoisted(() => ({
  'message.message.user_content.expand': 'Expand',
  'message.message.user_content.collapse': 'Collapse'
}))

vi.mock('../../MessageListProvider', () => ({
  useMessageRenderConfig: () => mockRenderConfig,
  useOptionalMessageListActions: () => undefined
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryUI>()
  const { createPortal } = await import('react-dom')
  return {
    ...actual,
    Flex: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div className={className}>{children}</div>
    ),
    NormalTooltip: ({
      children,
      content,
      contentProps
    }: {
      children: ReactNode
      content: ReactNode
      contentProps?: { className?: string }
    }) => (
      <>
        <span data-content-class-name={contentProps?.className} data-testid="composer-message-token-tooltip">
          {children}
        </span>
        {createPortal(<span data-testid="composer-message-token-tooltip-content">{content}</span>, document.body)}
      </>
    )
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

// Mock citation utilities
vi.mock('@renderer/utils/citation', () => ({
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
vi.mock('@renderer/components/chat/messages/markdown/ChatMarkdown', () => ({
  __esModule: true,
  default: ({ block, postProcess, components }: any) => {
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
      <div data-testid="mock-markdown" data-content={content}>
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

    const { withCitationTags, determineCitationSource } = await import('@renderer/utils/citation')
    mockWithCitationTags = withCitationTags as any
    mockDetermineCitationSource = determineCitationSource as any

    mockRenderConfig.renderInputMessageAsMarkdown = false
  })

  // Helper functions
  const renderMainTextBlock = (props: {
    id?: string
    content: string
    isStreaming?: boolean
    citations?: Citation[]
    citationReferences?: { citationBlockId?: string; citationBlockSource?: any }[]
    role: 'user' | 'assistant'
    mentions?: Model[]
    composer?: ComposerMessageSnapshot
  }) => {
    return render(
      <MainTextBlock
        id={props.id ?? 'test-block-1'}
        content={props.content}
        isStreaming={props.isStreaming ?? false}
        citations={props.citations}
        citationReferences={props.citationReferences}
        role={props.role}
        mentions={props.mentions}
        composer={props.composer}
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

    it('should render in plain text mode for user messages when setting disabled', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({ content: 'User message\nWith line breaks', role: 'user' })

      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedPlainText()!.textContent).toBe('User message\nWith line breaks')
      expect(getRenderedMarkdown()).not.toBeInTheDocument()

      const textElement = getRenderedPlainText()!
      expect(textElement).toHaveStyle({ whiteSpace: 'pre-wrap' })
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
      expect(textElement).toHaveClass('markdown')
    })

    it('should handle empty content gracefully', () => {
      expect(() => {
        renderMainTextBlock({ content: '', role: 'assistant' })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
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
      expect(content).toHaveClass('[&>*:last-child]:mb-0!', '[&_.markdown>*:last-child]:mb-0!')
      expect(content.textContent).toContain('Line 1\n\n\nLine 2')
      expect(document.body).toHaveTextContent('Line 5')
      expect(document.body).not.toHaveTextContent('Line 6')
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(button).toHaveClass(
        'flex',
        'min-h-7',
        'w-full',
        'items-center',
        'justify-start',
        'gap-1.5',
        'bg-transparent',
        'px-0',
        'py-0.5',
        'text-left'
      )

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
      expect(token).toHaveClass(
        'h-6',
        'max-w-52',
        'items-center',
        'rounded-md',
        'border',
        'border-border',
        'bg-background',
        'hover:bg-accent',
        'leading-[inherit]'
      )
      expect(token).not.toHaveClass('text-primary')
      expect(token?.querySelector('[data-file-token-icon="fallback"]')).toHaveClass(
        'size-4.5',
        'rounded-[5px]',
        'bg-accent',
        'text-muted-foreground'
      )
    })

    it('should keep long composer token labels on one truncated line in sent messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      const longLabel = 'temp_file_d1a6ca94-e012-4c9e-831a-24cda5f732f0_image.png'

      renderMainTextBlock({
        content: `Open ${longLabel} now`,
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-long',
              kind: 'file',
              label: longLabel,
              index: 0,
              textOffset: 5,
              promptText: longLabel
            }
          ]
        }
      })

      const chip = getRenderedPlainText()!.querySelector('[data-composer-token-kind="file"]')
      const label = chip?.querySelector('span.truncate')
      expect(chip).toHaveClass('max-w-52', 'overflow-hidden')
      expect(label).toHaveClass('min-w-0', 'max-w-full', 'truncate', 'whitespace-nowrap!', 'break-normal')
    })

    it('should keep long file composer tokens truncated in markdown user messages', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = true
      const longLabel = 'temp_file_d1a6ca94-e012-4c9e-831a-24cda5f732f0_pasted_text.txt'

      renderMainTextBlock({
        content: `Open ${longLabel} now`,
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'file-long',
              kind: 'file',
              label: longLabel,
              index: 0,
              textOffset: 5,
              promptText: longLabel
            }
          ]
        }
      })

      const chip = getRenderedMarkdown()!.querySelector('[data-composer-token-kind="file"]')
      const label = chip?.querySelector('span.truncate')
      expect(chip).toHaveClass('max-w-52', 'overflow-hidden')
      expect(label).toHaveClass('min-w-0', 'max-w-full', 'truncate', 'whitespace-nowrap!', 'break-normal')
    })

    it('should render skill composer tokens with their own visual treatment', () => {
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({
        content: 'Use the pdf skill.',
        role: 'user',
        composer: {
          version: 1,
          tokens: [
            {
              id: 'skill:pdf',
              kind: 'skill',
              label: 'pdf',
              description: 'Read and analyze PDFs',
              index: 0,
              textOffset: 0,
              promptText: 'Use the pdf skill.'
            }
          ]
        }
      })

      const token = getRenderedPlainText()!.querySelector('[data-composer-token-kind="skill"]')
      expect(token).toBeInTheDocument()
      expect(token).toHaveClass('text-primary', 'leading-[inherit]')
      expect(token).not.toHaveClass('border-0', 'bg-transparent', 'rounded-md', 'px-1.5', 'py-0.5')
      expect(token?.querySelector('svg')).toHaveClass('text-current', 'opacity-80')
      expect(token?.querySelector('svg')?.parentElement).toHaveClass('translate-y-[0.08em]')
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
      expect(token).toHaveClass('h-6', 'rounded-md', 'border', 'border-border', 'bg-background')
      expect(token?.querySelector('[data-file-token-icon="fallback"]')).toBeInTheDocument()
    })

    it('should render document file composer tokens with the same document icon style as the composer', () => {
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
      expect(token).toHaveAttribute('data-file-token-variant', 'document')
      expect(token?.querySelector('[data-file-token-icon="document"]')).toHaveClass(
        'bg-[var(--color-error-bg)]',
        'text-destructive'
      )
    })

    it('should keep command and reference composer tokens on the legacy message chip renderer', () => {
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
      expect(textElement.querySelector('[data-composer-token-kind="command"]')).toHaveClass(
        'text-primary',
        'overflow-hidden'
      )
      expect(textElement.querySelector('[data-composer-token-kind="reference"]')).toHaveClass(
        'text-primary',
        'overflow-hidden'
      )
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

    it('should not display mentions when none provided', () => {
      renderMainTextBlock({ content: 'No mentions content', role: 'assistant', mentions: [] })
      expect(screen.queryAllByText(/@/)).toHaveLength(0)
    })

    it('should style mentions correctly for user visibility', () => {
      const mentions = [{ id: 'model-1', name: 'Test Model', provider: 'test' } as Model]

      renderMainTextBlock({ content: 'Styled mentions test', role: 'assistant', mentions })

      const mentionElement = screen.getByText('@Test Model')
      expect(mentionElement).toHaveClass('text-primary')
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

    it('should handle multiple citations gracefully', () => {
      const citations: Citation[] = [
        { number: 1, url: 'https://first.com', title: 'First' },
        { number: 2, url: 'https://second.com', title: 'Second' }
      ]
      const citationReferences = [{ citationBlockSource: 'DEFAULT' as any }]

      expect(() => {
        renderMainTextBlock({
          content: 'Multiple citations [1] and [2]',
          role: 'assistant',
          citations,
          citationReferences
        })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })

  describe('settings integration', () => {
    it('should respond to markdown rendering setting changes', () => {
      // Test with markdown enabled
      mockRenderConfig.renderInputMessageAsMarkdown = true
      const { unmount } = renderMainTextBlock({ content: 'Settings test content', role: 'user' })
      expect(getRenderedMarkdown()).toBeInTheDocument()
      unmount()

      // Test with markdown disabled
      mockRenderConfig.renderInputMessageAsMarkdown = false
      renderMainTextBlock({ content: 'Settings test content', role: 'user' })
      expect(getRenderedPlainText()).toBeInTheDocument()
      expect(getRenderedMarkdown()).not.toBeInTheDocument()
    })
  })

  describe('robustness', () => {
    it('should handle null and undefined values gracefully', () => {
      expect(() => {
        renderMainTextBlock({
          content: 'Null safety test',
          role: 'assistant',
          mentions: undefined,
          citations: undefined,
          citationReferences: undefined
        })
      }).not.toThrow()

      expect(getRenderedMarkdown()).toBeInTheDocument()
    })
  })
})

import type { Message } from '@renderer/types/newMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'

import { PartsProvider } from '../V2Contexts'

// ============================================================================
// Mocks — keep minimal, only mock what prevents module loading
// ============================================================================

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: vi.fn(() => [false, vi.fn()]) }))
vi.mock('@renderer/utils/messageUtils/is', () => ({
  isMessageProcessing: () => false,
  isMessageAwaitingApproval: () => false
}))
vi.mock('@renderer/types/file', () => ({
  FILE_TYPE: { IMAGE: 'image', VIDEO: 'video', AUDIO: 'audio', TEXT: 'text', DOCUMENT: 'document', OTHER: 'other' }
}))

// motion/react — provide motion.create so Spinner.tsx module loads
vi.mock('motion/react', () => {
  const Div = ({ ref, children, ...p }: any) => (
    <div ref={ref} {...p}>
      {children}
    </div>
  )
  const proxy = new Proxy({ div: Div, create: (C: any) => C }, { get: (t, k) => (t as any)[k] ?? Div })
  return { AnimatePresence: ({ children }: any) => <>{children}</>, motion: proxy }
})

vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: any) => <>{children}</>
}))

// Leaf component mocks — render data-testid with key props for assertions
vi.mock('@renderer/components/chat/messages/markdown/Markdown', () => ({
  __esModule: true,
  default: ({ block, postProcess }: any) => (
    <div data-testid="mock-markdown">{postProcess ? postProcess(block.content) : block.content}</div>
  ),
  MarkdownBlockContext: React.createContext(null)
}))

vi.mock('../ImageBlock', () => ({
  __esModule: true,
  default: ({ images, isSingle }: any) => (
    <div data-testid="mock-image-block" data-images={JSON.stringify(images)} data-single={String(isSingle)} />
  )
}))

vi.mock('../../Tools/MessageTools', () => ({
  __esModule: true,
  default: ({ toolResponse }: any) => (
    <div
      data-testid="mock-message-tools"
      data-status={toolResponse?.status}
      data-tool-type={toolResponse?.tool?.type}
      data-tool-name={toolResponse?.tool?.name}
      data-server-name={toolResponse?.tool?.serverName ?? ''}
    />
  )
}))

vi.mock('../../Tools/toolResponse', () => ({
  buildToolResponseFromPart: (part: any, fallbackId: string) => {
    const t = part.type as string
    if (!t.startsWith('tool-') && t !== 'dynamic-tool') return null
    const id = part.toolCallId || fallbackId
    const name = part.toolName || t.replace(/^tool-/, '') || 'unknown'
    const out = part.output
    const meta = out && typeof out === 'object' && out.metadata ? out.metadata : undefined
    const isMcp = meta?.type === 'mcp' || t === 'dynamic-tool'
    const status =
      part.state === 'output-available'
        ? 'done'
        : part.state === 'output-error'
          ? 'error'
          : part.state === 'input-available'
            ? 'invoking'
            : 'pending'
    return {
      id,
      toolCallId: id,
      tool: {
        id,
        name,
        type: isMcp ? 'mcp' : 'builtin',
        ...(isMcp ? { serverId: meta?.serverId ?? 'unknown', serverName: meta?.serverName ?? 'MCP' } : {})
      },
      arguments: part.input,
      status,
      response: part.state === 'output-error' ? { isError: true } : (out?.content ?? out)
    }
  }
}))

vi.mock('../../MessageVideo', () => ({
  __esModule: true,
  default: ({ url, filePath }: any) => (
    <div data-testid="mock-message-video" data-url={url ?? ''} data-file-path={filePath ?? ''} />
  )
}))

vi.mock('../ErrorBlock', () => ({
  __esModule: true,
  default: ({ error }: any) => <div data-testid="mock-error-block" data-error-message={error?.message ?? ''} />
}))

vi.mock('../../MessageAttachments', () => ({
  __esModule: true,
  default: ({ file }: any) => <div data-testid="mock-attachments" data-file-name={file?.name ?? ''} />
}))

vi.mock('../ToolBlockGroup', () => ({
  __esModule: true,
  default: ({ items }: any) => <div data-testid="mock-tool-group" data-count={items?.length ?? 0} />
}))

vi.mock('../BlockErrorFallback', () => ({ __esModule: true, default: () => null }))
vi.mock('../PlaceholderBlock', () => ({ __esModule: true, default: () => null }))

// ============================================================================
// Setup
// ============================================================================

import PartsRenderer from '../PartsRenderer'

const msg = (overrides: Partial<Message> = {}): Message =>
  ({
    id: 'msg-1',
    role: 'assistant',
    assistantId: 'a',
    topicId: 't',
    createdAt: '2026-01-01T00:00:00Z',
    type: 'text',
    status: 'success',
    blocks: [],
    ...overrides
  }) as Message

const renderParts = (parts: CherryMessagePart[], message?: Message) => {
  const m = message ?? msg()
  return render(
    <PartsProvider value={{ [m.id]: parts }}>
      <PartsRenderer message={m} />
    </PartsProvider>
  )
}

// ============================================================================
// Tests
// ============================================================================

describe('PartsRenderer', () => {
  // -- empty --
  it('renders nothing for empty parts', () => {
    const { container } = renderParts([])
    expect(container.innerHTML).toBe('')
  })

  // -- text --
  it('renders text part via Markdown', () => {
    renderParts([{ type: 'text', text: 'hello world' } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-markdown').textContent).toContain('hello world')
  })

  // -- data-code --
  it('renders data-code as markdown code fence', () => {
    renderParts([
      { type: 'data-code', data: { content: 'console.log(1)', language: 'js' } } as unknown as CherryMessagePart
    ])
    const md = screen.getByTestId('mock-markdown')
    expect(md.textContent).toContain('```js')
    expect(md.textContent).toContain('console.log(1)')
  })

  // -- images --
  it('renders single image with isSingle=true', () => {
    renderParts([
      { type: 'file', url: 'https://img.test/a.png', mediaType: 'image/png' } as unknown as CherryMessagePart
    ])
    const el = screen.getByTestId('mock-image-block')
    expect(el.getAttribute('data-single')).toBe('true')
    expect(el.getAttribute('data-images')).toBe('["https://img.test/a.png"]')
  })

  it('renders multiple images as group with isSingle=false', () => {
    renderParts([
      { type: 'file', url: 'https://img.test/a.png', mediaType: 'image/png' },
      { type: 'file', url: 'https://img.test/b.jpg', mediaType: 'image/jpeg' }
    ] as unknown as CherryMessagePart[])
    const blocks = screen.getAllByTestId('mock-image-block')
    expect(blocks).toHaveLength(2)
    blocks.forEach((b) => expect(b.getAttribute('data-single')).toBe('false'))
  })

  it('skips image parts without url', () => {
    renderParts([{ type: 'file', mediaType: 'image/png' } as unknown as CherryMessagePart])
    expect(screen.queryByTestId('mock-image-block')).toBeNull()
  })

  // -- non-image file --
  it('renders non-image file as attachment', () => {
    renderParts([
      {
        type: 'file',
        url: 'file:///doc.pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf'
      } as unknown as CherryMessagePart
    ])
    expect(screen.queryByTestId('mock-image-block')).toBeNull()
    expect(screen.getByTestId('mock-attachments').getAttribute('data-file-name')).toBe('doc.pdf')
  })

  // -- tool (single) --
  it('renders single dynamic-tool via MessageTools', () => {
    renderParts([
      {
        type: 'dynamic-tool',
        toolCallId: 'tc-1',
        toolName: 'search',
        state: 'output-available',
        input: { q: 'hi' },
        output: { content: 'ok', metadata: { serverName: 'S', serverId: 's1', type: 'mcp' } }
      } as unknown as CherryMessagePart
    ])
    const el = screen.getByTestId('mock-message-tools')
    expect(el.getAttribute('data-status')).toBe('done')
    expect(el.getAttribute('data-tool-name')).toBe('search')
    expect(el.getAttribute('data-server-name')).toBe('S')
  })

  // -- tool group --
  it('renders multiple tool parts as ToolBlockGroup', () => {
    renderParts([
      { type: 'dynamic-tool', toolCallId: 'a', toolName: 't1', state: 'output-available', output: {} },
      { type: 'dynamic-tool', toolCallId: 'b', toolName: 't2', state: 'output-available', output: {} }
    ] as unknown as CherryMessagePart[])
    expect(screen.getByTestId('mock-tool-group').getAttribute('data-count')).toBe('2')
  })

  // -- data-video --
  it('renders data-video with filePath', () => {
    renderParts([{ type: 'data-video', data: { filePath: '/tmp/v.mp4' } } as unknown as CherryMessagePart])
    const el = screen.getByTestId('mock-message-video')
    expect(el.getAttribute('data-file-path')).toBe('/tmp/v.mp4')
  })

  it('renders data-video with url', () => {
    renderParts([{ type: 'data-video', data: { url: 'https://v.test/v.mp4' } } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-message-video').getAttribute('data-url')).toBe('https://v.test/v.mp4')
  })

  // -- data-error --
  it('renders data-error as ErrorBlock', () => {
    renderParts([{ type: 'data-error', data: { name: 'Err', message: 'boom' } } as unknown as CherryMessagePart])
    expect(screen.getByTestId('mock-error-block').getAttribute('data-error-message')).toBe('boom')
  })

  // -- data-citation --
  it('returns nothing for data-citation (embedded in text)', () => {
    const { container } = renderParts([{ type: 'data-citation', data: {} } as unknown as CherryMessagePart])
    // Should render the AnimatePresence wrapper but no visible content
    expect(container.querySelector('[data-testid]')).toBeNull()
  })

  // -- source-url / step-start --
  it('skips source-url and step-start parts', () => {
    const { container } = renderParts([
      { type: 'source-url' } as unknown as CherryMessagePart,
      { type: 'step-start' } as unknown as CherryMessagePart
    ])
    expect(container.querySelector('[data-testid]')).toBeNull()
  })

  // -- text with citations --
  it('passes citation references through to MainTextBlock', () => {
    renderParts([
      {
        type: 'text',
        text: 'cited [1]',
        providerMetadata: {
          cherry: {
            references: [
              {
                category: 'citation',
                citationType: 'web',
                content: { source: 'websearch', results: [{ url: 'https://ex.com', title: 'Ex' }] }
              }
            ]
          }
        }
      } as unknown as CherryMessagePart
    ])
    const md = screen.getByTestId('mock-markdown')
    expect(md.textContent).toContain('data-citation')
    expect(md.textContent).toContain('https://ex.com')
  })
})

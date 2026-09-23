// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'

import SpanDetail, { formatTabData, SPAN_DETAIL_PREVIEW_CHARS } from '../SpanDetail'
import type { TraceNode } from '../traceNode'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(),
  download: vi.fn(),
  seenCodeViewerValues: [] as string[]
}))

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const TabsContext = React.createContext<{ onValueChange?: (value: string) => void; value: string }>({ value: '' })
  const Div = ({ children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
    <div {...props}>{children}</div>
  )

  return {
    Button: ({
      children,
      size,
      variant,
      ...props
    }: PropsWithChildren<
      ButtonHTMLAttributes<HTMLButtonElement> & {
        size?: string
        variant?: string
      }
    >) => (
      <button type="button" data-size={size} data-variant={variant} {...props}>
        {children}
      </button>
    ),
    Field: Div,
    FieldContent: Div,
    FieldDescription: Div,
    FieldGroup: Div,
    FieldTitle: Div,
    Tabs: ({
      children,
      className,
      onValueChange,
      value
    }: PropsWithChildren<{ className?: string; onValueChange?: (value: string) => void; value: string }>) => (
      <TabsContext value={{ onValueChange, value }}>
        <div className={className}>{children}</div>
      </TabsContext>
    ),
    TabsContent: ({ children, className, value }: PropsWithChildren<{ className?: string; value: string }>) => {
      const tabs = React.use(TabsContext)
      return tabs.value === value ? <div className={className}>{children}</div> : null
    },
    TabsList: Div,
    TabsTrigger: ({ children, value }: PropsWithChildren<{ value: string }>) => {
      const tabs = React.use(TabsContext)
      return (
        <button
          type="button"
          role="tab"
          aria-selected={tabs.value === value}
          onClick={() => tabs.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>
  }
})

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({
    className,
    value,
    language,
    options
  }: {
    className?: string
    value: string
    language?: string
    options?: { highlight?: boolean; lineNumbers?: boolean }
  }) => {
    mocks.seenCodeViewerValues.push(value)
    return (
      <pre
        className={className}
        data-testid="code-viewer"
        data-language={language}
        data-highlight={options?.highlight === false ? 'false' : 'true'}>
        {value}
      </pre>
    )
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: { type: '3rdParty', init: () => {} }
}))

vi.mock('@renderer/utils/download', () => ({
  download: (...args: unknown[]) => mocks.download(...args)
}))

function node(overrides: Partial<TraceNode> = {}): TraceNode {
  return {
    id: 'span-1',
    traceId: 'trace-1',
    parentId: null,
    name: 'tool.call',
    status: 'OK',
    startTime: 1_000,
    endTime: 2_000,
    attributes: {
      inputs: 'input text',
      outputs: 'output text'
    },
    events: [],
    links: [],
    childIds: [],
    ...overrides
  } as unknown as TraceNode
}

function setupUser() {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText }
  })
  return user
}

describe('SpanDetail copy', () => {
  beforeEach(() => {
    mocks.writeText.mockReset()
    mocks.writeText.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('allows selection and copies the formatted active tab without a success toast', async () => {
    const user = setupUser()
    render(
      <SpanDetail node={node({ attributes: { inputs: '{"query":"hello"}', outputs: 'done' } })} onShowList={vi.fn()} />
    )

    expect(screen.getByTestId('code-viewer').textContent).toBe('{\n  "query": "hello"\n}')

    await user.click(screen.getByRole('button', { name: 'common.copy' }))

    expect(mocks.writeText).toHaveBeenCalledWith('{\n  "query": "hello"\n}')
    expect(document.querySelector('.lucide-check')).toBeInTheDocument()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('copies output, HTTP header, and raw content from the active tab without sharing success state', async () => {
    const user = setupUser()
    render(
      <SpanDetail
        node={node({
          attributes: {
            tags: 'HTTP',
            inputs: 'request body',
            outputs: 'response body',
            'http.request.headers': { authorization: '***' }
          }
        })}
        onShowList={vi.fn()}
      />
    )

    await user.click(screen.getByRole('tab', { name: 'trace.outputs' }))
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(mocks.writeText).toHaveBeenLastCalledWith('response body')
    expect(document.querySelector('.lucide-check')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'trace.requestHeaders' }))
    expect(document.querySelector('.lucide-copy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(mocks.writeText).toHaveBeenLastCalledWith('{\n  "authorization": "***"\n}')

    await user.click(screen.getByRole('tab', { name: 'message.tools.raw' }))
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(JSON.parse(mocks.writeText.mock.calls.at(-1)?.[0])).toMatchObject({
      id: 'span-1',
      traceId: 'trace-1',
      name: 'tool.call'
    })
  })

  it('copies the exception event shown on an error span output tab', async () => {
    const user = setupUser()
    render(
      <SpanDetail
        node={node({
          status: 'ERROR',
          events: [{ name: 'exception', time: [0, 0], attributes: { 'exception.message': 'request failed' } }]
        })}
        onShowList={vi.fn()}
      />
    )

    await user.click(screen.getByRole('tab', { name: 'trace.outputs' }))
    await user.click(screen.getByRole('button', { name: 'common.copy' }))

    expect(JSON.parse(mocks.writeText.mock.calls.at(-1)?.[0])).toMatchObject({
      name: 'exception',
      attributes: { 'exception.message': 'request failed' }
    })
  })

  it('disables copy when the active tab has no content', () => {
    render(<SpanDetail node={node({ attributes: { inputs: '' } })} onShowList={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.copy' })).toBeDisabled()
    expect(mocks.writeText).not.toHaveBeenCalled()
  })

  it('logs and reports clipboard failures with the common copy error', async () => {
    const user = setupUser()
    const error = new Error('Clipboard access denied')
    const loggerError = vi.spyOn(loggerService, 'error').mockImplementation(() => {})
    mocks.writeText.mockRejectedValueOnce(error)
    render(<SpanDetail node={node()} onShowList={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.copy' }))

    await waitFor(() => {
      expect(loggerError).toHaveBeenCalledWith('Failed to copy span detail content', error)
      expect(toast.error).toHaveBeenCalledWith('common.copy_failed')
    })
  })
})

describe('formatTabData large-payload guard (issue #19564)', () => {
  it('flags payloads above the threshold as large', () => {
    const big = 'x'.repeat(150_000)
    const result = formatTabData(
      node({ attributes: { inputs: 'in', outputs: big } }),
      [
        { value: 'inputs', label: 'inputs', data: 'in' },
        { value: 'outputs', label: 'outputs', data: big }
      ],
      'outputs'
    )
    expect(result.isLarge).toBe(true)
    expect(result.fullLength).toBe(150_000)
    expect(result.content).toBe(big)
  })

  it('keeps small payloads flagged as not large', () => {
    const result = formatTabData(
      node({ attributes: { inputs: 'hello' } }),
      [{ value: 'inputs', label: 'inputs', data: 'hello' }],
      'inputs'
    )
    expect(result.isLarge).toBe(false)
    expect(result.content).toBe('hello')
  })

  it('returns already-large strings raw without pretty-print expansion', () => {
    const minifiedJson = `{"data":"${'x'.repeat(150_000)}"}`
    const result = formatTabData(node({}), [{ value: 'outputs', label: 'outputs', data: minifiedJson }], 'outputs')
    expect(result.isLarge).toBe(true)
    expect(result.content).toBe(minifiedJson)
    expect(result.contentLanguage).toBe('json')
  })

  it('never throws on circular payloads', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = formatTabData(node({}), [{ value: 'raw', label: 'raw', data: circular }], 'raw')
    expect(typeof result.content).toBe('string')
    expect(result.contentLanguage).toBe('text')
  })
})

describe('SpanDetail large content (issue #19564)', () => {
  beforeEach(() => {
    mocks.writeText.mockReset()
    mocks.writeText.mockResolvedValue(undefined)
    mocks.download.mockReset()
    mocks.seenCodeViewerValues.length = 0
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a preview with highlight disabled and expands to full on demand', async () => {
    const user = setupUser()
    const big = 'y'.repeat(150_000)
    render(<SpanDetail node={node({ attributes: { inputs: big, outputs: 'small' } })} onShowList={vi.fn()} />)

    const viewer = screen.getByTestId('code-viewer')
    expect(viewer.getAttribute('data-highlight')).toBe('false')
    expect(viewer.textContent?.length).toBe(SPAN_DETAIL_PREVIEW_CHARS)
    expect(screen.getByRole('button', { name: 'common.expand' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.download' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.expand' }))
    expect(screen.getByTestId('code-viewer').textContent?.length).toBe(150_000)
    expect(screen.getByRole('button', { name: 'common.collapse' })).toBeInTheDocument()
  })

  it('copies the full content even while the preview is collapsed', async () => {
    const user = setupUser()
    const big = 'z'.repeat(150_000)
    render(<SpanDetail node={node({ attributes: { inputs: big, outputs: 'small' } })} onShowList={vi.fn()} />)

    // Preview is shown, but copy must not silently copy partial text.
    expect(screen.getByTestId('code-viewer').textContent?.length).toBe(SPAN_DETAIL_PREVIEW_CHARS)
    await user.click(screen.getByRole('button', { name: 'common.copy' }))
    expect(mocks.writeText).toHaveBeenCalledWith(big)
  })

  it('downloads the full content via the shared download helper', async () => {
    const user = setupUser()
    const big = 'w'.repeat(150_000)
    const createObjectURL = vi.fn(() => 'blob:mock-url')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    render(<SpanDetail node={node({ attributes: { inputs: big, outputs: 'small' } })} onShowList={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'common.download' }))
    expect(mocks.download).toHaveBeenCalledWith('blob:mock-url', expect.stringMatching(/^trace-span-1-inputs\.txt$/))
  })

  it('keeps syntax highlighting for small payloads', () => {
    render(
      <SpanDetail node={node({ attributes: { inputs: '{"query":"hello"}', outputs: 'done' } })} onShowList={vi.fn()} />
    )
    expect(screen.getByTestId('code-viewer').getAttribute('data-highlight')).toBe('true')
    expect(screen.queryByRole('button', { name: 'common.expand' })).not.toBeInTheDocument()
  })

  it('collapses back to preview synchronously when switching tabs after expanding', async () => {
    const user = setupUser()
    const bigInputs = `a${'x'.repeat(150_000)}`
    const bigOutputs = `b${'y'.repeat(150_000)}`
    render(<SpanDetail node={node({ attributes: { inputs: bigInputs, outputs: bigOutputs } })} onShowList={vi.fn()} />)

    // Expand the inputs payload to full.
    await user.click(screen.getByRole('button', { name: 'common.expand' }))
    expect(screen.getByTestId('code-viewer').textContent?.length).toBe(bigInputs.length)
    expect(screen.getByTestId('code-viewer').textContent?.startsWith('a')).toBe(true)

    // Switching tabs must render the new payload as preview on the first render
    // (no one-frame flash of the full payload from a post-render effect reset).
    // The CodeViewer mock records every render, so an effect-based reset would
    // leave at least one full-length entry for the new tab.
    mocks.seenCodeViewerValues.length = 0
    await user.click(screen.getByRole('tab', { name: 'trace.outputs' }))
    const viewer = screen.getByTestId('code-viewer')
    expect(viewer.textContent?.length).toBe(SPAN_DETAIL_PREVIEW_CHARS)
    expect(viewer.textContent?.startsWith('b')).toBe(true)
    expect(screen.getByRole('button', { name: 'common.expand' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.collapse' })).not.toBeInTheDocument()
    expect(mocks.seenCodeViewerValues.length).toBeGreaterThan(0)
    expect(mocks.seenCodeViewerValues.every((v) => v.length === SPAN_DETAIL_PREVIEW_CHARS)).toBe(true)
    expect(mocks.seenCodeViewerValues.some((v) => v.length === bigOutputs.length)).toBe(false)
  })

  it('collapses back to preview when switching spans after expanding', async () => {
    const user = setupUser()
    const big = 'y'.repeat(150_000)
    const { rerender } = render(
      <SpanDetail node={node({ id: 'span-1', attributes: { inputs: big } })} onShowList={vi.fn()} />
    )

    await user.click(screen.getByRole('button', { name: 'common.expand' }))
    expect(screen.getByTestId('code-viewer').textContent?.length).toBe(150_000)

    mocks.seenCodeViewerValues.length = 0
    rerender(<SpanDetail node={node({ id: 'span-2', attributes: { inputs: big } })} onShowList={vi.fn()} />)
    expect(screen.getByTestId('code-viewer').textContent?.length).toBe(SPAN_DETAIL_PREVIEW_CHARS)
    expect(screen.getByRole('button', { name: 'common.expand' })).toBeInTheDocument()
    expect(mocks.seenCodeViewerValues.length).toBeGreaterThan(0)
    expect(mocks.seenCodeViewerValues.every((v) => v.length === SPAN_DETAIL_PREVIEW_CHARS)).toBe(true)
  })

  it('reports UTF-8 byte size, not char count, in the large-content badge', () => {
    // 'é' is 1 char but 2 UTF-8 bytes: 150k chars = 300k bytes.
    const big = 'é'.repeat(150_000)
    const byteLength = new TextEncoder().encode(big).length
    expect(byteLength).toBe(300_000)
    expect(big.length).toBe(150_000)
    render(<SpanDetail node={node({ attributes: { inputs: big, outputs: 'small' } })} onShowList={vi.fn()} />)

    // 300k bytes formats as 293 KB, while the raw char count would format as 146 KB.
    const banner = screen.getByText(/KB/, { selector: 'span' })
    expect(banner.textContent).toContain('293 KB')
    expect(banner.textContent).not.toContain('146 KB')
  })
})

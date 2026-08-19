// @vitest-environment jsdom

import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpanDetail from '../SpanDetail'
import type { TraceNode } from '../traceNode'

const mocks = vi.hoisted(() => ({
  writeText: vi.fn()
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
  default: ({ className, value }: { className?: string; value: string }) => (
    <pre className={className} data-testid="code-viewer">
      {value}
    </pre>
  )
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  }),
  initReactI18next: { type: '3rdParty', init: () => {} }
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

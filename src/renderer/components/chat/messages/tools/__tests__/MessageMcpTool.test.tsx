import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpToolResponse } from '@renderer/types/mcpTool'

import MessageMcpTool from '../mcp/MessageMcpTool'

const mockApproval = vi.hoisted(() => vi.fn())
const mockActions = vi.hoisted(() => vi.fn(() => ({})))
const mockIsToolAutoApproved = vi.hoisted(() => vi.fn(() => false))
const mockHighlightCode = vi.hoisted(() => vi.fn(async (code: string) => `<pre>${code}</pre>`))

// Control approval state directly so the test doesn't need the MCP-server data hooks.
vi.mock('../hooks/useToolApproval', () => ({
  useToolApproval: () => mockApproval()
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockActions(),
  useOptionalMessageListUi: () => ({ isToolAutoApproved: mockIsToolAutoApproved }),
  useMessageRenderConfig: () => ({ messageFont: 'sans-serif', fontSize: 14 })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ highlightCode: mockHighlightCode })
}))

vi.mock('@renderer/components/icons/CopyIcon', () => ({
  default: () => <span data-testid="copy-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { count: number }) => {
      if (key === 'message.tools.linksOmitted' && typeof fallback === 'object') return `Omitted: ${fallback.count}`
      if (key === 'agent.toolPermission.decisionDenied') return 'Denied'
      return typeof fallback === 'string' ? fallback : key
    }
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
  }
}))

const createMcpToolResponse = (overrides: Partial<McpToolResponse> = {}): McpToolResponse => ({
  id: 'call-1',
  tool: {
    id: 'CherryBrowser__execute',
    name: 'execute',
    type: 'mcp',
    serverId: 'CherryBrowser',
    serverName: 'CherryBrowser',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  arguments: { url: 'https://example.com' },
  status: 'pending',
  response: undefined,
  toolCallId: 'call-1',
  ...overrides
})

describe('MessageMcpTool', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected renderer fetch'))
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (_route, input) => ({
      ok: true,
      data: (input as { imageHint: boolean }).imageHint ? 'data:image/png;base64,aW1hZ2U=' : null
    }))
    // An abort handler is available, so the removed v1 ActionsBar *would* have
    // rendered its destructive abort button — making the absence assertion meaningful.
    mockActions.mockReturnValue({ abortTool: vi.fn() })
    mockApproval.mockReturnValue({
      isWaiting: false,
      isExecuting: true,
      isSubmitting: false,
      confirm: vi.fn(),
      cancel: vi.fn()
    })
    mockIsToolAutoApproved.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('renders nothing while awaiting approval (the composer owns that surface)', () => {
    mockApproval.mockReturnValue({
      isWaiting: true,
      isExecuting: false,
      isSubmitting: false,
      confirm: vi.fn(),
      cancel: vi.fn()
    })

    const { container } = render(<MessageMcpTool toolResponse={createMcpToolResponse()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows only the disclosure header while executing — no abort bar (v2 style)', () => {
    const { container } = render(<MessageMcpTool toolResponse={createMcpToolResponse({ status: 'pending' })} />)

    // Header still identifies the tool.
    expect(container.textContent).toContain('CherryBrowser : execute')
    // The v1 destructive abort button is gone.
    expect(container.textContent).not.toContain('chat.input.pause')
    // Only the collapse header is interactive — no separate actions-bar controls.
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('keeps a lightweight copy action for completed tool payloads', async () => {
    const copyText = vi.fn()
    mockActions.mockReturnValue({ copyText })

    render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({
          status: 'done',
          response: { content: [{ type: 'text', text: 'ok' }] }
        })}
      />
    )

    const copyButton = screen.getByRole('button', { name: 'common.copy' })
    const triggerButton = screen.getByRole('button', { name: /CherryBrowser : execute/ })

    expect(copyButton.tagName).toBe('BUTTON')
    expect(triggerButton).not.toContainElement(copyButton)

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(expect.stringContaining('"url": "https://example.com"'), {
        successMessage: 'message.copied'
      })
    })
  })

  it('shows the auto-approve badge when the MCP tool is auto-approved', () => {
    mockIsToolAutoApproved.mockReturnValue(true)

    render(<MessageMcpTool toolResponse={createMcpToolResponse({ status: 'done' })} />)

    expect(screen.getByLabelText('message.tools.autoApproveEnabled')).toBeInTheDocument()
  })

  it('keeps a custom rejection reason visible in MCP tool history', () => {
    render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({
          status: 'cancelled',
          approval: { approved: false, reason: 'Use the read-only endpoint instead' }
        })}
      />
    )

    expect(screen.getByText('Denied')).toBeInTheDocument()
    expect(screen.getByText('Use the read-only endpoint instead')).toBeInTheDocument()
  })

  it('shows the model-facing denial wording when the user gave no reason', () => {
    render(
      <MessageMcpTool toolResponse={createMcpToolResponse({ status: 'cancelled', approval: { approved: false } })} />
    )

    expect(screen.getByText('Denied')).toBeInTheDocument()
    expect(
      screen.getByText(
        "The user doesn't want to proceed with this tool use. The tool use was rejected (it did not run). Wait for the user's instructions instead of retrying it."
      )
    ).toBeInTheDocument()
  })

  it('renders structured tool output that is not an MCP content envelope', async () => {
    const { container } = render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({
          status: 'done',
          response: {
            status: 'ready',
            tools: [{ name: 'lark-cli', installedVersion: '1.0.77' }]
          }
        })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /CherryBrowser : execute/ }))

    await waitFor(() => {
      expect(container.textContent).toContain('"status": "ready"')
      expect(container.textContent).toContain('"installedVersion": "1.0.77"')
    })
  })

  it('previews links in MCP text and resource blocks without displaying their JSON', async () => {
    const user = userEvent.setup()
    render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({
          status: 'done',
          response: {
            content: [
              { type: 'text', text: '"https://example.com/result.png?signature=abc"' },
              { type: 'text', text: 'https://example.com/docs' },
              {
                type: 'resource_link',
                uri: 'https://example.com/download?id=1',
                name: 'Generated image',
                mimeType: 'image/webp'
              }
            ]
          }
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /CherryBrowser : execute/ }))

    expect(await screen.findByRole('img', { name: 'Generated image' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aW1hZ2U='
    )
    expect(await screen.findByRole('img', { name: 'message.tools.sections.output' })).toHaveAttribute(
      'src',
      'data:image/png;base64,aW1hZ2U='
    )
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toHaveAttribute(
      'href',
      'https://example.com/docs'
    )
    expect(screen.queryByText('"https://example.com/result.png?signature=abc"')).not.toBeInTheDocument()
  })

  it('previews a direct URL result outside an MCP envelope', async () => {
    const user = userEvent.setup()
    render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({ status: 'done', response: 'https://example.com/result.webp' })}
      />
    )
    await user.click(screen.getByRole('button', { name: /CherryBrowser : execute/ }))
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2U=')
    expect(screen.queryByText('"https://example.com/result.webp"')).not.toBeInTheDocument()
  })
  it('previews a large URL array inside an MCP text block without exceeding the argument limit', async () => {
    const user = userEvent.setup()
    const urls = Array.from({ length: 200000 }, (_, index) => `https://example.com/large-mcp/${index}`)
    render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({
          status: 'done',
          response: { content: [{ type: 'text', text: JSON.stringify(urls) }] }
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /CherryBrowser : execute/ }))
    expect(await screen.findByText('Omitted: 199980')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(20)
    expect(screen.getByRole('link', { name: urls[0] })).toHaveAttribute('href', urls[0])
    expect(screen.getByRole('link', { name: urls[19] })).toHaveAttribute('href', urls[19])
    expect(screen.queryByRole('link', { name: urls[20] })).not.toBeInTheDocument()
  })

  it('caps previews across MCP blocks and reports the omitted count', async () => {
    const user = userEvent.setup()
    render(
      <MessageMcpTool
        toolResponse={createMcpToolResponse({
          status: 'done',
          response: {
            content: Array.from({ length: 25 }, (_, index) => ({
              type: 'resource_link',
              name: `Link ${index}`,
              uri: `https://example.com/capped/${index}`,
              mimeType: 'text/html'
            }))
          }
        })}
      />
    )
    await user.click(screen.getByRole('button', { name: /CherryBrowser : execute/ }))
    expect(await screen.findByText('Omitted: 5')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(20)
    expect(screen.queryByRole('link', { name: 'Link 20' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

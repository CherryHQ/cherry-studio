import type { McpToolResponse } from '@renderer/types'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MessageMcpTool from '../mcp/MessageMcpTool'

const mockApproval = vi.hoisted(() => vi.fn())
const mockActions = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))

// Control approval state directly so the test doesn't need the MCP-server data hooks.
vi.mock('../hooks/useToolApproval', () => ({
  useToolApproval: () => mockApproval()
}))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockActions(),
  useOptionalMessageListUi: () => ({ isToolAutoApproved: () => false }),
  useMessageRenderConfig: () => ({ messageFont: 'sans-serif', fontSize: 14 })
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({ highlightCode: vi.fn(async () => '') })
}))

vi.mock('@renderer/components/Icons', () => ({
  CopyIcon: () => <span data-testid="copy-icon" />
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key) }),
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
  })

  afterEach(() => vi.clearAllMocks())

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
})

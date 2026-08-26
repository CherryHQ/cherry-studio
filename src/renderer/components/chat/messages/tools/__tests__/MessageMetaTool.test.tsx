import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MessageMetaTool from '../meta/MessageMetaTool'

const mockActions = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockActions()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ highlightCode: vi.fn(async () => '') })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      if (!options) return key
      return Object.entries(options).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        key
      )
    }
  }),
  initReactI18next: { type: '3rdParty', init: vi.fn() }
}))

const createMetaToolResponse = (overrides: Partial<NormalToolResponse> = {}): NormalToolResponse => ({
  id: 'meta-call-1',
  tool: {
    id: 'tool_search',
    name: 'tool_search',
    type: 'builtin'
  },
  arguments: { query: 'browser', namespace: 'mcp:test' },
  status: 'done',
  response: { tools: [] },
  toolCallId: 'meta-call-1',
  ...overrides
})

describe('MessageMetaTool', () => {
  it('keeps a lightweight copy action for completed tool payloads', async () => {
    const copyText = vi.fn()
    mockActions.mockReturnValue({ copyText })

    render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)

    const copyButton = screen.getByRole('button', { name: 'common.copy' })
    const triggerButton = screen.getByRole('button', { name: /tool_search/ })

    expect(copyButton.tagName).toBe('BUTTON')
    expect(triggerButton).not.toContainElement(copyButton)

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(expect.stringContaining('"query": "browser"'), {
        successMessage: 'message.copied'
      })
    })
  })

  async function expandCard(name: RegExp) {
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
    })
  }

  it('localizes the empty search state instead of hardcoding English', async () => {
    render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)
    await expandCard(/tool_search/)

    expect(await screen.findByText('message.tools.meta.no_tools_matched')).toBeInTheDocument()
    expect(screen.queryByText('No tools matched.')).not.toBeInTheDocument()
    expect(screen.getByText('message.tools.sections.args')).toBeInTheDocument()
  })

  it('localizes a missing tool_invoke name instead of hardcoding English', async () => {
    render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_invoke', name: 'tool_invoke', type: 'builtin' },
          arguments: {}
        })}
      />
    )
    await expandCard(/tool_invoke/)

    expect(await screen.findByText('message.tools.meta.invoke_missing_name')).toBeInTheDocument()
    expect(screen.queryByText('tool_invoke called without a tool name.')).not.toBeInTheDocument()
  })

  it('localizes inspect, invoke, and exec section titles', async () => {
    const inspectView = render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_inspect', name: 'tool_inspect', type: 'builtin' },
          arguments: { name: 'browser' },
          response: '/** inspect me */'
        })}
      />
    )
    await expandCard(/tool_inspect/)
    expect(await screen.findByText('message.tools.sections.jsdoc')).toBeInTheDocument()
    expect(screen.queryByText('JSDoc')).not.toBeInTheDocument()
    inspectView.unmount()

    const invokeView = render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_invoke', name: 'tool_invoke', type: 'builtin' },
          arguments: { name: 'browser', params: { url: 'https://example.test' } },
          response: { ok: true }
        })}
      />
    )
    await expandCard(/tool_invoke/)
    expect(await screen.findByText('message.tools.sections.output')).toBeInTheDocument()
    expect(screen.queryByText('Response')).not.toBeInTheDocument()
    invokeView.unmount()

    render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_exec', name: 'tool_exec', type: 'builtin' },
          arguments: { code: 'return 1' },
          response: { logs: ['started'], error: 'boom', result: 1, isError: true }
        })}
      />
    )
    await expandCard(/tool_exec/)
    expect(await screen.findByText('message.tools.sections.code')).toBeInTheDocument()
    expect(screen.getByText('message.tools.sections.logs')).toBeInTheDocument()
    expect(screen.getByText('message.tools.status.error')).toBeInTheDocument()
    expect(screen.queryByText('Code')).not.toBeInTheDocument()
    expect(screen.queryByText('Logs (1)')).not.toBeInTheDocument()
    expect(screen.queryByText('Result')).not.toBeInTheDocument()
  })
})

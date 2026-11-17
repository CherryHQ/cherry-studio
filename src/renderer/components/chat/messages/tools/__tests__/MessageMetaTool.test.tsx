import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

import MessageMetaTool from '../meta/MessageMetaTool'

const mockActions = vi.hoisted(() => vi.fn(() => ({})))

vi.mock('@renderer/components/chat/messages/MessageListProvider', () => ({
  useOptionalMessageListActions: () => mockActions()
}))

vi.mock('@renderer/hooks/useTimer', () => ({
  useTimer: () => ({ setTimeoutTimer: vi.fn() })
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ highlightCode: vi.fn(async () => '') })
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

let originalLanguage: string

beforeAll(async () => {
  originalLanguage = i18n.language
  await i18n.changeLanguage('zh-CN')
})

afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})

describe('MessageMetaTool', () => {
  it('keeps a lightweight copy action for completed tool payloads', async () => {
    const copyText = vi.fn()
    mockActions.mockReturnValue({ copyText })

    render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)

    const copyButton = screen.getByRole('button', { name: '复制' })
    const triggerButton = screen.getByRole('button', { name: /tool_search/ })

    expect(copyButton.tagName).toBe('BUTTON')
    expect(triggerButton).not.toContainElement(copyButton)

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(expect.stringContaining('"query": "browser"'), {
        successMessage: '已复制'
      })
    })
    expect(screen.getByText('已复制')).toBeInTheDocument()
  })

  async function expandCard(name: RegExp) {
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
    })
  }

  it('shows tools loaded by native Pi search instead of an empty result', async () => {
    render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({ response: { loaded: ['mcp__cherry_tools__web_search'] } })}
      />
    )
    await expandCard(/tool_search/)
    expect(await screen.findByText('mcp__cherry_tools__web_search')).toBeTruthy()
    expect(screen.queryByText('没有匹配的工具。')).toBeNull()
  })

  it('shows the native Code Mode script and its output', async () => {
    render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({
          tool: { id: 'codemode', name: 'codemode', type: 'builtin' },
          arguments: { code: 'text(42)' },
          response: 'Script completed\n42'
        })}
      />
    )
    await expandCard(/codemode/)
    expect(await screen.findByText('text(42)')).toBeTruthy()
    expect(screen.getByText(/Script completed/)).toBeTruthy()
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { NormalToolResponse } from '@renderer/types/mcpTool'

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

  it('localizes the empty search state instead of hardcoding English', async () => {
    render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)
    await expandCard(/tool_search/)

    expect(await screen.findByText('没有匹配的工具。')).toBeInTheDocument()
    expect(screen.getByText('参数')).toBeInTheDocument()
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

    expect(await screen.findByText('未提供工具名称。')).toBeInTheDocument()
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
    expect(await screen.findByText('JSDoc')).toBeInTheDocument()
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
    expect(await screen.findByText('输出')).toBeInTheDocument()
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
    expect(await screen.findByText('代码')).toBeInTheDocument()
    expect(screen.getByText('日志（1）')).toBeInTheDocument()
    expect(screen.getByText('错误')).toBeInTheDocument()
  })

  it('localizes the exec success output section', async () => {
    render(
      <MessageMetaTool
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_exec', name: 'tool_exec', type: 'builtin' },
          arguments: { code: 'return 1' },
          response: { result: 1, isError: false }
        })}
      />
    )
    await expandCard(/tool_exec/)

    expect(await screen.findByText('输出')).toBeInTheDocument()
  })
})

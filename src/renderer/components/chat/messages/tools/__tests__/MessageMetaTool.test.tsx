import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  response: { matchedNamespaces: [] },
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
  it.each([
    { label: 'array', args: [{ query: 'nested query' }] },
    { label: 'streaming text', args: '{"query":' },
    { label: 'missing arguments', args: undefined },
    { label: 'non-string fields', args: { query: 42, namespace: false } }
  ])('keeps the search title usable for $label', async ({ args }) => {
    render(<MessageMetaTool toolName="tool_search" toolResponse={createMetaToolResponse({ arguments: args })} />)

    expect(screen.getByText('tool_search', { exact: true })).toBeVisible()
    await expandCard(/tool_search/)
    expect(await screen.findByText('没有匹配的工具。')).toBeVisible()
  })

  it('shows and copies diagnostic text when a native tool result cannot be serialized', async () => {
    const user = userEvent.setup()
    const copyText = vi.fn()
    mockActions.mockReturnValue({ copyText })
    render(
      <MessageMetaTool
        toolName="tool_invoke"
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_invoke', name: 'tool_invoke', type: 'builtin' },
          arguments: { name: 'extension_tool', params: { path: 'file.txt' } },
          response: {
            toJSON() {
              throw new Error('native serializer failed')
            }
          }
        })}
      />
    )
    await expandCard(/tool_invoke/)
    expect(await screen.findByText('[Unserializable]')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('[Unserializable]', { successMessage: '已复制' }))
  })

  it('keeps a lightweight copy action for completed tool payloads', async () => {
    const copyText = vi.fn()
    mockActions.mockReturnValue({ copyText })

    render(<MessageMetaTool toolName="tool_search" toolResponse={createMetaToolResponse()} />)

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
        toolName="tool_search"
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
        toolName="codemode"
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

  it('shows namespace names without requiring unused tool descriptions', async () => {
    render(
      <MessageMetaTool
        toolName="tool_search"
        toolResponse={createMetaToolResponse({
          response: { matchedNamespaces: [{ namespace: 'mcp:test', tools: [{ name: 'lookup' }] }] }
        })}
      />
    )
    await expandCard(/tool_search/)

    expect(await screen.findByText('lookup', { exact: true })).toBeVisible()
    expect(screen.queryByText('没有匹配的工具。')).not.toBeInTheDocument()
  })

  it.each([
    { matchedNamespaces: [{ namespace: 'mcp:test', tools: null }], error: 'catalog unavailable' },
    { matchedNamespaces: 'catalog unavailable', loaded: [] },
    'catalog unavailable'
  ])('preserves unreadable search evidence instead of reporting no matches', async (response) => {
    render(<MessageMetaTool toolName="tool_search" toolResponse={createMetaToolResponse({ response })} />)
    await expandCard(/tool_search/)

    expect(await screen.findByText(/catalog unavailable/)).toBeVisible()
    expect(screen.queryByText('没有匹配的工具。')).not.toBeInTheDocument()
  })

  it('shows execution logs and retains a falsy result', async () => {
    render(
      <MessageMetaTool
        toolName="tool_exec"
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_exec', name: 'tool_exec', type: 'builtin' },
          response: { logs: ['started', 'finished'], result: false }
        })}
      />
    )
    await expandCard(/tool_exec/)

    expect(screen.getByText(/started\s+finished/)).toBeVisible()
    expect(screen.getByText('false', { exact: true })).toBeVisible()
  })

  it.each([
    { logs: 'invalid logs', error: { message: 'execution failed' } },
    { isError: true, content: [{ type: 'text', text: 'execution failed' }] },
    { result: 'execution failed', isError: 'invalid flag' }
  ])('keeps native execution failure evidence readable', async (response) => {
    render(
      <MessageMetaTool
        toolName="tool_exec"
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_exec', name: 'tool_exec', type: 'builtin' },
          response
        })}
      />
    )
    await expandCard(/tool_exec/)

    expect(screen.getByText(/execution failed/)).toBeVisible()
  })

  it('shows an execution error without presenting its result as successful output', async () => {
    render(
      <MessageMetaTool
        toolName="tool_exec"
        toolResponse={createMetaToolResponse({
          tool: { id: 'tool_exec', name: 'tool_exec', type: 'builtin' },
          response: { error: 'execution failed', result: 'partial result', isError: true }
        })}
      />
    )
    await expandCard(/tool_exec/)

    expect(screen.getByText('execution failed', { exact: true })).toBeVisible()
    expect(screen.queryByText('partial result', { exact: true })).not.toBeInTheDocument()
  })
})

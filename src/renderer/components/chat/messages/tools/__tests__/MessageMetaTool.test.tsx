import i18n, { initI18n } from '@renderer/i18n/resolver'
import type { NormalToolResponse } from '@renderer/types/mcpTool'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('MessageMetaTool', () => {
  beforeAll(async () => {
    await initI18n()
  })

  beforeEach(async () => {
    mockActions.mockReset()
    mockActions.mockReturnValue({})
    await i18n.changeLanguage('en-US')
  })

  afterEach(async () => {
    cleanup()
    await i18n.changeLanguage('en-US')
  })

  it('keeps a lightweight copy action for completed tool payloads', async () => {
    const copyText = vi.fn()
    mockActions.mockReturnValue({ copyText })

    render(<MessageMetaTool toolResponse={createMetaToolResponse()} />)

    const copyButton = screen.getByRole('button', { name: i18n.t('common.copy') })
    const triggerButton = screen.getByRole('button', { name: /tool_search/ })

    expect(copyButton.tagName).toBe('BUTTON')
    expect(triggerButton).not.toContainElement(copyButton)

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith(expect.stringContaining('"query": "browser"'), {
        successMessage: i18n.t('message.copied')
      })
    })
  })

  describe.each([
    ['zh-CN', '代码', '日志（1）', '结果', '参数', '未找到匹配的工具。'],
    ['zh-TW', '程式碼', '記錄（1）', '結果', '參數', '找不到符合的工具。']
  ])('%s localization', (locale, code, logs, result, args, noToolsMatched) => {
    it('localizes meta tool section titles in Chinese', async () => {
      await i18n.changeLanguage(locale)
      render(
        <MessageMetaTool
          toolResponse={createMetaToolResponse({
            tool: { id: 'tool_exec', name: 'tool_exec', type: 'builtin' },
            arguments: { code: 'return 1' },
            response: { logs: ['finished'], result: 1 }
          })}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /tool_exec/ }))

      expect(await screen.findByText(code)).toBeInTheDocument()
      expect(screen.getByText(logs)).toBeInTheDocument()
      expect(screen.getByText(result)).toBeInTheDocument()
      expect(screen.queryByText('Code')).not.toBeInTheDocument()
    })

    it('localizes the empty tool search result in Chinese', async () => {
      await i18n.changeLanguage(locale)
      render(<MessageMetaTool toolResponse={createMetaToolResponse({ response: { matchedNamespaces: [] } })} />)

      fireEvent.click(screen.getByRole('button', { name: /tool_search/ }))

      expect(await screen.findByText(args)).toBeInTheDocument()
      expect(await screen.findByText(noToolsMatched)).toBeInTheDocument()
      expect(screen.queryByText('No tools matched.')).not.toBeInTheDocument()
    })
  })
})

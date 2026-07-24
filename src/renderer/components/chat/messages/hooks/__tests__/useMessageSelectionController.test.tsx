import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'
import type { CherryMessagePart } from '@shared/data/types/message'
import { MockUseCache } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageSelectionController } from '../useMessageSelectionController'

const { popupConfirm } = vi.hoisted(() => ({ popupConfirm: vi.fn() }))

vi.mock('@renderer/services/popup', () => ({
  popup: { confirm: popupConfirm }
}))

const cacheValues = {
  'chat.multi_select_mode': false,
  'chat.selected_message_ids': []
} as Record<string, unknown>
const cacheSetters = new Map<string, (value: unknown) => void>()
const setCacheValue = vi.fn((key: string, value: unknown) => {
  const previous = cacheValues[key]
  const next = typeof value === 'function' ? (value as (current: unknown) => unknown)(previous) : value
  const isEqualArray =
    Array.isArray(previous) &&
    Array.isArray(next) &&
    previous.length === next.length &&
    previous.every((item, index) => Object.is(item, next[index]))

  if (!Object.is(previous, next) && !isEqualArray) {
    cacheValues[key] = next
  }
})

vi.mock('react-i18next', () => {
  const t = (key: string, options?: { count?: number }) =>
    options?.count === undefined ? key : `${key}:${options.count}`
  return {
    initReactI18next: {
      type: '3rdParty',
      init: vi.fn()
    },
    useTranslation: () => ({ t })
  }
})

const message = (id: string) => ({
  id,
  role: 'user' as const,
  topicId: 'topic-1',
  parentId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  status: 'success' as const
})

describe('useMessageSelectionController', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    cacheValues['chat.multi_select_mode'] = false
    cacheValues['chat.selected_message_ids'] = []
    MockUseCache.useCache.mockImplementation((key) => {
      let setter = cacheSetters.get(key)
      if (!setter) {
        setter = (value: unknown) => setCacheValue(key, value)
        cacheSetters.set(key, setter)
      }
      return [cacheValues[key], setter] as never
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    ;(window as any).toast = {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn()
    }
    popupConfirm.mockResolvedValue(true)
  })

  it('copies selected composer tokens through rich clipboard when available', async () => {
    const copyRichContent = vi.fn().mockResolvedValue(undefined)
    const partsByMessageId: Record<string, CherryMessagePart[]> = {
      a: [
        {
          type: 'text',
          text: 'Use the pdf skill. first',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'skill:pdf',
                    kind: 'skill',
                    label: 'PDF',
                    index: 0,
                    textOffset: 0,
                    promptText: 'Use the pdf skill.'
                  }
                ]
              }
            }
          }
        }
      ] as any,
      b: [{ type: 'text', text: 'second' }] as any
    }
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a'), message('b')],
        partsByMessageId,
        copyRichContent
      })
    )

    await act(async () => {
      await result.current.actions.copySelectedMessages?.(['b', 'a'])
    })

    expect(writeText).not.toHaveBeenCalled()
    expect(copyRichContent).toHaveBeenCalledWith(
      expect.objectContaining({
        plainText: '/pdf/ first\n\n---\n\nsecond',
        customFormats: expect.objectContaining({
          [COMPOSER_CLIPBOARD_FRAGMENT_MIME]: expect.stringContaining('"kind":"skill"')
        })
      }),
      { successMessage: 'message.copied' }
    )
    expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
  })

  it('falls back to plain text for selected messages without composer tokens', async () => {
    writeText.mockResolvedValue(undefined)
    const copyRichContent = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a')],
        partsByMessageId: { a: [{ type: 'text', text: 'plain' }] as any },
        copyRichContent
      })
    )

    await act(async () => {
      await result.current.actions.copySelectedMessages?.(['a'])
    })

    expect(copyRichContent).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledWith('plain')
  })

  it('keeps action identities stable while reading the latest streamed message data', async () => {
    writeText.mockResolvedValue(undefined)
    type HookProps = {
      messages: ReturnType<typeof message>[]
      partsByMessageId: Record<string, CherryMessagePart[]>
    }
    const { result, rerender } = renderHook(
      ({ messages, partsByMessageId }: HookProps) =>
        useMessageSelectionController({
          topicId: 'topic-1',
          messages,
          partsByMessageId
        }),
      {
        initialProps: {
          messages: [message('a')],
          partsByMessageId: { a: [{ type: 'text', text: 'old' }] as CherryMessagePart[] }
        } as HookProps
      }
    )
    const initialActions = result.current.actions

    rerender({
      messages: [message('b')],
      partsByMessageId: { b: [{ type: 'text', text: 'latest' }] as CherryMessagePart[] }
    })

    expect(result.current.actions).toBe(initialActions)

    await act(async () => {
      await result.current.actions.copySelectedMessages?.(['b'])
    })

    expect(writeText).toHaveBeenCalledWith('latest')
  })

  it('clears multi-select state when the message list unmounts', () => {
    const { unmount } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a')],
        partsByMessageId: { a: [{ type: 'text', text: 'plain' }] as any }
      })
    )

    setCacheValue.mockClear()

    unmount()

    expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
    expect(setCacheValue).toHaveBeenCalledWith('chat.selected_message_ids', [])
  })

  it('passes the complete selection plan and disables cascading deletion', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined)
    const messages = [
      { ...message('u1'), parentId: 'virtual-root' },
      { ...message('a1'), role: 'assistant' as const, parentId: 'u1' },
      { ...message('u2'), parentId: 'a1' }
    ]
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages,
        partsByMessageId: {},
        deleteMessage
      })
    )

    await act(async () => {
      await result.current.actions.deleteSelectedMessages?.(['u1', 'a1'])
    })

    expect(popupConfirm).toHaveBeenCalledWith(expect.objectContaining({ content: 'message.delete.confirm.content:2' }))
    expect(deleteMessage.mock.calls).toEqual([
      ['u1', { cascade: false, selectedMessageIds: ['u1', 'a1'] }],
      ['a1', { cascade: false, selectedMessageIds: ['u1', 'a1'] }]
    ])
    expect((window as any).toast.error).not.toHaveBeenCalled()
    expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
    expect(setCacheValue).toHaveBeenCalledWith('chat.selected_message_ids', [])
  })

  it('clears multi-select state when deleting a selected message fails', async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error('delete failed'))
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a')],
        partsByMessageId: {},
        deleteMessage
      })
    )

    await act(async () => {
      await result.current.actions.deleteSelectedMessages?.(['a'])
    })

    expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
    expect(setCacheValue).toHaveBeenCalledWith('chat.selected_message_ids', [])
  })

  it('keeps multi-select state when the delete confirmation is cancelled', async () => {
    const deleteMessage = vi.fn()
    const { result } = renderHook(() =>
      useMessageSelectionController({
        topicId: 'topic-1',
        messages: [message('a')],
        partsByMessageId: {},
        deleteMessage
      })
    )

    act(() => {
      result.current.actions.toggleMultiSelectMode?.(true)
      result.current.actions.selectMessage?.('a', true)
    })
    setCacheValue.mockClear()
    popupConfirm.mockResolvedValueOnce(false)

    await act(async () => {
      await result.current.actions.deleteSelectedMessages?.(['a'])
    })

    expect(deleteMessage).not.toHaveBeenCalled()
    expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    expect(setCacheValue).not.toHaveBeenCalledWith('chat.selected_message_ids', [])
    expect(cacheValues['chat.multi_select_mode']).toBe(true)
    expect(cacheValues['chat.selected_message_ids']).toEqual(['a'])
  })
})

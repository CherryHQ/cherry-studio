import { MockUseCache } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem, MessageListSelectAllPagination } from '@renderer/components/chat/messages/types'
import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'
import type { CherryMessagePart } from '@shared/data/types/message'

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
    const initialProps: HookProps = {
      messages: [message('a')],
      partsByMessageId: { a: [{ type: 'text', text: 'old' }] as CherryMessagePart[] }
    }
    const { result, rerender } = renderHook(
      ({ messages, partsByMessageId }: HookProps) =>
        useMessageSelectionController({
          topicId: 'topic-1',
          messages,
          partsByMessageId
        }),
      { initialProps }
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
      ['u1', { selectedMessageIds: ['u1', 'a1'] }],
      ['a1', { selectedMessageIds: ['u1', 'a1'] }]
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

  describe('select all', () => {
    const renderController = (messages: MessageListItem[]) => {
      const utils = renderHook(
        ({ messages }: { messages: MessageListItem[] }) =>
          useMessageSelectionController({ topicId: 'topic-1', messages, partsByMessageId: {} }),
        { initialProps: { messages } }
      )
      return utils
    }

    it('selects every selectable message in order, skipping context boundaries and hidden multi-model siblings', () => {
      const messages: MessageListItem[] = [
        message('u1'),
        { ...message('divider'), isContextBoundary: true },
        { ...message('a-active'), role: 'assistant' as const, siblingsGroupId: 1, isActiveBranch: true },
        { ...message('a-hidden'), role: 'assistant' as const, siblingsGroupId: 1, isActiveBranch: false },
        message('u2')
      ]
      const { result } = renderController(messages)

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })

      expect(cacheValues['chat.selected_message_ids']).toEqual(['u1', 'a-active', 'u2'])
    })

    it('keeps single-model retry group representatives selectable despite carrying siblingsGroupId', () => {
      const messages: MessageListItem[] = [
        message('u1'),
        { ...message('a1'), role: 'assistant' as const, siblingsGroupId: 2, isActiveBranch: true }
      ]
      const { result } = renderController(messages)

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })

      expect(cacheValues['chat.selected_message_ids']).toEqual(['u1', 'a1'])
    })

    it('clears the selection when toggled off from fully selected', () => {
      const messages: MessageListItem[] = [message('a'), message('b')]
      const { result } = renderController(messages)

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      act(() => {
        result.current.actions.toggleSelectAllMessages?.(false)
      })

      expect(cacheValues['chat.selected_message_ids']).toEqual([])
    })

    it('reports indeterminate for a partial selection and completes it on toggle', () => {
      const messages: MessageListItem[] = [message('a'), message('b')]
      const { result, rerender } = renderController(messages)

      expect(result.current.selection.selectAllState).toBe(false)

      act(() => {
        result.current.actions.selectMessage?.('a', true)
      })
      rerender({ messages })
      expect(result.current.selection.selectAllState).toBe('indeterminate')

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      rerender({ messages })
      expect(result.current.selection.selectAllState).toBe(true)
      expect(cacheValues['chat.selected_message_ids']).toEqual(['a', 'b'])
    })

    it('marks select-all disabled for a topic without selectable messages', () => {
      const empty = renderController([])
      expect(empty.result.current.selection.selectAllState).toBe(false)
      expect(empty.result.current.selection.selectAllDisabled).toBe(true)

      const populated = renderController([message('a')])
      expect(populated.result.current.selection.selectAllDisabled).toBe(false)
    })
  })

  describe('select-all with server-side pagination', () => {
    interface PaginationProps {
      messages: MessageListItem[]
      pagination?: MessageListSelectAllPagination
    }

    const renderPaginatedController = (
      initialMessages: MessageListItem[],
      pagination?: Partial<MessageListSelectAllPagination>
    ) => {
      const handle: MessageListSelectAllPagination = {
        hasOlder: false,
        isLoading: false,
        start: vi.fn(),
        stop: vi.fn(),
        ...pagination
      }
      const utils = renderHook(
        ({ messages, pagination }: PaginationProps) =>
          useMessageSelectionController({
            topicId: 'topic-1',
            messages,
            partsByMessageId: {},
            selectAllPagination: pagination
          }),
        { initialProps: { messages: initialMessages, pagination: handle } }
      )
      return { ...utils, handle }
    }

    it('defers select-all and starts load-all when older pages remain', () => {
      const { result, handle } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })

      expect(handle.start).toHaveBeenCalledTimes(1)
      expect(cacheValues['chat.selected_message_ids']).toEqual([])
    })

    it('applies the deferred select-all once every page is loaded', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      // Pagination in flight: selection stays deferred and the loading flag is on.
      rerender({ messages: [message('a')], pagination: { ...handle, isLoading: true } })
      expect(result.current.selection.isSelectAllLoading).toBe(true)
      expect(cacheValues['chat.selected_message_ids']).toEqual([])

      // Last page arrives: no pages remain, so the pending select-all applies.
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })
      expect(result.current.selection.isSelectAllLoading).toBe(false)
      expect(cacheValues['chat.selected_message_ids']).toEqual(['a', 'b'])
    })

    it('keeps manual deselection made while the deferred select-all is loading', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      // The user has a manual selection, then requests select-all (deferred).
      act(() => {
        result.current.actions.selectMessage?.('a', true)
      })
      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      rerender({ messages: [message('a')], pagination: { ...handle, isLoading: true } })

      // Mid-load the user unticks a message they no longer want exported.
      act(() => {
        result.current.actions.selectMessage?.('a', false)
      })

      // Load completes — the late select-all must not silently re-tick 'a'.
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })
      // The mock cache setter does not re-render; render once more to observe it.
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })

      expect(cacheValues['chat.selected_message_ids']).toEqual(['b'])
      expect(result.current.selection.selectAllState).toBe('indeterminate')
    })

    it('re-includes a message re-ticked while the deferred select-all is loading', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.selectMessage?.('a', true)
      })
      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      rerender({ messages: [message('a')], pagination: { ...handle, isLoading: true } })
      act(() => {
        result.current.actions.selectMessage?.('a', false)
      })
      // Last action wins: the user changes their mind and re-ticks it.
      act(() => {
        result.current.actions.selectMessage?.('a', true)
      })

      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })
      // The mock cache setter does not re-render; render once more to observe it.
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })

      expect(cacheValues['chat.selected_message_ids']).toEqual(['a', 'b'])
      expect(result.current.selection.selectAllState).toBe(true)
    })

    it('resets exclusions on a fresh select-all once every page is loaded', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.selectMessage?.('a', true)
      })
      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      rerender({ messages: [message('a')], pagination: { ...handle, isLoading: true } })
      act(() => {
        result.current.actions.selectMessage?.('a', false)
      })
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })
      expect(cacheValues['chat.selected_message_ids']).toEqual(['b'])

      // The user clicks select-all again after landing: the previous cycle's
      // exclusions must not leak into this fresh "select everything" intent.
      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })

      expect(cacheValues['chat.selected_message_ids']).toEqual(['a', 'b'])
      expect(result.current.selection.selectAllState).toBe(true)
    })

    it('drops the deferred select-all when toggled off while loading', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      act(() => {
        result.current.actions.toggleSelectAllMessages?.(false)
      })
      rerender({ messages: [message('a'), message('b')], pagination: handle })

      expect(cacheValues['chat.selected_message_ids']).toEqual([])
    })

    it('drops the deferred select-all and stops paging when multi-select mode is exited mid-load', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      // The mount-time initial toggle already stopped idempotently — isolate
      // the stop call that belongs to the exit action itself.
      vi.mocked(handle.stop).mockClear()
      act(() => {
        result.current.actions.toggleMultiSelectMode?.(false)
      })
      rerender({ messages: [message('a'), message('b')], pagination: handle })

      expect(handle.stop).toHaveBeenCalledTimes(1)
      expect(cacheValues['chat.selected_message_ids']).toEqual([])
    })

    it('drops the pending select-all when load-all is abandoned mid-flight', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.toggleSelectAllMessages?.(true)
      })
      // Pagination starts, then a failed page fetch abandons it: loading
      // falls back to false while older pages still remain.
      rerender({ messages: [message('a')], pagination: { ...handle, isLoading: true } })
      rerender({ messages: [message('a')], pagination: handle })

      // The user pages to the end manually — the stale select-all must not fire.
      rerender({ messages: [message('a'), message('b')], pagination: { ...handle, hasOlder: false } })
      expect(cacheValues['chat.selected_message_ids']).toEqual([])
    })

    it('never reports fully selected while older pages remain unloaded', () => {
      const { result, handle, rerender } = renderPaginatedController([message('a')], { hasOlder: true })

      act(() => {
        result.current.actions.selectMessage?.('a', true)
      })
      rerender({ messages: [message('a')], pagination: handle })

      // Every loaded message is ticked, but unloaded pages exist — the
      // checkbox must not claim "all selected".
      expect(result.current.selection.selectAllState).toBe('indeterminate')

      rerender({ messages: [message('a')], pagination: { ...handle, hasOlder: false } })
      expect(result.current.selection.selectAllState).toBe(true)
    })
  })
})

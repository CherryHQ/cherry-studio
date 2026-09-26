import { MockUseCache } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MessageListItem, MessageListSelectAllPagination } from '@renderer/components/chat/messages/types'
import { toast } from '@renderer/services/toast'
import { COMPOSER_CLIPBOARD_FRAGMENT_MIME } from '@renderer/utils/message/composerClipboard'
import type { CherryMessagePart } from '@shared/data/types/message'

import { useMessageSelectionController } from '../useMessageSelectionController'

const { popupConfirm } = vi.hoisted(() => ({ popupConfirm: vi.fn() }))

vi.mock('@renderer/services/popup', () => ({
  popup: { confirm: popupConfirm }
}))

const { exportServiceMocks, ipcRequestMock, chooseImageExportModeMock, obsidianShowMock } = vi.hoisted(() => ({
  exportServiceMocks: {
    exportMessagesAsMarkdown: vi.fn(),
    exportMessagesToNotion: vi.fn(),
    exportMarkdownToYuque: vi.fn(),
    exportMarkdownToJoplin: vi.fn(),
    exportMarkdownToSiyuan: vi.fn(),
    getMessageTitle: vi.fn(),
    messagesToMarkdown: vi.fn()
  },
  ipcRequestMock: vi.fn(),
  chooseImageExportModeMock: vi.fn(),
  obsidianShowMock: vi.fn()
}))

vi.mock('@renderer/services/ExportService', () => exportServiceMocks)

vi.mock('@renderer/services/imageExportModeChooser', () => ({
  chooseImageExportMode: chooseImageExportModeMock
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('@renderer/components/ObsidianExportPopup', () => ({
  default: { show: obsidianShowMock }
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

  describe('exportSelectedMessages', () => {
    const partsByMessageId = {
      a: [{ type: 'text', text: 'first' }] as CherryMessagePart[],
      b: [{ type: 'text', text: 'second' }] as CherryMessagePart[]
    }

    const renderExportController = (topicName?: string) =>
      renderHook(() =>
        useMessageSelectionController({
          topicId: 'topic-1',
          topicName,
          messages: [message('a'), message('b')],
          partsByMessageId
        })
      )

    beforeEach(() => {
      exportServiceMocks.messagesToMarkdown.mockResolvedValue('combined-markdown')
      exportServiceMocks.getMessageTitle.mockResolvedValue('First title')
      exportServiceMocks.exportMessagesAsMarkdown.mockResolvedValue(true)
      exportServiceMocks.exportMessagesToNotion.mockResolvedValue(true)
      exportServiceMocks.exportMarkdownToYuque.mockResolvedValue({ id: 'doc-1' })
      exportServiceMocks.exportMarkdownToJoplin.mockResolvedValue({ id: 'note-1' })
      exportServiceMocks.exportMarkdownToSiyuan.mockResolvedValue(true)
      ipcRequestMock.mockResolvedValue(true)
      obsidianShowMock.mockResolvedValue(true)
    })

    it('exports markdown in conversation order and exits multi-select on success', async () => {
      const { result } = renderExportController('Topic name')
      // Drop the mount effect's initial cache writes so the exit below is the export's own.
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['b', 'a'], 'markdown')
      })

      expect(exportServiceMocks.exportMessagesAsMarkdown).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })]),
        false,
        'Topic name',
        chooseImageExportModeMock
      )
      const views = exportServiceMocks.exportMessagesAsMarkdown.mock.calls[0]?.[0]
      expect(views?.map((view) => view.id)).toEqual(['a', 'b'])
      expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
      expect(setCacheValue).toHaveBeenCalledWith('chat.selected_message_ids', [])
    })

    it('passes reasoning through for the markdown-with-reasoning target', async () => {
      const { result } = renderExportController('Topic name')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'markdown-reason')
      })

      expect(exportServiceMocks.exportMessagesAsMarkdown).toHaveBeenCalledWith(
        expect.any(Array),
        true,
        'Topic name',
        chooseImageExportModeMock
      )
    })

    it('falls back to the first message title when the topic has no name', async () => {
      const { result } = renderExportController()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a', 'b'], 'markdown')
      })

      expect(exportServiceMocks.getMessageTitle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
      expect(exportServiceMocks.exportMessagesAsMarkdown).toHaveBeenCalledWith(
        expect.any(Array),
        false,
        'First title',
        chooseImageExportModeMock
      )
    })

    it('keeps multi-select open when the markdown export is cancelled', async () => {
      exportServiceMocks.exportMessagesAsMarkdown.mockResolvedValueOnce(false)
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'markdown')
      })

      expect(toast.error).not.toHaveBeenCalled()
      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('exports word through the markdown-to-docx channel with the combined content', async () => {
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a', 'b'], 'word')
      })

      expect(exportServiceMocks.messagesToMarkdown).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })])
      )
      expect(ipcRequestMock).toHaveBeenCalledWith('export.word.from_markdown', {
        markdown: 'combined-markdown',
        fileName: 'Topic name'
      })
      expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('sanitizes the word filename like the topic-level export', async () => {
      const { result } = renderExportController('Report: Q1/Q2?')
      const { removeSpecialCharactersForFileName } = await import('@renderer/utils/file')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'word')
      })

      expect(ipcRequestMock).toHaveBeenCalledWith('export.word.from_markdown', {
        markdown: 'combined-markdown',
        fileName: removeSpecialCharactersForFileName('Report: Q1/Q2?')
      })
    })

    it('keeps multi-select open and surfaces an error when the word export fails', async () => {
      ipcRequestMock.mockRejectedValueOnce(new Error('docx failed'))
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'word')
      })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('chat.topics.export.failed'))
      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('keeps multi-select open when the word save dialog is cancelled', async () => {
      ipcRequestMock.mockResolvedValueOnce(false)
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'word')
      })

      expect(toast.error).not.toHaveBeenCalled()
      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('exports siyuan with the topic title and exits multi-select on success', async () => {
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'siyuan')
      })

      expect(exportServiceMocks.messagesToMarkdown).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'a' })])
      )
      expect(exportServiceMocks.exportMarkdownToSiyuan).toHaveBeenCalledWith('Topic name', 'combined-markdown')
      expect(setCacheValue).toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('keeps multi-select open when the siyuan export reports failure', async () => {
      exportServiceMocks.exportMarkdownToSiyuan.mockResolvedValueOnce(false)
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'siyuan')
      })

      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('exports notion with the topic title and the ordered views', async () => {
      const { result } = renderExportController('Topic name')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['b', 'a'], 'notion')
      })

      expect(exportServiceMocks.exportMessagesToNotion).toHaveBeenCalledWith(
        'Topic name',
        expect.arrayContaining([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })])
      )
      const views = exportServiceMocks.exportMessagesToNotion.mock.calls[0]?.[1]
      expect(views?.map((view) => view.id)).toEqual(['a', 'b'])
    })

    it('keeps multi-select open when the notion export reports failure', async () => {
      exportServiceMocks.exportMessagesToNotion.mockResolvedValueOnce(false)
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'notion')
      })

      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('keeps multi-select open when the yuque export returns nothing', async () => {
      exportServiceMocks.exportMarkdownToYuque.mockResolvedValueOnce(null)
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'yuque')
      })

      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('exports obsidian with the topic title and the selected views', async () => {
      const { result } = renderExportController('Topic name')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'obsidian')
      })

      expect(obsidianShowMock).toHaveBeenCalledWith({
        title: 'Topic name',
        messages: [expect.objectContaining({ id: 'a' })],
        processingMethod: '1'
      })
    })

    it('sanitizes backslashes in the obsidian title like the single-message export', async () => {
      const { result } = renderExportController('a\\b')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'obsidian')
      })

      expect(obsidianShowMock).toHaveBeenCalledWith({
        title: 'a_b',
        messages: [expect.objectContaining({ id: 'a' })],
        processingMethod: '1'
      })
    })

    it('keeps multi-select open when the obsidian popup is dismissed', async () => {
      obsidianShowMock.mockResolvedValueOnce(false)
      const { result } = renderExportController('Topic name')
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'obsidian')
      })

      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })

    it('trims the topic name before using it as the export title', async () => {
      const { result } = renderExportController('  Padded  ')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'notion')
      })

      expect(exportServiceMocks.exportMessagesToNotion).toHaveBeenCalledWith(
        'Padded',
        expect.arrayContaining([expect.objectContaining({ id: 'a' })])
      )
    })

    it('warns and exports nothing when no message is selected', async () => {
      const { result } = renderExportController('Topic name')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.([], 'markdown')
      })

      expect(toast.warning).toHaveBeenCalledWith('chat.multiple.select.empty')
      expect(exportServiceMocks.exportMessagesAsMarkdown).not.toHaveBeenCalled()
      expect(exportServiceMocks.messagesToMarkdown).not.toHaveBeenCalled()
    })

    it('warns when the selection resolves to no exportable views', async () => {
      const { result } = renderExportController('Topic name')

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['gone'], 'markdown')
      })

      expect(toast.warning).toHaveBeenCalledWith('chat.multiple.select.empty')
      expect(exportServiceMocks.exportMessagesAsMarkdown).not.toHaveBeenCalled()
    })

    it('keeps multi-select open and surfaces an error when title resolution fails', async () => {
      exportServiceMocks.getMessageTitle.mockRejectedValueOnce(new Error('offline'))
      const { result } = renderExportController()
      setCacheValue.mockClear()

      await act(async () => {
        await result.current.actions.exportSelectedMessages?.(['a'], 'markdown')
      })

      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('chat.topics.export.failed'))
      expect(setCacheValue).not.toHaveBeenCalledWith('chat.multi_select_mode', false)
    })
  })
})

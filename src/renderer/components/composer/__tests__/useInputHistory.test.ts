import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNextInputHistoryIndex, shouldHandleInputHistoryNavigation } from '../inputHistoryNavigation'
import type { ComposerSerializedDraft } from '../tokens'
import { useInputHistory } from '../useInputHistory'

beforeEach(() => {
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/input-history', [])
  MockUseDataApiUtils.mockMutationWithTrigger('POST', '/input-history', vi.fn())
  vi.clearAllMocks()
})

describe('getNextInputHistoryIndex', () => {
  it('moves to the latest history item when pressing ArrowUp from the draft state', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: -1,
        direction: 'up',
        messagesLength: 3
      })
    ).toBe(0)
  })

  it('moves toward older history with ArrowUp', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: 0,
        direction: 'up',
        messagesLength: 3
      })
    ).toBe(1)
  })

  it('stays on the oldest history item when pressing ArrowUp at the boundary', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: 2,
        direction: 'up',
        messagesLength: 3
      })
    ).toBe(2)
  })

  it('returns to draft state after ArrowDown from the latest history item', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: 0,
        direction: 'down',
        messagesLength: 3
      })
    ).toBe(-1)
  })

  it('stays in draft state when there is no history', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: -1,
        direction: 'up',
        messagesLength: 0
      })
    ).toBe(-1)
  })

  it('stays in draft state when pressing ArrowDown with no history', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: -1,
        direction: 'down',
        messagesLength: 0
      })
    ).toBe(-1)
  })

  it('stays in draft state when pressing ArrowDown while already in draft state with history present', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: -1,
        direction: 'down',
        messagesLength: 3
      })
    ).toBe(-1)
  })

  it('steps toward newer history with ArrowDown from an older entry', () => {
    expect(
      getNextInputHistoryIndex({
        currentIndex: 2,
        direction: 'down',
        messagesLength: 3
      })
    ).toBe(1)
  })
})

describe('shouldHandleInputHistoryNavigation', () => {
  it('handles ArrowUp when the composer is empty', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtEnd: false,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: ''
      })
    ).toBe(true)
  })

  it('handles ArrowDown when all text is selected', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: true,
        isComposing: false,
        isCursorAtEnd: false,
        isQuickPanelVisible: false,
        key: 'ArrowDown',
        text: 'draft'
      })
    ).toBe(true)
  })

  it('handles navigation when the cursor is at the end of non-empty text', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtEnd: true,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: 'draft'
      })
    ).toBe(true)
  })

  it('handles whitespace-only text (treats as empty for navigation)', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtEnd: false,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: '   '
      })
    ).toBe(true)
  })

  it('handles navigation when all selection and cursor-at-end flags are simultaneously true', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: true,
        isComposing: false,
        isCursorAtEnd: true,
        isQuickPanelVisible: false,
        key: 'ArrowDown',
        text: 'draft'
      })
    ).toBe(true)
  })

  it('ignores navigation during IME composition', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: true,
        isComposing: true,
        isCursorAtEnd: true,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: 'draft'
      })
    ).toBe(false)
  })

  it('ignores navigation while the quick panel is visible', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: true,
        isComposing: false,
        isCursorAtEnd: true,
        isQuickPanelVisible: true,
        key: 'ArrowUp',
        text: 'draft'
      })
    ).toBe(false)
  })

  it('ignores non-arrow keys', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: true,
        isComposing: false,
        isCursorAtEnd: true,
        isQuickPanelVisible: false,
        key: 'Enter',
        text: 'draft'
      })
    ).toBe(false)
  })

  it('ignores non-empty text when the cursor is not at the end and text is not selected', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtEnd: false,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: 'draft'
      })
    ).toBe(false)
  })

  it('prioritizes IME composition guard over an otherwise valid empty-text navigation', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: true,
        isCursorAtEnd: false,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: ''
      })
    ).toBe(false)
  })

  it('prioritizes quick panel visibility guard over an otherwise valid cursor-at-end navigation', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtEnd: true,
        isQuickPanelVisible: true,
        key: 'ArrowUp',
        text: 'draft'
      })
    ).toBe(false)
  })
})

const sampleHistoryEntry = (index: number) => ({
  id: `019b0000-0000-7000-8000-00000000000${index}`,
  content: `history-${index}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
})

const draftWithText = (text: string): ComposerSerializedDraft => ({ text, tokens: [] })

describe('useInputHistory', () => {
  it('restores the draft that was active before entering history navigation', () => {
    MockUseDataApiUtils.mockQueryData('/input-history', [sampleHistoryEntry(1)])
    const draftBeforeHistory: ComposerSerializedDraft = {
      text: 'current draft',
      tokens: [
        {
          id: 'skill:pdf',
          kind: 'skill',
          label: 'pdf',
          index: 0,
          textOffset: 0
        }
      ]
    }
    const appliedDrafts: ComposerSerializedDraft[] = []

    const { result } = renderHook(() =>
      useInputHistory({
        applyDraft: (value) => appliedDrafts.push(value)
      })
    )

    act(() => {
      expect(result.current.navigateHistory('up', draftBeforeHistory)).toBe(true)
    })
    expect(appliedDrafts).toEqual([{ text: 'history-1', tokens: [] }])

    act(() => {
      expect(result.current.navigateHistory('down', { text: 'history-1', tokens: [] })).toBe(true)
    })
    expect(appliedDrafts).toEqual([{ text: 'history-1', tokens: [] }, draftBeforeHistory])
  })

  describe('saveHistory', () => {
    it('persists non-empty content via the mutation trigger', async () => {
      const trigger = vi.fn().mockResolvedValue({ success: true })
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/input-history', trigger)

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      await act(async () => {
        await result.current.saveHistory('hello world')
      })

      expect(trigger).toHaveBeenCalledWith({ body: { content: 'hello world' } })
    })

    it('trims surrounding whitespace before persisting', async () => {
      const trigger = vi.fn().mockResolvedValue({ success: true })
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/input-history', trigger)

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      await act(async () => {
        await result.current.saveHistory('  hello  ')
      })

      expect(trigger).toHaveBeenCalledWith({ body: { content: 'hello' } })
    })

    it('short-circuits without calling the trigger for whitespace-only content', async () => {
      const trigger = vi.fn().mockResolvedValue({ success: true })
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/input-history', trigger)

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      await act(async () => {
        await result.current.saveHistory('     ')
      })

      expect(trigger).not.toHaveBeenCalled()
    })

    it('propagates errors from the mutation trigger to the caller', async () => {
      const failure = new Error('network down')
      const trigger = vi.fn().mockRejectedValueOnce(failure)
      MockUseDataApiUtils.mockMutationWithTrigger('POST', '/input-history', trigger)

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      await expect(result.current.saveHistory('hello')).rejects.toBe(failure)
    })
  })

  describe('navigateHistory return value', () => {
    it('returns false when there is no history at all', () => {
      MockUseDataApiUtils.mockQueryData('/input-history', [])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      act(() => {
        expect(result.current.navigateHistory('up', draftWithText('draft'))).toBe(false)
      })
      expect(appliedDrafts).toEqual([])
    })

    it('returns false at the oldest boundary when pressing ArrowUp repeatedly', () => {
      MockUseDataApiUtils.mockQueryData('/input-history', [sampleHistoryEntry(0)])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      act(() => {
        result.current.navigateHistory('up', draftWithText('draft'))
      })
      // After first ArrowUp: historyIndex=0. Second ArrowUp at the oldest entry (length=1)
      // computes nextIndex=0 which equals historyIndex → returns false without applying.
      act(() => {
        expect(result.current.navigateHistory('up', draftWithText('history-0'))).toBe(false)
      })
      expect(appliedDrafts).toEqual([{ text: 'history-0', tokens: [] }])
    })

    it('returns false when pressing ArrowDown from the draft state', () => {
      MockUseDataApiUtils.mockQueryData('/input-history', [sampleHistoryEntry(0)])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      act(() => {
        expect(result.current.navigateHistory('down', draftWithText('draft'))).toBe(false)
      })
      expect(appliedDrafts).toEqual([])
    })
  })

  describe('entry snapshot (draftBeforeHistoryRef)', () => {
    it('snapshots the entry draft only on the first ArrowUp, not on subsequent presses', () => {
      MockUseDataApiUtils.mockQueryData('/input-history', [
        sampleHistoryEntry(0),
        sampleHistoryEntry(1),
        sampleHistoryEntry(2)
      ])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      const entryDraft = draftWithText('original draft')
      // history[0] is the newest, so first ArrowUp shows "history-0".
      act(() => {
        result.current.navigateHistory('up', entryDraft)
      })
      // Caller would now pass the currently displayed history-0 text.
      act(() => {
        result.current.navigateHistory('up', draftWithText('history-0'))
      })
      // Walk all the way back to the draft. The 3rd step hits the entry draft
      // and must NOT be the intermediate "history-0" value passed on the 2nd ArrowUp.
      act(() => {
        result.current.navigateHistory('down', draftWithText('history-1'))
      })
      act(() => {
        result.current.navigateHistory('down', draftWithText('history-0'))
      })

      expect(appliedDrafts).toEqual([
        { text: 'history-0', tokens: [] },
        { text: 'history-1', tokens: [] },
        { text: 'history-0', tokens: [] },
        entryDraft
      ])
    })
  })

  describe('navigateHistory safety with mismatched history', () => {
    it('does not clear the composer when the history is empty even if a previous navigation set a non-trivial index', () => {
      // Render with a non-empty history, enter navigation.
      MockUseDataApiUtils.mockQueryData('/input-history', [sampleHistoryEntry(0)])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result, rerender } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      act(() => {
        result.current.navigateHistory('up', draftWithText('entry'))
      })
      expect(appliedDrafts).toEqual([{ text: 'history-0', tokens: [] }])

      // Simulate a refetch that empties the list.
      MockUseDataApiUtils.mockQueryData('/input-history', [])
      rerender()

      // navigateHistory must return false (no transition possible) AND not clear
      // the composer with an empty value.
      act(() => {
        expect(result.current.navigateHistory('up', draftWithText('history-0'))).toBe(false)
      })
      expect(appliedDrafts).toEqual([{ text: 'history-0', tokens: [] }])
    })
  })

  describe('resetHistoryIndex', () => {
    it('returns to draft state and clears the snapshot, so a later ArrowUp snapshots the new draft', () => {
      MockUseDataApiUtils.mockQueryData('/input-history', [sampleHistoryEntry(0)])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      act(() => {
        result.current.navigateHistory('up', draftWithText('before reset'))
      })
      expect(appliedDrafts).toEqual([{ text: 'history-0', tokens: [] }])

      // After reset, ArrowDown must NOT restore the old snapshot — it should be a no-op
      // (already at -1, getNextInputHistoryIndex returns -1, navigateHistory returns false).
      act(() => {
        result.current.resetHistoryIndex()
      })
      act(() => {
        expect(result.current.navigateHistory('down', draftWithText('history-0'))).toBe(false)
      })

      // A subsequent ArrowUp should snapshot the NEW current draft, not the old one.
      const newDraft = draftWithText('after reset')
      act(() => {
        result.current.navigateHistory('up', newDraft)
      })
      act(() => {
        result.current.navigateHistory('down', draftWithText('history-0'))
      })
      expect(appliedDrafts[appliedDrafts.length - 1]).toEqual(newDraft)
    })
  })
})

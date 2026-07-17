import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNextInputHistoryIndex, shouldHandleInputHistoryNavigation } from '../inputHistoryNavigation'
import type { ComposerSerializedDraft } from '../tokens'
import { INPUT_HISTORY_LIMIT, useInputHistory } from '../useInputHistory'

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
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
        isCursorAtHistoryBoundary: false,
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
        isCursorAtHistoryBoundary: false,
        isQuickPanelVisible: false,
        key: 'ArrowDown',
        text: 'draft'
      })
    ).toBe(true)
  })

  it('handles navigation when the cursor is at the history boundary of non-empty text', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtHistoryBoundary: true,
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
        isCursorAtHistoryBoundary: false,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: '   '
      })
    ).toBe(true)
  })

  it('handles navigation when all selection and history-boundary flags are simultaneously true', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: true,
        isComposing: false,
        isCursorAtHistoryBoundary: true,
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
        isCursorAtHistoryBoundary: true,
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
        isCursorAtHistoryBoundary: true,
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
        isCursorAtHistoryBoundary: true,
        isQuickPanelVisible: false,
        key: 'Enter',
        text: 'draft'
      })
    ).toBe(false)
  })

  it('ignores non-empty text when the cursor is not at the history boundary and text is not selected', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtHistoryBoundary: false,
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
        isCursorAtHistoryBoundary: false,
        isQuickPanelVisible: false,
        key: 'ArrowUp',
        text: ''
      })
    ).toBe(false)
  })

  it('prioritizes quick panel visibility guard over an otherwise valid history-boundary navigation', () => {
    expect(
      shouldHandleInputHistoryNavigation({
        isAllSelected: false,
        isComposing: false,
        isCursorAtHistoryBoundary: true,
        isQuickPanelVisible: true,
        key: 'ArrowUp',
        text: 'draft'
      })
    ).toBe(false)
  })
})

const sampleHistoryEntry = (index: number) => `history-${index}`

const seedHistory = (items: string[]) => {
  MockUseCacheUtils.setPersistCacheValue('ui.composer.input_history', items)
}

const draftWithText = (text: string): ComposerSerializedDraft => ({ text, tokens: [] })

describe('useInputHistory', () => {
  it('restores the draft that was active before entering history navigation', () => {
    seedHistory([sampleHistoryEntry(1)])
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
    it('persists non-empty content in the renderer persist cache', () => {
      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      act(() => {
        result.current.saveHistory('hello world')
      })

      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['hello world'])
    })

    it('trims surrounding whitespace before persisting', () => {
      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      act(() => {
        result.current.saveHistory('  hello  ')
      })

      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['hello'])
    })

    it('short-circuits without changing cache for whitespace-only content', () => {
      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      act(() => {
        result.current.saveHistory('     ')
      })

      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual([])
    })

    it('moves duplicate content to the latest position', () => {
      seedHistory(['repeat', 'other'])

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      act(() => {
        result.current.saveHistory('other')
      })

      expect(MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')).toEqual(['other', 'repeat'])
    })

    it('keeps only the configured number of recent entries', () => {
      seedHistory(Array.from({ length: INPUT_HISTORY_LIMIT }, (_, index) => `content-${index}`))

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: () => undefined
        })
      )

      act(() => {
        result.current.saveHistory('newest')
      })

      const history = MockUseCacheUtils.getPersistCacheValue('ui.composer.input_history')
      expect(history).toHaveLength(INPUT_HISTORY_LIMIT)
      expect(history[0]).toBe('newest')
      expect(history).not.toContain(`content-${INPUT_HISTORY_LIMIT - 1}`)
    })
  })

  describe('navigateHistory return value', () => {
    it('returns false when there is no history at all', () => {
      seedHistory([])
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

    it('returns true at the oldest boundary so the editor does not handle ArrowUp', () => {
      seedHistory([sampleHistoryEntry(0)])
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
      // computes nextIndex=0 which equals historyIndex, but it must still be
      // handled so ProseMirror does not move the caret/scroll while browsing history.
      act(() => {
        expect(result.current.navigateHistory('up', draftWithText('history-0'))).toBe(true)
      })
      expect(appliedDrafts).toEqual([{ text: 'history-0', tokens: [] }])
    })

    it('returns false when pressing ArrowDown from the draft state', () => {
      seedHistory([sampleHistoryEntry(0)])
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
      seedHistory([sampleHistoryEntry(0), sampleHistoryEntry(1), sampleHistoryEntry(2)])
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

    it('keeps the active navigation list stable when another window prepends history', () => {
      seedHistory(['old latest'])
      const appliedDrafts: ComposerSerializedDraft[] = []

      const { result, rerender } = renderHook(() =>
        useInputHistory({
          applyDraft: (value) => appliedDrafts.push(value)
        })
      )

      act(() => {
        expect(result.current.navigateHistory('up', draftWithText('draft before history'))).toBe(true)
      })
      expect(appliedDrafts).toEqual([{ text: 'old latest', tokens: [] }])

      seedHistory(['new latest', 'old latest'])
      rerender()

      act(() => {
        expect(result.current.navigateHistory('down', draftWithText('old latest'))).toBe(true)
      })

      expect(appliedDrafts).toEqual([{ text: 'old latest', tokens: [] }, draftWithText('draft before history')])
    })
  })

  describe('navigateHistory safety with mismatched history', () => {
    it('does not clear the composer when the history is empty even if a previous navigation set a non-trivial index', () => {
      // Render with a non-empty history, enter navigation.
      seedHistory([sampleHistoryEntry(0)])
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

      // Simulate an external cache update that empties the list.
      seedHistory([])
      rerender()

      // navigateHistory must keep the active navigation snapshot and not clear
      // the composer with an empty value even though the backing cache is now empty.
      act(() => {
        expect(result.current.navigateHistory('up', draftWithText('history-0'))).toBe(true)
      })
      expect(appliedDrafts).toEqual([{ text: 'history-0', tokens: [] }])
    })
  })

  describe('resetHistoryIndex', () => {
    it('returns to draft state and clears the snapshot, so a later ArrowUp snapshots the new draft', () => {
      seedHistory([sampleHistoryEntry(0)])
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

  describe('takeDraftBeforeHistory', () => {
    it('returns the pre-history draft once and clears active navigation', () => {
      seedHistory([sampleHistoryEntry(0)])
      const originalDraft = draftWithText('live draft')

      const { result } = renderHook(() =>
        useInputHistory({
          applyDraft: vi.fn()
        })
      )

      act(() => {
        result.current.navigateHistory('up', originalDraft)
      })

      let takenDraft: ComposerSerializedDraft | null = null
      act(() => {
        takenDraft = result.current.takeDraftBeforeHistory()
      })
      expect(takenDraft).toEqual(originalDraft)

      act(() => {
        expect(result.current.navigateHistory('down', draftWithText('history-0'))).toBe(false)
      })
      act(() => {
        expect(result.current.takeDraftBeforeHistory()).toBeNull()
      })
    })
  })
})

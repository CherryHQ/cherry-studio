import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryState, saveInputHistoryMock } = vi.hoisted(() => ({
  queryState: {
    data: [] as Array<{ id: string; content: string; createdAt: string; updatedAt: string }>
  },
  saveInputHistoryMock: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useMutation: vi.fn(() => ({ trigger: saveInputHistoryMock })),
  useQuery: vi.fn(() => ({ data: queryState.data }))
}))

import { getNextInputHistoryIndex, shouldHandleInputHistoryNavigation } from '../inputHistoryNavigation'
import { useInputHistory } from '../useInputHistory'

beforeEach(() => {
  queryState.data = []
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
})

describe('useInputHistory', () => {
  it('restores the draft that was active before entering history navigation', () => {
    queryState.data = [
      {
        id: '019b0000-0000-7000-8000-000000000001',
        content: 'latest history',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
    const appliedText: string[] = []

    const { result } = renderHook(() =>
      useInputHistory({
        applyText: (value) => appliedText.push(value)
      })
    )

    act(() => {
      expect(result.current.navigateHistory('up', 'current draft')).toBe(true)
    })
    expect(appliedText).toEqual(['latest history'])

    act(() => {
      expect(result.current.navigateHistory('down', 'latest history')).toBe(true)
    })
    expect(appliedText).toEqual(['latest history', 'current draft'])
  })
})

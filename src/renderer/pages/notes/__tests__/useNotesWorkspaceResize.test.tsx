import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUsePreferenceUtils, mockUsePreference } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'

import {
  DEFAULT_NOTES_WORKSPACE_WIDTH,
  MAX_NOTES_WORKSPACE_WIDTH,
  MIN_NOTES_WORKSPACE_WIDTH,
  useNotesWorkspaceResize
} from '../hooks/useNotesWorkspaceResize'
import { NotesSidebarResizeHandle } from '../NotesSidebarResizeHandle'

vi.mock('@cherrystudio/ui', async () => {
  const { Separator } = await import('@cherrystudio/ui/components/primitives/separator')
  return { Separator }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'common.resize_panel' ? 'Resize panel' : key) })
}))

const widthKey = 'feature.notes.workspace_width'
const showKey = 'feature.notes.show_workspace'
const originalPreferenceImplementation = mockUsePreference.getMockImplementation()!

function Harness() {
  const { workspaceWidth, isResizing, resizeTransitionActive, onResizeStart, onResize } = useNotesWorkspaceResize()
  return (
    <div id="notes-workspace">
      <output data-testid="width" data-transition-active={resizeTransitionActive}>
        {workspaceWidth}
      </output>
      <NotesSidebarResizeHandle
        width={workspaceWidth}
        isResizing={isResizing}
        onResizeStart={onResizeStart}
        onResize={onResize}
      />
    </div>
  )
}

const separator = () => screen.getByRole('separator', { name: 'Resize panel' })
const expectWidth = (width: number) => {
  expect(screen.getByTestId('width')).toHaveTextContent(String(width))
  expect(separator()).toHaveAttribute('aria-valuenow', String(width))
}
const expectSavedWidth = async (width: number) => {
  await waitFor(() => {
    expect(mockPreferenceState.get(widthKey)).toBe(width)
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'false')
    expectWidth(width)
  })
}

function mockQueuedWidthWrites() {
  MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
  const writes: { width: number; resolve: () => void; reject: (error: Error) => void }[] = []
  const persistedWidths: number[] = []
  let queue = Promise.resolve()
  let nextSettlement = 0
  const setValue = vi.fn(async (width: number) => {
    const previousWidth = mockPreferenceState.get(widthKey)
    MockUsePreferenceUtils.setPreferenceValue(widthKey, width)
    try {
      await new Promise<void>((resolve, reject) => writes.push({ width, resolve, reject }))
      persistedWidths.push(width)
    } catch (error) {
      MockUsePreferenceUtils.setPreferenceValue(widthKey, previousWidth)
      throw error
    }
  })
  const enqueue = (width: number) => {
    const request = queue.then(() => setValue(width))
    queue = request.catch(() => {})
    return request
  }
  mockUsePreference.mockImplementation(function useQueuedPreference(key) {
    const value = useSyncExternalStore(
      (notify) => MockUsePreferenceUtils.addSubscriber(key, notify),
      () => mockPreferenceState.get(key)
    )
    return [value, enqueue]
  })
  return {
    setValue,
    persistedWidths,
    settleNext: async (error?: Error) => {
      const write = writes[nextSettlement++]
      expect(write).toBeDefined()
      await act(async () => {
        if (error) write.reject(error)
        else write.resolve()
      })
    }
  }
}

async function pressResizeKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(separator(), { key })
  })
}

function deferWidthWrites() {
  const pending: ReturnType<typeof Promise.withResolvers<void>>[] = []
  let queue = Promise.resolve()
  const setValue = (width: number) => {
    const write = queue.then(async () => {
      const committedWidth = mockPreferenceState.get(widthKey) ?? 250
      const deferred = Promise.withResolvers<void>()
      pending.push(deferred)
      MockUsePreferenceUtils.mockPreferenceReturn(widthKey, width, setValue)
      try {
        await deferred.promise
        MockUsePreferenceUtils.setPreferenceValue(widthKey, width)
      } catch (error) {
        MockUsePreferenceUtils.mockPreferenceReturn(widthKey, committedWidth, setValue)
        throw error
      }
    })
    queue = write.catch(() => {})
    return write
  }
  MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
  MockUsePreferenceUtils.mockPreferenceReturn(widthKey, 250, setValue)
  return pending
}

describe('useNotesWorkspaceResize with the real resize handle', () => {
  beforeEach(() => {
    mockUsePreference.mockImplementation(originalPreferenceImplementation)
    MockUsePreferenceUtils.resetMocks()
    vi.clearAllMocks()
    MockUsePreferenceUtils.setPreferenceValue(showKey, true)
  })

  afterEach(() => {
    cleanup()
    mockUsePreference.mockImplementation(originalPreferenceImplementation)
    vi.restoreAllMocks()
  })

  it('defaults to 250 without creating a preference on mount', () => {
    expect(DEFAULT_NOTES_WORKSPACE_WIDTH).toBe(250)
    expect(MIN_NOTES_WORKSPACE_WIDTH).toBe(200)
    expect(MAX_NOTES_WORKSPACE_WIDTH).toBe(480)
    expect(DefaultPreferences.default[widthKey]).toBe(250)
    expect(mockPreferenceState.has(widthKey)).toBe(false)

    render(<Harness />)

    expectWidth(250)
    expect(mockPreferenceState.has(widthKey)).toBe(false)
    expect(separator()).toHaveAttribute('aria-orientation', 'vertical')
    expect(separator()).toHaveAttribute('aria-valuemin', '200')
    expect(separator()).toHaveAttribute('aria-valuemax', '480')
    expect(separator()).toHaveAttribute('aria-controls', 'notes-workspace')
  })

  it('also falls back to 250 when the preference has not been read yet', () => {
    MockUsePreferenceUtils.mockPreferenceReturn(widthKey, undefined)
    render(<Harness />)
    expectWidth(250)
    expect(mockPreferenceState.has(widthKey)).toBe(false)
  })

  it('previews the pointer delta and submits only on release without hiding the tree', async () => {
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
    document.body.style.cursor = 'grab'
    document.body.style.userSelect = 'text'
    render(<Harness />)

    fireEvent.mouseDown(separator(), { button: 0, clientX: 413 })
    fireEvent.mouseMove(document, { clientX: 493 })
    expectWidth(330)
    expect(mockPreferenceState.get(widthKey)).toBe(250)
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'true')

    fireEvent.mouseUp(document)
    await expectSavedWidth(330)
    expect(mockPreferenceState.get(showKey)).toBe(true)
    expect(document.body.style.cursor).toBe('grab')
    expect(document.body.style.userSelect).toBe('text')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  it.each([
    [-1000, 200],
    [1000, 480]
  ])('clamps a pointer displacement of %s to %s without hiding the tree', async (delta, expected) => {
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
    render(<Harness />)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 400 + delta })
    expectWidth(expected)
    expect(mockPreferenceState.get(widthKey)).toBe(250)
    fireEvent.mouseUp(document)
    await expectSavedWidth(expected)
    expect(mockPreferenceState.get(showKey)).toBe(true)
  })

  it.each([
    [100, 200],
    [900, 480],
    [250, 250]
  ])('renders stored %s as %s without rewriting it on mount', (stored, expected) => {
    MockUsePreferenceUtils.setPreferenceValue(widthKey, stored)
    render(<Harness />)
    expectWidth(expected)
    expect(mockPreferenceState.get(widthKey)).toBe(stored)
  })

  it('keeps the last move when several moves and release happen before a preview render', async () => {
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
    render(<Harness />)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 420 }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }))
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 483.5 }))
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
    await expectSavedWidth(333.5)
  })

  it('follows a later preference read on rerender and remount without writing', () => {
    const { rerender, unmount } = render(<Harness />)
    expectWidth(250)
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 380)
    rerender(<Harness />)
    expectWidth(380)
    unmount()
    render(<Harness />)
    expectWidth(380)
    expect(mockPreferenceState.get(widthKey)).toBe(380)
  })

  it('can be tabbed to and saves the four keyboard operations within the bounds', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
    const { rerender } = render(<Harness />)
    await user.tab()
    expect(separator()).toHaveFocus()

    for (const [key, expected] of [
      ['{ArrowRight}', 266],
      ['{ArrowLeft}', 250],
      ['{Home}', 200],
      ['{ArrowLeft}', 200],
      ['{End}', 480],
      ['{ArrowRight}', 480]
    ] as const) {
      await user.keyboard(key)
      rerender(<Harness />)
      await expectSavedWidth(expected)
    }
    expect(mockPreferenceState.get(showKey)).toBe(true)
  })

  it('does not consume unrelated keys or submit a width for them', () => {
    render(<Harness />)
    expect(fireEvent.keyDown(separator(), { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(separator(), { key: 'ArrowDown' })).toBe(true)
    expect(mockPreferenceState.has(widthKey)).toBe(false)
  })

  it('persists the final Home in Home → End → Home while writes are pending', async () => {
    const user = userEvent.setup()
    const pending = deferWidthWrites()
    const { rerender } = render(<Harness />)
    await user.tab()
    await user.keyboard('{Home}')
    rerender(<Harness />)
    await user.keyboard('{End}{Home}')

    while (pending.length > 0) {
      await act(async () => pending.shift()!.resolve())
      rerender(<Harness />)
    }

    await expectSavedWidth(200)
  })

  it('accumulates three ArrowRight presses from 250 while writes are pending', async () => {
    const user = userEvent.setup()
    const pending = deferWidthWrites()
    const { rerender } = render(<Harness />)
    await user.tab()
    await user.keyboard('{ArrowRight}')
    rerender(<Harness />)
    await user.keyboard('{ArrowRight}{ArrowRight}')

    while (pending.length > 0) {
      await act(async () => pending.shift()!.resolve())
      rerender(<Harness />)
    }

    await expectSavedWidth(298)
  })

  it.each(['succeeds', 'fails'])('keeps the latest preview after a superseded failure until it %s', async (outcome) => {
    const user = userEvent.setup()
    const pending = deferWidthWrites()
    const { rerender } = render(<Harness />)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 480 })
    fireEvent.mouseUp(document)
    await act(async () => {})
    rerender(<Harness />)
    separator().focus()
    await user.keyboard('{End}')

    await act(async () => pending.shift()!.reject(new Error('superseded save failed')))
    rerender(<Harness />)
    expectWidth(480)
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'true')
    expect(toast.error).not.toHaveBeenCalled()

    if (outcome === 'succeeds') {
      await act(async () => pending.shift()!.resolve())
      rerender(<Harness />)
      await expectSavedWidth(480)
      expect(toast.error).not.toHaveBeenCalled()
    } else {
      await act(async () => pending.shift()!.reject(new Error('latest save failed')))
      rerender(<Harness />)
      expectWidth(250)
      expect(mockPreferenceState.get(widthKey)).toBe(250)
      expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'false')
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('notes.settings.save_failed')
    }
  })

  it.each([1, 2])('ignores mouse button %s', (button) => {
    render(<Harness />)
    fireEvent.mouseDown(separator(), { button, clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 480 })
    fireEvent.mouseUp(document)
    expectWidth(250)
    expect(mockPreferenceState.has(widthKey)).toBe(false)
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'false')
  })

  it('does not write for a click or a drag that returns to its starting width', () => {
    render(<Harness />)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    fireEvent.mouseUp(document)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 480 })
    fireEvent.mouseMove(document, { clientX: 400 })
    fireEvent.mouseUp(document)
    expectWidth(250)
    expect(mockPreferenceState.has(widthKey)).toBe(false)
  })

  it('submits the last preview when the window loses focus', async () => {
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
    render(<Harness />)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 460 })
    fireEvent.blur(window)
    await expectSavedWidth(310)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('reports a rejected save and removes the unsaved preview', async () => {
    MockUsePreferenceUtils.setPreferenceValue(widthKey, 250)
    MockUsePreferenceUtils.mockPreferenceError(widthKey, new Error('save failed'))
    render(<Harness />)
    fireEvent.mouseDown(separator(), { button: 0, clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 480 })
    expectWidth(330)
    fireEvent.mouseUp(document)

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('notes.settings.save_failed')
      expectWidth(250)
      expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'false')
    })
    expect(mockPreferenceState.get(widthKey)).toBe(250)
  })

  it('persists the last Home when Home, End and Home overlap', async () => {
    const { persistedWidths, setValue, settleNext } = mockQueuedWidthWrites()
    render(<Harness />)

    await pressResizeKey('Home')
    await pressResizeKey('End')
    await pressResizeKey('Home')
    expect(setValue.mock.calls.map(([width]) => width)).toEqual([200])

    await settleNext()
    await settleNext()
    expect(setValue.mock.calls.map(([width]) => width)).toEqual([200, 480, 200])
    await settleNext()

    expect(persistedWidths).toEqual([200, 480, 200])
    await expectSavedWidth(200)
  })

  it('accumulates three ArrowRight steps while the first write is pending', async () => {
    const { persistedWidths, setValue, settleNext } = mockQueuedWidthWrites()
    render(<Harness />)

    await pressResizeKey('ArrowRight')
    await pressResizeKey('ArrowRight')
    await pressResizeKey('ArrowRight')
    expect(setValue.mock.calls.map(([width]) => width)).toEqual([266])
    expectWidth(298)

    await settleNext()
    await settleNext()
    await settleNext()

    expect(persistedWidths).toEqual([266, 282, 298])
    await expectSavedWidth(298)
  })

  it('keeps the preview transition active until all three writes settle', async () => {
    const { settleNext } = mockQueuedWidthWrites()
    render(<Harness />)

    await pressResizeKey('Home')
    await pressResizeKey('ArrowRight')
    await pressResizeKey('End')
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'true')

    await settleNext()
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'true')
    expectWidth(480)
    expect(mockPreferenceState.get(widthKey)).toBe(216)

    await settleNext()
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'true')
    expectWidth(480)

    await settleNext()
    await expectSavedWidth(480)
  })

  it('rolls back a rejected latest queued target and retries the same width', async () => {
    const { persistedWidths, setValue, settleNext } = mockQueuedWidthWrites()
    render(<Harness />)

    await pressResizeKey('Home')
    await pressResizeKey('End')
    expectWidth(480)
    await settleNext()
    await settleNext(new Error('latest save failed'))

    expect(toast.error).toHaveBeenCalledWith('notes.settings.save_failed')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expectWidth(200)
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'false')
    expect(persistedWidths).toEqual([200])

    await pressResizeKey('End')
    expect(setValue.mock.calls.map(([width]) => width)).toEqual([200, 480, 480])
    await settleNext()
    expect(persistedWidths).toEqual([200, 480])
    await expectSavedWidth(480)
  })

  it('preserves a newer target when a superseded write rejects', async () => {
    const { persistedWidths, settleNext } = mockQueuedWidthWrites()
    render(<Harness />)

    await pressResizeKey('Home')
    await pressResizeKey('End')
    await pressResizeKey('Home')
    await settleNext(new Error('superseded save failed'))

    expect(toast.error).not.toHaveBeenCalled()
    expectWidth(200)
    expect(mockPreferenceState.get(widthKey)).toBe(480)
    expect(screen.getByTestId('width')).toHaveAttribute('data-transition-active', 'true')

    await settleNext()
    expectWidth(200)
    await settleNext()
    expect(persistedWidths).toEqual([480, 200])
    await expectSavedWidth(200)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

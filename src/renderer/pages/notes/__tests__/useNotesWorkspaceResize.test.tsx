import { mockPreferenceState } from '@test-mocks/renderer/PreferenceService'
import { MockUsePreferenceUtils, mockUsePreference } from '@test-mocks/renderer/usePreference'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
})

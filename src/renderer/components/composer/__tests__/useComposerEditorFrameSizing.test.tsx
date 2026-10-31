import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTimer } from '@renderer/hooks/useTimer'

import { ComposerContextProvider, type ComposerOverride } from '../ComposerContext'
import ComposerCore from '../ComposerCore'
import { useComposerEditorFrameSizing } from '../useComposerEditorFrameSizing'

let stageHeight = 700
let chromeHeight = 100

function EditorFrame() {
  const [expanded, setExpanded] = useState(false)
  const { setTimeoutTimer } = useTimer()
  const sizing = useComposerEditorFrameSizing({
    fontSize: 14,
    isExpanded: expanded,
    onExpandedChange: setExpanded,
    focusEditor: () => undefined,
    setTimeoutTimer
  })
  return (
    <div data-composer-inputbar="">
      <div ref={sizing.frameRef} data-composer-editor-frame="" style={sizing.frameStyle}>
        <div style={sizing.editorContentStyle}>
          <div className="composer-tiptap" />
        </div>
      </div>
      <button type="button" onClick={() => sizing.toggleExpanded(true)}>
        Expand
      </button>
      <button type="button" onClick={sizing.fitContentHeight}>
        Fit pasted content
      </button>
      <button
        type="button"
        role="separator"
        aria-label="Resize input"
        aria-orientation="horizontal"
        aria-valuemin={sizing.minHeight}
        aria-valuemax={sizing.maxHeight}
        aria-valuenow={sizing.resizeHandleValue}
        onKeyDown={sizing.handleResizeKeyDown}
      />
      <output aria-label="Sizing mode">{sizing.hasCustomHeight ? 'fixed' : 'auto'}</output>
    </div>
  )
}

function Harness({ overrides = [] }: { overrides?: readonly ComposerOverride[] }) {
  return (
    <div data-composer-stage="">
      <div data-composer-dock-surface="">
        <ComposerContextProvider value={{ overrides }}>
          <ComposerCore fallback={<EditorFrame />} />
        </ComposerContextProvider>
      </div>
    </div>
  )
}

beforeEach(() => {
  stageHeight = 700
  chromeHeight = 100
  // jsdom has no layout; stub only the browser's measured boxes, including composer controls.
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-composer-stage') ? stageHeight : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-composer-editor-frame')) return Number.parseFloat(this.style.height) || 80
    if (this.hasAttribute('data-composer-dock-surface')) {
      if (this.querySelector('[data-composer-active-override]')) return 200
      return this.querySelector<HTMLElement>('[data-composer-editor-frame]')!.offsetHeight + chromeHeight
    }
    return 80
  })
})

afterEach(() => vi.restoreAllMocks())

describe('composer available height', () => {
  it('freezes the mounted editor during approval overrides and remeasures on return', async () => {
    const view = render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize input' })
    const frame = view.container.querySelector<HTMLElement>('[data-composer-editor-frame]')!
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await waitFor(() => expect(frame).toHaveStyle({ height: '600px' }))

    const override = { id: 'permission', render: () => <button type="button">Approve</button> }
    view.rerender(<Harness overrides={[override]} />)
    stageHeight = 500
    for (let i = 0; i < 3; i++) fireEvent(window, new Event('resize'))

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(frame).toHaveStyle({ height: '600px' })
    expect(handle).toHaveAttribute('aria-valuemax', '600')

    view.rerender(<Harness />)
    await waitFor(() => expect(frame).toHaveStyle({ height: '400px' }))
    expect(handle).toHaveAttribute('aria-valuemax', '400')
    expect(view.container.querySelector('[data-composer-editor-frame]')).toBe(frame)
  })

  it('reserves controls below the tab bar and clamps manual sizing when the window shrinks', () => {
    render(<Harness />)
    const handle = screen.getByRole('separator', { name: 'Resize input' })
    expect(handle).toHaveAttribute('aria-valuemax', '600')

    fireEvent.keyDown(handle, { key: 'End' })
    expect(handle).toHaveAttribute('aria-valuenow', '600')

    stageHeight = 400
    fireEvent(window, new Event('resize'))
    expect(handle).toHaveAttribute('aria-valuemax', '300')
    expect(handle).toHaveAttribute('aria-valuenow', '300')

    chromeHeight = 180
    fireEvent(window, new Event('resize'))
    expect(handle).toHaveAttribute('aria-valuemax', '220')
    expect(handle).toHaveAttribute('aria-valuenow', '220')
  })

  it.each(['manual', 'expanded'])('restores automatic content height on paste from %s sizing', (mode) => {
    render(<Harness />)
    if (mode === 'manual') {
      fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize input' }), { key: 'ArrowUp' })
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    }
    expect(screen.getByLabelText('Sizing mode')).toHaveTextContent('fixed')

    fireEvent.click(screen.getByRole('button', { name: 'Fit pasted content' }))
    expect(screen.getByLabelText('Sizing mode')).toHaveTextContent('auto')
    expect(screen.getByRole('separator', { name: 'Resize input' })).toHaveAttribute('aria-valuemax', '600')
  })
})

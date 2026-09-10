import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCompactComposerPresentation } from '../useCompactComposerPresentation'

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []

  private callback: ResizeObserverCallback
  readonly observed: Element[] = []

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    FakeResizeObserver.instances.push(this)
  }

  observe(element: Element) {
    this.observed.push(element)
  }

  unobserve() {}
  disconnect() {}

  trigger(width: number) {
    this.callback([{ contentRect: { width } }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
  }

  static forElement(element: Element): FakeResizeObserver {
    const instance = FakeResizeObserver.instances.find((candidate) => candidate.observed.includes(element))
    if (!instance) throw new Error('No FakeResizeObserver observed the element')
    return instance
  }
}

function buildComposerFrame() {
  const inputbar = document.createElement('div')
  inputbar.setAttribute('data-composer-inputbar', '')
  const compactRow = document.createElement('div')
  compactRow.setAttribute('data-composer-compact-row', '')
  const frame = document.createElement('div')

  compactRow.appendChild(frame)
  inputbar.appendChild(compactRow)
  document.body.appendChild(inputbar)

  return { frame, inputbar }
}

function appendEditorElement(frame: HTMLElement, dims: { clientHeight: number; scrollHeight: number }) {
  const editorElement = document.createElement('div')
  editorElement.className = 'composer-tiptap'
  // Getters (not snapshots) so a test can move the dimensions after mount to
  // emulate text rewrapping when the focus hint takes/releases layout space.
  Object.defineProperties(editorElement, {
    clientHeight: { configurable: true, get: () => dims.clientHeight },
    scrollHeight: { configurable: true, get: () => dims.scrollHeight }
  })
  frame.appendChild(editorElement)

  return editorElement
}

describe('useCompactComposerPresentation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeResizeObserver.instances = []
    document.body.innerHTML = ''
  })

  it('measures a composer that mounts enabled before the editor element exists', async () => {
    const { frame } = buildComposerFrame()
    const frameRef = { current: frame }

    const { result } = renderHook(() =>
      useCompactComposerPresentation({ enabled: true, frameRef, isComposing: () => false })
    )

    // Nothing to measure yet, so the seeded compact presentation stands.
    expect(result.current.isCompact).toBe(true)

    // Tiptap builds the editor in an effect, so `.composer-tiptap` only lands
    // after the first commit. The measurement has to pick it up from there.
    appendEditorElement(frame, { clientHeight: 20, scrollHeight: 60 })

    await waitFor(() => expect(result.current.isCompact).toBe(false))
  })

  it('remeasures when the editor width changes, across repeated focus/blur transitions', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const { frame } = buildComposerFrame()
    const frameRef = { current: frame }
    const dims = { clientHeight: 20, scrollHeight: 20 }

    const { result } = renderHook(() =>
      useCompactComposerPresentation({ enabled: true, frameRef, isComposing: () => false })
    )
    const editorElement = appendEditorElement(frame, dims)

    // Single line fits: compact.
    await waitFor(() => expect(result.current.isCompact).toBe(true))
    const editorObserver = () => FakeResizeObserver.forElement(editorElement)

    // Blur: the focus hint re-enters the layout, the editor loses width, and
    // the text wraps onto a clipped second line — the composer must expand.
    dims.scrollHeight = 60
    editorObserver().trigger(500)
    await waitFor(() => expect(result.current.isCompact).toBe(false))

    // Refocus: the hint leaves the layout, the text fits on one line again.
    dims.scrollHeight = 20
    editorObserver().trigger(600)
    await waitFor(() => expect(result.current.isCompact).toBe(true))

    // The transition must keep working on repetition, not just once.
    dims.scrollHeight = 60
    editorObserver().trigger(500)
    await waitFor(() => expect(result.current.isCompact).toBe(false))

    // An unchanged width must not schedule a measurement (no resize cycle).
    editorObserver().trigger(500)
    await Promise.resolve()
    expect(result.current.isCompact).toBe(false)
  })
})

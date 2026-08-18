import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useCompactComposerPresentation } from '../useCompactComposerPresentation'

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

function appendEditorElement(frame: HTMLElement, { clientHeight, scrollHeight }: Record<string, number>) {
  const editorElement = document.createElement('div')
  editorElement.className = 'composer-tiptap'
  Object.defineProperties(editorElement, {
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollHeight: { configurable: true, get: () => scrollHeight }
  })
  frame.appendChild(editorElement)

  return editorElement
}

describe('useCompactComposerPresentation', () => {
  afterEach(() => {
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
})

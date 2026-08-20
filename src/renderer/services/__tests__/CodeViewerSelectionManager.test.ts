// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeViewerSelectionManager } from '../CodeViewerSelectionManager'

describe('CodeViewerSelectionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    document.body.replaceChildren()
    window.getSelection()?.removeAllRanges()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shares one document listener and routes selection changes to the matching viewer', () => {
    const manager = new CodeViewerSelectionManager()
    const firstViewer = document.createElement('div')
    const secondViewer = document.createElement('div')
    firstViewer.textContent = 'first'
    secondViewer.textContent = 'second'
    document.body.append(firstViewer, secondViewer)

    const addEventListener = vi.spyOn(document, 'addEventListener')
    const removeEventListener = vi.spyOn(document, 'removeEventListener')
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    const unregisterFirst = manager.register(firstViewer, firstHandler)
    const unregisterSecond = manager.register(secondViewer, secondHandler)

    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(secondViewer)
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)

    expect(addEventListener.mock.calls.filter(([type]) => type === 'selectionchange')).toHaveLength(1)
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledOnce()
    expect(secondHandler).toHaveBeenCalledWith(selection)

    unregisterFirst()
    expect(removeEventListener.mock.calls.filter(([type]) => type === 'selectionchange')).toHaveLength(0)

    unregisterSecond()
    expect(removeEventListener.mock.calls.filter(([type]) => type === 'selectionchange')).toHaveLength(1)
  })

  it('clears only the previously active viewer when the selection collapses', () => {
    const manager = new CodeViewerSelectionManager()
    const viewer = document.createElement('div')
    viewer.textContent = 'code'
    document.body.append(viewer)
    const handler = vi.fn()
    const unregister = manager.register(viewer, handler)

    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(viewer)
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)

    selection.collapseToEnd()
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)

    expect(handler).toHaveBeenLastCalledWith(null)
    expect(handler).toHaveBeenCalledTimes(2)
    unregister()
  })
})

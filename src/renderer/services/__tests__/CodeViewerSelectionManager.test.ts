// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeViewerSelectionManager } from '../CodeViewerSelectionManager'

const cleanups: (() => void)[] = []
function setup() {
  const manager = new CodeViewerSelectionManager()
  const createViewer = (text: string) => {
    const viewer = document.createElement('div')
    const content = document.createElement('span')
    content.textContent = text
    viewer.append(content)
    document.body.append(viewer)
    const unregister = manager.register(
      viewer,
      () => {},
      (event) => {
        event.clipboardData?.setData('text/plain', text)
        event.preventDefault()
      }
    )
    cleanups.push(unregister)
    return { viewer, content, unregister }
  }
  const select = (node: Node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)
  }
  return { manager, createViewer, select }
}
function copy(target: EventTarget = document.body) {
  let text = ''
  const event = new Event('copy', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (_type: string, value: string) => {
        text = value
      }
    }
  })
  target.dispatchEvent(event)
  return { text, prevented: event.defaultPrevented }
}

describe('CodeViewerSelectionManager', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup())
    document.body.replaceChildren()
    window.getSelection()?.removeAllRanges()
    vi.useRealTimers()
  })

  it('routes copy to the new viewer instead of a retained off-screen selection', () => {
    const { manager, createViewer, select } = setup()
    const first = createViewer('first')
    const second = createViewer('second')
    select(first.content.firstChild!)
    manager.retain(first.viewer)
    first.content.remove()
    expect(copy().text).toBe('first')
    select(second.content.firstChild!)
    expect(copy().text).toBe('second')
    window.getSelection()!.collapseToEnd()
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)
    expect(copy()).toEqual({ text: '', prevented: false })
  })

  it('leaves copying from a focused input to the browser when a viewer range still exists', () => {
    const { createViewer, select } = setup()
    const { content } = createViewer('viewer source')
    select(content.firstChild!)
    const input = document.createElement('input')
    input.value = 'input selection'
    document.body.append(input)
    input.focus()
    input.select()
    expect(copy(input)).toEqual({ text: '', prevented: false })
  })

  it.each([
    { key: 'c', ctrlKey: true },
    { key: 'c', metaKey: true },
    { key: 'Insert', ctrlKey: true },
    { key: 'PageDown' },
    { key: 'PageUp' },
    { key: 'ArrowDown' },
    { key: 'ArrowUp' },
    { key: 'ArrowLeft' },
    { key: 'ArrowRight' },
    { key: 'Home', ctrlKey: true },
    { key: 'End', ctrlKey: true },
    { key: ' ' },
    { key: ' ', shiftKey: true }
  ])('preserves detached selections for copying or scrolling with %j', (shortcut) => {
    const { manager, createViewer, select } = setup()
    const { viewer, content } = createViewer('selected code')
    select(content.firstChild!)
    manager.retain(viewer)
    content.remove()
    document.dispatchEvent(new Event('selectionchange'))
    vi.advanceTimersByTime(100)
    expect(window.getSelection()!.isCollapsed).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', shortcut))
    expect(copy()).toEqual({ text: 'selected code', prevented: true })
  })

  it.each([
    { key: 'Escape' },
    { key: 'a', ctrlKey: true },
    { key: 'a', metaKey: true },
    ...['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].map((key) => ({
      key,
      shiftKey: true
    }))
  ])('releases detached selections when changing selection with %j', (shortcut) => {
    const { manager, createViewer, select } = setup()
    const { viewer, content } = createViewer('selected code')
    select(content.firstChild!)
    manager.retain(viewer)
    content.remove()
    document.dispatchEvent(new KeyboardEvent('keydown', shortcut))
    expect(copy()).toEqual({ text: '', prevented: false })
  })

  it.each(['pointercancel', 'blur'])('abandons a detached in-progress selection on %s', (type) => {
    const { manager, createViewer, select } = setup()
    const { viewer, content } = createViewer('selected code')
    content.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    select(content.firstChild!)
    manager.retain(viewer)
    content.remove()
    document.dispatchEvent(new Event('selectionchange'))
    if (type === 'blur') window.dispatchEvent(new Event(type))
    else document.dispatchEvent(new Event(type))
    expect(copy()).toEqual({ text: '', prevented: false })
  })

  it.each(['pointer', 'secondary-outside', 'keyboard', 'clear', 'focus', 'unmount', 'source'] as const)(
    'releases a detached selection on intentional %s changes',
    (action) => {
      const { manager, createViewer, select } = setup()
      const { viewer, content, unregister } = createViewer('selected code')
      select(content.firstChild!)
      manager.retain(viewer)
      content.remove()
      document.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(100)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }))
      expect(copy()).toEqual({ text: 'selected code', prevented: true })
      if (action === 'pointer') document.dispatchEvent(new Event('pointerdown'))
      if (action === 'secondary-outside')
        document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
      if (action === 'keyboard') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      if (action === 'clear') {
        window.getSelection()!.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
        vi.advanceTimersByTime(100)
      }
      if (action === 'focus') {
        const input = document.createElement('input')
        document.body.append(input)
        input.focus()
      }
      if (action === 'unmount') unregister()
      if (action === 'source') manager.release(viewer)
      expect(copy()).toEqual({ text: '', prevented: false })
    }
  )
})

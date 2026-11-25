import { waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnhancedLink } from '../extensions/enhancedLink'
import { PlusButtonPlugin } from '../plugins/plusButtonPlugin'

const editors: Editor[] = []
const elements: Element[] = []
const bindings: ReturnType<typeof PlusButtonPlugin>[] = []
const originalElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  for (const binding of bindings.splice(0)) binding.unbind()
  for (const element of elements.splice(0)) element.remove()
  if (originalElementsFromPoint) Object.defineProperty(document, 'elementsFromPoint', originalElementsFromPoint)
  else Reflect.deleteProperty(document, 'elementsFromPoint')
  vi.useRealTimers()
})

describe('editor native DOM boundaries', () => {
  it('keeps link hover across nested Text and popup transitions', () => {
    vi.useFakeTimers()
    const hover = vi.fn()
    const hoverEnd = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    elements.push(host)
    const editor = new Editor({
      element: host,
      extensions: [
        StarterKit.configure({ link: false }),
        EnhancedLink.configure({ editable: true, onLinkHover: hover, onLinkHoverEnd: hoverEnd })
      ],
      content: '<p><a href="https://example.com"><strong>nested link</strong></a></p>'
    })
    editors.push(editor)
    const anchor = editor.view.dom.querySelector('a')!
    const nested = anchor.querySelector('strong')!

    nested.firstChild!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(500)
    expect(hover).toHaveBeenLastCalledWith(
      { href: 'https://example.com', text: 'nested link', title: '' },
      expect.objectContaining({ left: expect.any(Number), top: expect.any(Number) }),
      anchor,
      { from: 1, to: 12 }
    )

    nested.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: nested.firstChild }))
    expect(hoverEnd).not.toHaveBeenCalled()
    const popup = document.createElement('div')
    popup.dataset.linkEditor = ''
    const popupText = document.createTextNode('edit')
    popup.append(popupText)
    document.body.append(popup)
    elements.push(popup)
    nested.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: popupText }))
    expect(hoverEnd).not.toHaveBeenCalled()

    const frame = document.createElement('iframe')
    document.body.append(frame)
    elements.push(frame)
    nested.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: frame.contentWindow }))
    expect(hoverEnd).toHaveBeenCalledTimes(1)
    nested.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    nested.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }))
    vi.advanceTimersByTime(500)
    expect(hover).toHaveBeenCalledTimes(1)
    expect(hoverEnd).toHaveBeenCalledTimes(2)
  })

  it('inserts a paragraph after hovering a block and stops inserting after leaving the editor', async () => {
    const host = document.createElement('div')
    const button = document.createElement('button')
    const buttonText = document.createTextNode('add')
    button.append(buttonText)
    document.body.append(host)
    elements.push(host)
    const editor = new Editor({
      element: host,
      extensions: [StarterKit],
      content: '<p>alpha</p>'
    })
    editors.push(editor)
    const binding = PlusButtonPlugin({ editor, element: button })
    bindings.push(binding)
    editor.registerPlugin(binding.plugin)
    const paragraph = editor.view.dom.querySelector('p')!
    // JSDOM has no layout hit-testing; the plugin still uses its real DOM-to-document mapping.
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [paragraph, editor.view.dom]
    })
    editor.view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10, bubbles: true }))
    await waitFor(() => expect(button.style.left).not.toBe(''))
    editor.view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: buttonText }))
    button.click()

    expect(editor.state.doc.childCount).toBe(2)
    expect(editor.state.doc.firstChild?.textContent).toBe('alpha')
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(editor.state.selection.$from.parent.content.size).toBe(0)

    const frame = document.createElement('iframe')
    document.body.append(frame)
    elements.push(frame)
    editor.view.dom.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: frame.contentWindow }))
    button.click()
    expect(editor.state.doc.childCount).toBe(2)
  })
})

import { waitFor } from '@testing-library/react'
import { Editor, type Extensions } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'

const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')
const mountedElements: HTMLElement[] = []
const editors: Editor[] = []

function mountEditor(extensions: Extensions, element = document.createElement('div')) {
  document.body.append(element)
  mountedElements.push(element)
  const editor = new Editor({
    element,
    extensions,
    content: '<h1>Title</h1>'
  })

  editors.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  for (const element of mountedElements.splice(0)) element.remove()
  if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY)
  else Reflect.deleteProperty(window, 'scrollY')
})

describe('RichEditor ToC scroll target', () => {
  it('tracks window scrolling when no scroll element is available and detaches on destroy', async () => {
    const instance = mountEditor(createRichEditorExtensions({ tocScrollParent: () => null }))
    await waitFor(() => expect(instance.isInitialized).toBe(true))
    const toc = instance.storage.tableOfContents

    Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 })
    window.dispatchEvent(new Event('scroll'))
    expect(toc.scrollPosition).toBe(120)

    instance.destroy()
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 200 })
    window.dispatchEvent(new Event('scroll'))
    expect(toc.scrollPosition).toBe(120)
  })

  it('retains the bound element after its ref clears so scrolling and cleanup remain safe', async () => {
    const element = document.createElement('div')
    let currentParent: HTMLElement | null = element
    const instance = mountEditor(createRichEditorExtensions({ tocScrollParent: () => currentParent }), element)
    await waitFor(() => expect(instance.isInitialized).toBe(true))
    const toc = instance.storage.tableOfContents

    currentParent = null
    element.scrollTop = 150
    expect(() => toc.scrollHandler()).not.toThrow()
    expect(toc.scrollPosition).toBe(150)

    instance.destroy()
    element.scrollTop = 220
    element.dispatchEvent(new Event('scroll'))
    expect(toc.scrollPosition).toBe(150)
  })

  it('binds each editor separately when an extension set is reused', async () => {
    const firstElement = document.createElement('div')
    const secondElement = document.createElement('div')
    let currentParent = firstElement
    const extensions = createRichEditorExtensions({ tocScrollParent: () => currentParent })
    const first = mountEditor(extensions, firstElement)
    await waitFor(() => expect(first.isInitialized).toBe(true))

    currentParent = secondElement
    const second = mountEditor(extensions, secondElement)
    await waitFor(() => expect(second.isInitialized).toBe(true))

    firstElement.scrollTop = 80
    firstElement.dispatchEvent(new Event('scroll'))
    secondElement.scrollTop = 160
    secondElement.dispatchEvent(new Event('scroll'))

    expect(first.storage.tableOfContents.scrollPosition).toBe(80)
    expect(second.storage.tableOfContents.scrollPosition).toBe(160)
  })
})

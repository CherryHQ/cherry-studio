import { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'

let editor: Editor | undefined
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0

beforeEach(() => {
  // jsdom has no font layout; these browser boundaries exercise serialization, not visual quality.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: Array.from(text).length * 8 })
  } as unknown as CanvasRenderingContext2D)
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
    Object.assign(computedStyle(element), {
      fontFamily: 'sans-serif',
      fontStyle: 'normal',
      fontWeight: '400',
      fontSize: '16px',
      direction: 'ltr',
      writingMode: 'horizontal-tb',
      textTransform: 'none',
      textAlign: 'start',
      letterSpacing: 'normal',
      wordSpacing: 'normal',
      whiteSpace: 'normal'
    })
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 160, 200))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
})

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  frames.clear()
  vi.restoreAllMocks()
})

async function composed() {
  await vi.waitFor(() => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((callback) => callback(performance.now()))
    // Visual breaks are the contract: the checks below must run after the adapter actually composes.
    expect(editor!.view.dom.querySelector('[data-paragraph-piece="break"]')).not.toBeNull()
  })
}

function make(content: string, onUpdate = () => {}) {
  const element = document.createElement('div')
  element.lang = 'en'
  document.body.append(element)
  editor = new Editor({
    element,
    editable: false,
    extensions: createRichEditorExtensions({ paragraphLayout: 'justified' }),
    content,
    contentType: 'markdown',
    onUpdate
  })
  return editor
}

describe('read-only paragraph composition', () => {
  it.each([
    ['$x^2$', '$x^2$'],
    ['$$\nx^2\n$$', '$x^2$']
  ])('copies a DOM-only formula selection after another paragraph is composed: %s', async (math, expected) => {
    const instance = make(`A separate paragraph with enough words to wrap onto several lines.\n\n${math}`)
    await composed()
    const formula = instance.view.dom.querySelector('.katex')!
    const range = document.createRange()
    range.selectNodeContents(formula)
    window.getSelection()!.addRange(range)
    expect(instance.state.selection.empty).toBe(true)

    const values = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        clearData: () => values.clear(),
        setData: (type: string, value: string) => values.set(type, value)
      }
    })
    formula.dispatchEvent(event)
    expect(values.get('text/plain')).toBe(expected)
    expect(values.get('text/html')).toContain('<math')
  })

  it('keeps visual breaks out of saved content, cross-paragraph copies and undo history', async () => {
    let saves = 0
    const instance = make(
      'Internationalization with **bold words**, [a link](https://example.com) and $x^2$.\n\nSecond paragraph with more words.',
      () => {
        saves++
      }
    )
    const markdown = instance.getMarkdown()
    const json = instance.getJSON()
    await composed()
    expect(instance.getMarkdown()).toBe(markdown)
    expect(instance.getJSON()).toEqual(json)
    expect(saves).toBe(0)
    expect(instance.can().undo()).toBe(false)

    instance.commands.selectAll()
    const range = document.createRange()
    range.selectNodeContents(instance.view.dom)
    window.getSelection()!.addRange(range)
    const values = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        clearData: () => values.clear(),
        setData: (type: string, value: string) => values.set(type, value)
      }
    })
    instance.view.dom.dispatchEvent(event)
    expect(values.get('text/plain')).toBe(
      'Internationalization with bold words, a link and $x^2$.\n\nSecond paragraph with more words.'
    )
    expect(values.get('text/html')).toContain('<strong>bold words</strong>')
    expect(values.get('text/html')).toContain('href="https://example.com"')
    expect(values.get('text/html')).not.toContain('data-paragraph')
  })

  it('discards pending layouts after content replacement and removes decorations when editing resumes', async () => {
    const instance = make('Original paragraph with several words to compose.')
    instance.commands.setContent('Replacement paragraph with **new content** to compose.', { contentType: 'markdown' })
    const markdown = instance.getMarkdown()
    await composed()
    expect(instance.view.dom.textContent).toBe('Replacement paragraph with new content to compose.')
    instance.setEditable(true)
    expect(instance.view.dom.querySelector('[data-paragraph-piece]')).toBeNull()
    expect(instance.getMarkdown()).toBe(markdown)
    instance.commands.insertContentAt(1, 'Edited ')
    expect(instance.getMarkdown()).toBe(`Edited ${markdown}`)
  })
})

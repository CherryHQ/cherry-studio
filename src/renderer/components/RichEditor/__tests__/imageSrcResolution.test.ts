import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'

let editor: Editor | undefined

const make = (
  content: string,
  resolveImageSrc: (src: string) => string | null,
  contentType: 'markdown' | 'html' = 'markdown'
): Editor => {
  editor?.destroy()
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions({ resolveImageSrc }),
    content,
    contentType
  })
  return editor
}

const toNotesFolder = (src: string) => `file:///notes/${src}`

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('image src resolution', () => {
  it('displays the resolved URL while the Markdown keeps the original destination', () => {
    const instance = make('![diagram](assets/a.png)', toNotesFolder)

    expect(instance.view.dom.querySelector('img')?.getAttribute('src')).toBe('file:///notes/assets/a.png')
    expect(instance.getMarkdown().trim()).toBe('![diagram](assets/a.png)')
  })

  it('restores the stored destination from copied editor HTML', () => {
    const instance = make('<img src="file:///notes/assets/a.png" data-markdown-src="assets/a.png">', () => null, 'html')

    expect(instance.getMarkdown().trim()).toBe('![](assets/a.png)')
  })

  it('keeps the original src when the destination cannot be resolved', () => {
    const instance = make('![diagram](assets/a.png)', () => null)

    const image = instance.view.dom.querySelector('img')
    expect(image?.getAttribute('src')).toBe('assets/a.png')
    expect(image?.hasAttribute('data-markdown-src')).toBe(false)
  })
})

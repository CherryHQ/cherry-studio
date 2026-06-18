import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../../createExtensions'
import { pickInlinePasteContent } from '../markdownPaste'

let editor: Editor | undefined

const makeEditor = (content: string): Editor => {
  editor?.destroy()
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions(),
    content,
    contentType: 'markdown'
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('inline markdown paste', () => {
  it('inserts pasted inline markdown as real marks, not escaped literal text', () => {
    // Regression: pasting a single line into a non-empty paragraph used to insert literal text, so
    // getMarkdown re-escaped the markers (\*\*bold\*\*) instead of round-tripping them.
    const e = makeEditor('Hello ')
    e.commands.focus('end')

    const inline = pickInlinePasteContent(e.markdown?.parse('**bold** and [docs](https://x.com)'))
    expect(inline).not.toBeNull()
    if (inline) e.commands.insertContent(inline)

    const md = e.getMarkdown().trim()
    expect(md).toBe('Hello **bold** and [docs](https://x.com)')
    expect(md).not.toContain('\\*') // markers are not escaped
  })

  it('returns null for block-y lines so the caller keeps them verbatim', () => {
    const e = makeEditor('x')
    expect(pickInlinePasteContent(e.markdown?.parse('# heading'))).toBeNull()
    expect(pickInlinePasteContent(e.markdown?.parse('- item'))).toBeNull()
    expect(pickInlinePasteContent(e.markdown?.parse(''))).toBeNull()
  })

  it('returns the inline content for a lone paragraph', () => {
    const e = makeEditor('x')
    const inline = pickInlinePasteContent(e.markdown?.parse('plain text'))
    expect(inline?.[0]).toMatchObject({ type: 'text', text: 'plain text' })
  })
})

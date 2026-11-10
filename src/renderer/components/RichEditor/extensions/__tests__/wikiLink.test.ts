import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRichEditorExtensions } from '../../createExtensions'

let editor: Editor | undefined
const make = (content: string, onWikiLinkClick: ((target: string) => void) | undefined = () => {}, editable = true) => {
  editor?.destroy()
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions({ onWikiLinkClick }),
    content,
    contentType: 'markdown',
    editable
  })
  return editor
}
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('wiki links in the production editor', () => {
  it.each([
    [
      '[**重要**] [[T]]',
      [
        { type: 'text', text: '[' },
        { type: 'text', text: '重要', marks: [{ type: 'bold' }] },
        { type: 'text', text: '] ' },
        { type: 'wikiLink', attrs: { raw: '[[T]]', target: 'T', label: 'T' } }
      ]
    ],
    [
      '[bracket [[T]] and [[U]]',
      [
        { type: 'text', text: '[bracket ' },
        { type: 'wikiLink', attrs: { raw: '[[T]]', target: 'T', label: 'T' } },
        { type: 'text', text: ' and ' },
        { type: 'wikiLink', attrs: { raw: '[[U]]', target: 'U', label: 'U' } }
      ]
    ],
    [
      '[[T]]]',
      [
        { type: 'wikiLink', attrs: { raw: '[[T]]', target: 'T', label: 'T' } },
        { type: 'text', text: ']' }
      ]
    ],
    [
      '[[[T]]]',
      [
        { type: 'text', text: '[' },
        { type: 'wikiLink', attrs: { raw: '[[T]]', target: 'T', label: 'T' } },
        { type: 'text', text: ']' }
      ]
    ]
  ])('preserves editable text around wiki links: %s', (source, content) => {
    expect(make(source).getJSON().content?.[0].content).toEqual(content)
  })
  it.each(['[[T]]', '[[dir/T.md|别名]]', '[[中文 & 空格_字|别 名 & _]]', '[[|alias]]', '[[T|A|B]]', '[[outer[[T]]]]'])(
    'preserves %s after an unrelated edit',
    (token) => {
      const instance = make(`${token}\n\nOther`)
      instance.commands.insertContentAt(instance.state.doc.content.size - 1, '!')
      expect(instance.getMarkdown()).toContain(token)
    }
  )
  it.each([
    '**[[T]]**',
    '*a [[T]] b*',
    '[[dir/T.md|Alias]]',
    '[[T|空 格 & CJK \\ path]]',
    '[[T\\|Alias]]',
    '***a [[T]] b***',
    '**a *[[T]]* b**',
    '*a* [[T]] *b*',
    '[[T]] **b**',
    'a **[[T]]** b'
  ])('preserves markdown through load and save: %s', (source) => {
    expect(make(source).getMarkdown()).toBe(source)
  })
  it('keeps wiki syntax when punctuation requires HTML fallback', () => {
    const saved = make('a<strong>!</strong> [[T|Alias]]').getMarkdown()
    expect(saved).toContain('[[T|Alias]]')
    expect(make(saved).getText()).toBe('a! [[T|Alias]]')
  })
  it('preserves a title on an ordinary link', () => {
    const link = make('[label](https://example.com "title")').view.dom.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.getAttribute('title')).toBe('title')
  })
  it('keeps ordinary links and adjacent wiki links separate', () => {
    const instance = make('[intro] text [[T]][[U]] and [footer](https://example.com/a_(b))')
    expect(
      Array.from(instance.view.dom.querySelectorAll('[data-wiki-target]')).map((el) =>
        el.getAttribute('data-wiki-target')
      )
    ).toEqual(['T', 'U'])
    expect(instance.view.dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a_(b)')
  })
  it('preserves an escaped closing bracket in an alias', () => {
    expect(make('[[T|A\\]B]]').getJSON().content?.[0].content?.[0]).toMatchObject({
      attrs: { target: 'T', label: 'A\\]B' }
    })
  })
  it.each(['![[embed]]', '[[T#heading]]'])('does not create an atom for %s', (source) => {
    const instance = make(source)
    expect(instance.view.dom.querySelector('[data-wiki-link]')).toBeNull()
    expect(instance.getText()).toBe(source)
    expect(instance.getMarkdown()).toBe(source)
  })
  it('keeps nested marks balanced', () => {
    expect(make('~~**[[T]]** x~~').getMarkdown()).toBe('~~**[[T]]** x~~')
  })
  it('keeps HTML fallback backticks from swallowing the atom', () => {
    const instance = make('')
    instance.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a`x' },
            { type: 'text', text: '!', marks: [{ type: 'bold' }] },
            { type: 'wikiLink', attrs: { raw: '[[T]]', target: 'T', label: 'T' } },
            { type: 'text', text: '`z' }
          ]
        }
      ]
    })
    const saved = instance.getMarkdown()
    expect(saved).toContain('&#96;')
    expect(make(saved).getText()).toBe('a`x![[T]]`z')
    expect(editor?.view.dom.querySelector('[data-wiki-target="T"]')).not.toBeNull()
  })
  it('does not merge different link marks across atoms', () => {
    const instance = make('')
    instance.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'wikiLink',
              attrs: { raw: '[[T]]', target: 'T', label: 'T' },
              marks: [{ type: 'enhancedLink', attrs: { href: 'https://one.test' } }]
            },
            {
              type: 'wikiLink',
              attrs: { raw: '[[U]]', target: 'U', label: 'U' },
              marks: [{ type: 'enhancedLink', attrs: { href: 'https://two.test' } }]
            }
          ]
        }
      ]
    })
    expect(instance.getMarkdown()).toContain('https://one.test')
    expect(instance.getMarkdown()).toContain('https://two.test')
  })
  it('closes and reopens marks around an unmarked atom', () => {
    const instance = make('')
    instance.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'strike' }] },
            { type: 'wikiLink', attrs: { raw: '[[T]]', target: 'T', label: 'T' } },
            { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'strike' }] }
          ]
        }
      ]
    })
    expect(instance.getMarkdown()).toMatch(/^(?:\*\*~~a~~\*\*|~~\*\*a\*\*~~)\[\[T\]\](?:\*\*~~b~~\*\*|~~\*\*b\*\*~~)$/)
  })
  it('closes nested marks before a hard break', () => {
    const instance = make('')
    instance.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'strike' }] },
            { type: 'hardBreak', marks: [{ type: 'bold' }, { type: 'strike' }] },
            { type: 'text', text: 'y' }
          ]
        }
      ]
    })
    const saved = instance.getMarkdown()
    expect(saved).toMatch(/^(?:\*\*~~x~~\*\*|~~\*\*x\*\*~~)  \ny$/)
  })
  it('extracts a real table token after wiki syntax in code', () => {
    expect(make('| Link |\n| --- |\n| `[[X\\|No]]` [[T\\|Alias]] |').getText()).toContain('[[T\\|Alias]]')
  })
  it('extracts a real table token after a code span with a shorter backtick run', () => {
    expect(make('| Link |\n| --- |\n| ``a ` [[X\\|No]] b`` [[T\\|Alias]] |').getText()).toContain('[[T\\|Alias]]')
  })
  it('does not create a wiki link from a table code span', () => {
    const instance = make('| Link |\n| --- |\n| ``a ` [[X\\|No]] b`` |')
    expect(instance.view.dom.querySelector('[data-wiki-link]')).toBeNull()
  })
  it('keeps a literal backslash before a table pipe after reload', () => {
    const instance = make('| Link | Other |\n| --- | --- |\n| a\\\\\\|b | x |')
    const saved = instance.getMarkdown()
    const text = instance.getText()
    const reloaded = make(saved)
    expect(reloaded.state.doc.firstChild?.child(1).childCount).toBe(2)
    expect(reloaded.getText()).toBe(text)
  })
  it('keeps the table alias bytes in extracted text', () => {
    expect(make('| Link |\n| --- |\n| [[T\\|Alias]] |').getText()).toContain('[[T\\|Alias]]')
  })
  it('includes wiki syntax in text extraction', () => {
    const instance = make('before [[T|Alias]] after')
    expect(instance.getText()).toBe('before [[T|Alias]] after')
  })
  it('saves bold applied to a selected wiki link', () => {
    const instance = make('[[T]]')
    instance.commands.setTextSelection({ from: 1, to: 2 })
    instance.commands.setBold()
    expect(instance.getMarkdown()).toBe('**[[T]]**')
  })
  it('keeps escaped table aliases in one column', () => {
    const instance = make('| Link | Other |\n| --- | --- |\n| [[T\\|Alias]] | x |')
    expect(instance.getMarkdown()).toContain('[[T\\|Alias]]')
    expect(instance.state.doc.firstChild?.child(1).childCount).toBe(2)
  })
  it.each(['[[T]](https://example.com)', '[[T]][ref]\n\n[ref]: https://example.com'])(
    'leaves ordinary links to Markdown: %s',
    (source) => {
      const instance = make(source)
      expect(instance.getJSON().content?.[0].content?.some((node) => node.type === 'wikiLink')).toBe(false)
      expect(instance.getHTML()).toContain('<a ')
    }
  )
  it('recognizes standalone wiki syntax even when its reference name is defined', () => {
    const instance = make('[[T]]\n\n[T]: https://example.com')
    expect(instance.view.dom.querySelector('[data-wiki-target="T"]')).not.toBeNull()
    expect(instance.getMarkdown()).toContain('[[T]]')
  })
  it('does not confuse an escaped backslash with an escaped bracket', () => {
    const instance = make('\\\\[[T]]')
    expect(instance.view.dom.querySelector('[data-wiki-target="T"]')).not.toBeNull()
    expect(instance.getMarkdown()).toContain('[[T]]')
  })
  it('leaves front matter and math to their existing parsers', () => {
    const instance = make('---\ntitle: "[[T]]"\n---\n\n$[[T]]$')
    expect(instance.getMarkdown()).toContain('title: "[[T]]"')
    expect(instance.getMarkdown()).toContain('$[[T]]$')
    expect(instance.view.dom.querySelector('[data-wiki-link]')).toBeNull()
  })
  it('navigates on a primary click in read mode', () => {
    const click = vi.fn()
    const instance = make('[[T]]', click, false)
    instance.view.dom.querySelector('[data-wiki-link]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click).toHaveBeenCalledWith('T')
  })
  it('keeps code and escaped syntax non-navigable', () => {
    const click = vi.fn()
    const instance = make('`[[T]]`\n\n```\n[[T]]\n```\n\n\\[\\[T\\]\\] and \\[[T]]', click, false)
    expect(instance.view.dom.querySelector('[data-wiki-link]')).toBeNull()
    instance.view.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(click).not.toHaveBeenCalled()
  })
  it('navigates only on the required primary click and does not edit', () => {
    const click = vi.fn()
    const instance = make('[[T]]', click)
    const update = vi.fn()
    instance.on('update', update)
    const link = instance.view.dom.querySelector('[data-wiki-link]')!
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    expect(click).not.toHaveBeenCalled()
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, ctrlKey: true }))
    expect(click).toHaveBeenCalledWith('T')
    expect(update).not.toHaveBeenCalled()
  })
  it('leaves the default extension set unchanged', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions(),
      content: '[[T]]',
      contentType: 'markdown'
    })
    const instance = editor
    expect(instance.extensionManager.extensions.some((extension) => extension.name === 'wikiLink')).toBe(false)
    expect(instance.getMarkdown()).toContain('\\[\\[T\\]\\]')
  })
})

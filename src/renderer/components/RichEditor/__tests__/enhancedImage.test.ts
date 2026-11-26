import { Editor, Extension } from '@tiptap/core'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'
import { resolveImageSrc } from '../extensions/resolveImageSrc'

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('note-relative images', () => {
  it('resolves relative paths against POSIX and Windows note directories', () => {
    for (const [src, baseDir, expected] of [
      ['assets/img-1.png', '/notes', 'file:///notes/assets/img-1.png'],
      ['./assets/img-1.png', '/notes', 'file:///notes/assets/img-1.png'],
      ['../img/img-1.png', '/notes/drafts', 'file:///notes/img/img-1.png'],
      [String.raw`assets\img-1.png`, '/notes', 'file:///notes/assets%5Cimg-1.png'],
      ['assets/img-1.png', String.raw`C:\notes`, 'file:///C:/notes/assets/img-1.png'],
      [String.raw`.\assets\img-1.png`, String.raw`C:\notes`, 'file:///C:/notes/assets/img-1.png'],
      [String.raw`..\img\img-1.png`, 'D:/notes/drafts', 'file:///D:/notes/img/img-1.png'],
      ['assets/img-1.png', '/', 'file:///assets/img-1.png'],
      ['assets/img-1.png', '/notes/', 'file:///notes/assets/img-1.png'],
      ['assets/img-1.png', 'C:\\notes\\', 'file:///C:/notes/assets/img-1.png'],
      ['assets/img-1.png', 'C:\\', 'file:///C:/assets/img-1.png'],
      ['assets/x.png', '\\\\server\\share\\', 'file://server/share/assets/x.png'],
      ['assets/x.png', '//server/share/', 'file://server/share/assets/x.png'],
      ['../../img.png', '//server/share/notes/', 'file://server/img.png'],
      ['../../img.png', '/notes', 'file:///img.png'],
      ['assets/my%5Cimg.png', '/notes', 'file:///notes/assets/my%5Cimg.png'],
      ['assets/my%5Cimg.png', 'C:/notes', 'file:///C:/notes/assets/my%5Cimg.png'],
      ['a%2Fb.png', '/notes', 'file:///notes/a%2Fb.png'],
      ['a%2Fb.png', 'C:/notes', 'file:///C:/notes/a%2Fb.png'],
      ['a%2Fb.png', '//server/share/', 'file://server/share/a%2Fb.png'],
      ['a%20b.png', '/notes', 'file:///notes/a%20b.png'],
      ['a%20b100%.png', '/notes', 'file:///notes/a%20b100%25.png'],
      ['a%20b%ZZ.png', '/notes', 'file:///notes/a%20b%25ZZ.png'],
      ['%E4%B8%AD.png', '/notes', 'file:///notes/%E4%B8%AD.png'],
      ['%E4%B8%AD100%.png', '/notes', 'file:///notes/%E4%B8%AD100%25.png'],
      ['%E4.png', '/notes', 'file:///notes/%25E4.png'],
      ['a%20b%E4.png', '/notes', 'file:///notes/a%20b%25E4.png'],
      ['%20%E4.png', '/notes', 'file:///notes/%2520%25E4.png'],
      ['100%.png', '/notes', 'file:///notes/100%25.png'],
      ['assets/invalid%escape.png', '/notes', 'file:///notes/assets/invalid%25escape.png'],
      ['a%20b/invalid%escape.png', '/notes', 'file:///notes/a%20b/invalid%25escape.png'],
      ['assets/%E5%9B.png', '/notes', 'file:///notes/assets/%25E5%259B.png'],
      ['  foo.png', '/notes', 'file:///notes/foo.png'],
      ['foo.png  ', '/notes', 'file:///notes/foo.png'],
      ['  foo.png  ', '/notes', 'file:///notes/foo.png'],
      ['assets/a%20b%23%3F.png', '/my notes/中文', 'file:///my%20notes/%E4%B8%AD%E6%96%87/assets/a%20b%23%3F.png'],
      [
        'assets/%E5%9B%BE%201.png',
        'C:/my notes/中文',
        'file:///C:/my%20notes/%E4%B8%AD%E6%96%87/assets/%E5%9B%BE%201.png'
      ]
    ]) {
      expect(resolveImageSrc(src, baseDir), `${baseDir}: ${src}`).toBe(expected)
    }
  })

  it('preserves query strings and fragments as URL components', () => {
    for (const suffix of ['?size=1', '#frag', '?size=1#frag', '?name=a%20b#%E5%9B%BE', '?name=100%#a%2Fb']) {
      expect(resolveImageSrc(`assets/img.png${suffix}`, '/notes')).toBe(`file:///notes/assets/img.png${suffix}`)
    }
  })

  it('falls back to the original source when resolution fails', () => {
    expect(resolveImageSrc('assets/img-1.png', 'notes/')).toBe('assets/img-1.png')
    expect(resolveImageSrc('assets/img-1.png', '/notes\0')).toBe('assets/img-1.png')
    expect(resolveImageSrc('  assets/img-1.png  ', 'notes/')).toBe('  assets/img-1.png  ')
  })

  it('preserves existing URL sources and leaves other editors unchanged', () => {
    for (const src of [
      'data:image/png;base64,aGVsbG8=',
      'http://example.com/image.png',
      'https://example.com/a%20b.png',
      'blob:https://example.com/image',
      'file:///notes/a%20b.png',
      '//example.com/image.png',
      '/absolute/image.png',
      String.raw`C:\notes\image.png`,
      String.raw`\\server\share\image.png`
    ]) {
      expect(resolveImageSrc(src, '/notes')).toBe(src)
      expect(resolveImageSrc(`  ${src}  `, '/notes')).toBe(src)
    }
    expect(resolveImageSrc(' https://example.org/x.png', '/notes')).toBe('https://example.org/x.png')
    expect(resolveImageSrc('assets/img-1.png')).toBe('assets/img-1.png')
  })

  it.each([true, false])('renders a resolved image while preserving its markdown source (editable=%s)', (editable) => {
    for (const [src, expected] of [
      ['assets/img-1.png', 'file:///my%20notes/%E4%B8%AD%E6%96%87/assets/img-1.png'],
      ['./assets/img-1.png', 'file:///my%20notes/%E4%B8%AD%E6%96%87/assets/img-1.png'],
      ['../img/img-1.png', 'file:///my%20notes/img/img-1.png'],
      [String.raw`assets\img-1.png`, 'file:///my%20notes/%E4%B8%AD%E6%96%87/assets%5Cimg-1.png'],
      ['assets/a%20b.png', 'file:///my%20notes/%E4%B8%AD%E6%96%87/assets/a%20b.png']
    ]) {
      editor?.destroy()
      const markdown = `![](${src})`
      editor = new Editor({
        element: document.createElement('div'),
        extensions: createRichEditorExtensions({ imageBaseDir: '/my notes/中文', editable }),
        content: markdown,
        contentType: 'markdown',
        editable
      })

      expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe(expected)
      expect(editor.getJSON().content?.find((node) => node.type === 'image')?.attrs?.src).toBe(src)
      expect(editor.getHTML()).toContain(`src="${src}"`)
      expect(editor.getMarkdown()).toBe(markdown)
    }
  })

  it('keeps serialized HTML and Markdown unchanged while updating the image presentation', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions({ imageBaseDir: '/notes' }),
      content: '<img src="assets/img-1.png" alt="diagram" title="Diagram" width="120" height="80"><p>Caption</p>'
    })

    expect(editor.getHTML()).toBe(
      '<img class="rich-editor-image" src="assets/img-1.png" alt="diagram" title="Diagram" width="120" height="80"><p>Caption</p>'
    )
    expect(editor.getMarkdown()).toBe('![diagram](assets/img-1.png "Diagram")\n\nCaption')
    const image = editor.view.dom.querySelector('img')!
    expect(image.getAttribute('src')).toBe('file:///notes/assets/img-1.png')
    expect(image.getAttribute('alt')).toBe('diagram')
    expect(image.getAttribute('title')).toBe('Diagram')
    expect(image.getAttribute('width')).toBe('120')
    expect(image.getAttribute('height')).toBe('80')

    editor.commands.updateAttributes('image', {
      src: 'assets/img-2.png',
      alt: 'updated',
      title: null,
      width: 240,
      height: null
    })

    expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe('file:///notes/assets/img-2.png')
    expect(image.getAttribute('alt')).toBe('updated')
    expect(image.hasAttribute('title')).toBe(false)
    expect(image.getAttribute('width')).toBe('240')
    expect(image.hasAttribute('height')).toBe(false)
    expect(editor.getHTML()).toContain('src="assets/img-2.png"')
    expect(editor.getMarkdown()).toBe('![updated](assets/img-2.png)\n\nCaption')
  })

  it('refreshes extension-provided attributes when an image source changes', () => {
    const HTMLAttributes: Record<string, string> = { 'aria-label': 'first' }
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions({ imageBaseDir: '/notes' }).map((extension) =>
        extension.name === 'image'
          ? extension.extend({
              addOptions() {
                return { ...this.parent?.(), HTMLAttributes }
              }
            })
          : extension
      ),
      content: '<img src="assets/x.png"><p>Caption</p>'
    })

    const image = editor.view.dom.querySelector('img')!
    expect(image.getAttribute('aria-label')).toBe('first')
    image.setAttribute('draggable', 'true')
    image.setAttribute('contenteditable', 'false')
    HTMLAttributes.draggable = 'false'
    HTMLAttributes.contenteditable = 'true'
    for (const [label, src] of [
      ['second', 'assets/y.png'],
      [undefined, 'assets/z.png']
    ] as const) {
      if (label === undefined) {
        delete HTMLAttributes['aria-label']
      } else {
        HTMLAttributes['aria-label'] = label
      }
      editor.commands.updateAttributes('image', { src })

      expect(editor.getHTML().includes('aria-label=')).toBe(label !== undefined)
      if (label !== undefined) expect(editor.getHTML()).toContain(`aria-label="${label}"`)
      expect(editor.view.dom.querySelector('img')).toBe(image)
      expect(image.getAttribute('src')).toBe(`file:///notes/${src}`)
      expect(image.getAttribute('aria-label')).toBe(label ?? null)
      expect(image.getAttribute('draggable')).toBe('true')
      expect(image.getAttribute('contenteditable')).toBe('false')
    }
  })

  it('preserves selection, drag attributes, and external classes when an image source changes', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [
        ...createRichEditorExtensions({ imageBaseDir: '/notes' }),
        Extension.create({
          name: 'imageClasses',
          addGlobalAttributes() {
            return [{ types: ['image'], attributes: { class: { default: 'model-image' } } }]
          }
        })
      ],
      content: '<img src="assets/x.png"><p>Caption</p>'
    })

    editor.commands.setNodeSelection(0)
    const image = editor.view.dom.querySelector('img')!
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    // ProseMirror owns selection and drag state across node-view updates.
    expect(image.classList.contains('ProseMirror-selectednode')).toBe(true)
    const draggable = image.getAttribute('draggable')
    expect(draggable).not.toBeNull()
    image.classList.add('external-drag-state')
    image.setAttribute('aria-label', 'Selected diagram')
    image.setAttribute('contenteditable', 'false')

    editor.commands.updateAttributes('image', { src: 'assets/y.png' })

    expect(editor.view.dom.querySelector('img')).toBe(image)
    expect(image.getAttribute('src')).toBe('file:///notes/assets/y.png')
    expect(image.classList.contains('ProseMirror-selectednode')).toBe(true)
    expect(image.getAttribute('draggable')).toBe(draggable)
    expect(image.classList.contains('external-drag-state')).toBe(true)
    expect(image.getAttribute('aria-label')).toBe('Selected diagram')
    expect(image.getAttribute('contenteditable')).toBe('false')

    editor.commands.updateAttributes('image', { src: 'assets/z.png', class: 'updated-image external-drag-state' })
    expect(image.classList.contains('model-image')).toBe(false)
    expect(image.classList.contains('updated-image')).toBe(true)
    expect(image.classList.contains('ProseMirror-selectednode')).toBe(true)
    editor.commands.updateAttributes('image', { src: 'assets/y.png', class: 'updated-image' })
    expect(image.classList.contains('external-drag-state')).toBe(true)
    expect(image.getAttribute('draggable')).toBe(draggable)

    editor.commands.setTextSelection(2)
    expect(image.classList.contains('ProseMirror-selectednode')).toBe(false)
  })

  it.each([false, true])('matches the parent image renderer without a note directory (resize=%s)', (resize) => {
    const options: Partial<ImageOptions> = {
      HTMLAttributes: { class: 'rich-editor-image', 'data-image': 'configured' },
      resize: resize ? { enabled: true } : false
    }
    const content = '<img src="assets/img-1.png" alt="diagram" title="Diagram" width="120" height="80"><p>Caption</p>'
    const parentEditor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions().map((extension) =>
        extension.name === 'image' ? Image.configure(options) : extension
      ),
      content
    })

    try {
      editor = new Editor({
        element: document.createElement('div'),
        extensions: createRichEditorExtensions().map((extension) =>
          extension.name === 'image' ? extension.configure(options) : extension
        ),
        content
      })

      expect(editor.getHTML()).toBe(parentEditor.getHTML())
      expect(Boolean(editor.view.props.nodeViews?.image)).toBe(resize)
      expect(editor.view.dom.querySelector('img')?.getAttribute('src')).toBe('assets/img-1.png')
      expect(editor.view.dom.innerHTML).toBe(parentEditor.view.dom.innerHTML)
      expect(editor.getMarkdown()).toBe('![diagram](assets/img-1.png "Diagram")\n\nCaption')
    } finally {
      parentEditor.destroy()
    }
  })

  it('preserves the relative source after a clipboard HTML round trip', () => {
    const markdown = '![diagram](assets/img-1.png)\n\nCaption'
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions({ imageBaseDir: '/notes' }),
      content: markdown,
      contentType: 'markdown'
    })

    editor.commands.setContent(editor.getHTML())

    expect(editor.getMarkdown()).toBe(markdown)
  })
})

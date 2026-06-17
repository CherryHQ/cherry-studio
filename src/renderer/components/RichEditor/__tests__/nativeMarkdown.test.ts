import { TableCell, TableHeader, TableRow } from '@cherrystudio/extension-table-plus'
import { Editor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { EnhancedImage } from '../extensions/enhancedImage'
import { MarkdownTable } from '../extensions/markdownTable'
import { YamlFrontMatter } from '../extensions/yamlFrontMatter'

// Mirrors the markdown-relevant part of useRichEditor's extension set + init options.
const createEditor = (content: string) =>
  new Editor({
    element: document.createElement('div'),
    extensions: [Markdown.configure({ markedOptions: { gfm: true } }), StarterKit, YamlFrontMatter],
    content,
    contentType: 'markdown'
  })

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('RichEditor native markdown AST integration', () => {
  it('parses markdown structure via the AST on init (not as literal text)', () => {
    editor = createEditor('# Hello\n\n- a\n- b')
    const json = editor.getJSON()
    // If contentType:'markdown' were ignored, "# Hello" would land in a paragraph as literal text.
    expect(json.content?.[0]?.type).toBe('heading')
    expect(json.content?.[0]?.attrs?.level).toBe(1)
    expect(json.content?.some((node) => node.type === 'bulletList')).toBe(true)
  })

  it('round-trips inline marks through getMarkdown', () => {
    editor = createEditor('# Title\n\nSome **bold** and *italic* text.')
    const md = editor.getMarkdown().trim()
    expect(md).toContain('# Title')
    expect(md).toContain('**bold**')
    expect(md).toContain('*italic*')
  })

  it('parses YAML front matter via the custom tokenizer on init', () => {
    editor = createEditor('---\ntitle: Hi\n---\n\nBody text')
    const json = editor.getJSON()
    expect(json.content?.[0]?.type).toBe('yamlFrontMatter')
    expect(json.content?.[0]?.attrs?.content).toContain('title: Hi')
  })

  it('round-trips GFM tables (regression: table-plus has no native markdown hooks)', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [
        Markdown.configure({ markedOptions: { gfm: true } }),
        StarterKit,
        EnhancedImage,
        MarkdownTable,
        TableRow,
        TableHeader,
        TableCell
      ],
      content: '| a | b |\n| --- | --- |\n| 1 | 2 |',
      contentType: 'markdown'
    })

    // Must parse into a real table node, not a paragraph of literal pipes.
    expect(editor.getJSON().content?.[0]?.type).toBe('table')

    const md = editor.getMarkdown()
    expect(md).toContain('| a | b |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | 2 |')
  })
})

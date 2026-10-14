import { Editor, Mark } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'
import { findElementByLine } from '../helpers/jumpToLine'

let editor: Editor | undefined

afterEach(() => editor?.destroy())

describe('bold markdown persistence', () => {
  it.each([
    { before: '', bold: '1.禁止逻辑错乱：', after: '每次检查' },
    { before: '这是', bold: '“逻辑错误”', after: '示例' },
    { before: '这是', bold: '（错误）', after: '示例' },
    { before: '第一行\n保留  空格', bold: '错误：', after: '每次检查' },
    { before: '这是', bold: '逻辑错误', after: '示例' },
    { before: '', bold: '1.禁止逻辑错乱：', after: ' 每次检查' }
  ])('preserves the bold range in $before$bold$after after reopening', ({ before, bold, after }) => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: before + bold + after }] }]
      }
    })
    editor.commands.setTextSelection({ from: before.length + 1, to: before.length + bold.length + 1 })
    editor.commands.toggleBold()

    for (let reopen = 0; reopen < 3; reopen++) {
      editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' })
      expect(editor.getText()).toBe(before + bold + after)
      expect(editor.getJSON().content?.[0].content).toEqual([
        ...(before ? [{ type: 'text', text: before }] : []),
        { type: 'text', text: bold, marks: [{ type: 'bold' }] },
        { type: 'text', text: after }
      ])
    }
  })

  it('preserves nested formatting and literal markdown beside punctuation-boundary bold', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions(),
      content: '<p>**原文**<strong>禁止<em>逻辑</em>错误：</strong>每次检查 <code>a_b</code></p>'
    })
    const original = editor.getJSON()

    for (let reopen = 0; reopen < 3; reopen++) {
      editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' })
      expect(editor.getJSON()).toEqual(original)
    }
  })

  it('keeps ordinary bold in markdown syntax', () => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: createRichEditorExtensions(),
      content: '<p>这是<strong>普通加粗</strong>示例。</p>'
    })
    expect(editor.getMarkdown()).toBe('这是**普通加粗**示例。')
  })
})

it('preserves emphasis boundaries declared by an extension with a different name', () => {
  const StrongText = Mark.create({
    name: 'strongText',
    parseHTML: () => [{ tag: 'strong' }],
    renderHTML: () => ['strong', 0],
    markdownTokenName: 'strong',
    parseMarkdown: (token, helpers) => helpers.applyMark('strongText', helpers.parseInline(token.tokens ?? [])),
    renderMarkdown: (node, helpers) => `**${helpers.renderChildren(node)}**`
  })
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ bold: false }), StrongText, Markdown],
    content: '<p><strong>注意：</strong>检查</p>'
  })
  const original = editor.getJSON()
  for (let reopen = 0; reopen < 3; reopen++) {
    editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' })
    expect(editor.getJSON()).toEqual(original)
  }
})

it('keeps punctuation in italic marks through repeated saves', () => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions(),
    content: '<p>这是<em>“错误”</em>示例</p>'
  })
  const original = editor.getJSON()
  for (let reopen = 0; reopen < 3; reopen++) {
    editor.commands.setContent(editor.getMarkdown(), { contentType: 'markdown' })
    expect(editor.getJSON()).toEqual(original)
  }
})

it('locates a saved HTML line by visible text instead of the proportional estimate', () => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions(),
    content: '<p>前言</p><p><strong>注意：</strong>检查 &amp; **原文**</p><pre><code>1\n2\n3\n4\n5\n6</code></pre>'
  })
  const saved = editor.getMarkdown()
  const lines = saved.split('\n')
  const lineIndex = lines.findIndex((line) => line.includes('注意'))
  editor.commands.setContent(saved, { contentType: 'markdown' })
  expect(findElementByLine(editor, lineIndex + 1, lines[lineIndex])).toBe(editor.view.dom.children[1])
})

it('respects an extension that already serializes its mark as HTML', () => {
  const HtmlBold = Mark.create({
    name: 'bold',
    parseHTML: () => [{ tag: 'strong' }],
    renderHTML: () => ['strong', 0],
    renderMarkdown: (node, helpers) => `<strong>${helpers.renderChildren(node)}</strong>`
  })
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ bold: false }), HtmlBold, Markdown],
    content: '<p><strong>注意：</strong>检查</p>'
  })
  expect(editor.getMarkdown()).toBe('<strong>注意：</strong>检查')
})

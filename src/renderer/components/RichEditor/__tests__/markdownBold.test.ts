import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'

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

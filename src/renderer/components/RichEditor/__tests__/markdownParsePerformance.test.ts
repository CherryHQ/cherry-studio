import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createRichEditorExtensions } from '../createExtensions'

/**
 * Regression tests for issue #20358: opening a ~33KB markdown note froze the app.
 *
 * The @tiptap/extension-list ordered/task list tokenizers (pre-patch) split the entire remaining
 * source at every block boundary before checking whether a list could even start there, making
 * parse time O(blocks x document size). The patch in patches/@tiptap__extension-list@3.26.1.patch
 * adds first-line early-exit guards. These tests pin the contract: pathological 33KB notes parse
 * in bounded time AND still produce the correct document shape (the shape assertions ensure a
 * fast-but-broken parse cannot pass).
 */

const KB = 1024

const countNodes = (node: JSONContent, type: string): number => {
  let count = node.type === type ? 1 : 0
  for (const child of node.content ?? []) count += countNodes(child, type)
  return count
}

/** Parse markdown through the production setContent path; returns [elapsedMs, editor]. */
const parseMarkdown = (content: string): { ms: number; editor: Editor } => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createRichEditorExtensions()
  })
  const t0 = performance.now()
  editor.commands.setContent(content, { contentType: 'markdown' })
  return { ms: performance.now() - t0, editor }
}

/** Warm up JIT, then report the median of 3 timed runs to damp GC noise. */
const parseMedian = (content: string): { ms: number; editor: Editor } => {
  const results: Array<{ ms: number; editor: Editor }> = []
  for (let i = 0; i < 4; i++) {
    const result = parseMarkdown(content)
    if (i > 0) results.push(result)
    else result.editor.destroy()
  }
  results.sort((a, b) => a.ms - b.ms)
  const median = results[1]
  for (const r of results) if (r !== median) r.editor.destroy()
  return median
}

let editor: Editor | undefined
afterEach(() => {
  editor?.destroy()
  editor = undefined
})

describe('markdown parse performance (#20358)', () => {
  it('parses a 33KB note of --- separators in bounded time', { timeout: 60_000 }, () => {
    const content = '---\n'.repeat(Math.floor((33 * KB) / 4))
    const { ms, editor: e } = parseMedian(content)
    editor = e
    process.stdout.write(`hr-storm 33KB: ${ms.toFixed(0)}ms\n`)
    expect(countNodes(e.getJSON(), 'horizontalRule')).toBeGreaterThan(8000)
    expect(ms).toBeLessThan(3000)
  })

  it('parses a 33KB note of many small fenced code blocks in bounded time', { timeout: 60_000 }, () => {
    const block = '```ts\nconst x = 1\n```\n\ntext between blocks\n\n'
    const content = block.repeat(Math.floor((33 * KB) / block.length))
    const { ms, editor: e } = parseMedian(content)
    editor = e
    process.stdout.write(`code-many 33KB: ${ms.toFixed(0)}ms\n`)
    expect(countNodes(e.getJSON(), 'codeBlock')).toBeGreaterThan(700)
    expect(ms).toBeLessThan(3000)
  })

  it('parses a plain 33KB note instantly (size alone is not the trigger)', { timeout: 60_000 }, () => {
    const sentence = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. '
    const content = sentence.repeat(Math.floor((33 * KB) / sentence.length))
    const { ms, editor: e } = parseMarkdown(content)
    editor = e
    process.stdout.write(`plain 33KB: ${ms.toFixed(0)}ms\n`)
    expect((e.getJSON().content ?? []).length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(1000)
  })
})

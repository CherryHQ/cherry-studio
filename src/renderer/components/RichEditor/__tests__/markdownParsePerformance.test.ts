import type { JSONContent } from '@tiptap/core'
import { Editor } from '@tiptap/core'
import { Mathematics } from '@tiptap/extension-mathematics'
import { afterEach, describe, expect, it } from 'vitest'

import { codeHighlightService } from '@renderer/services/CodeHighlightService'

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
afterEach(async () => {
  editor?.destroy()
  editor = undefined
  await codeHighlightService.highlightCodeToHtml('', 'text', 'one-light')
  codeHighlightService.dispose()
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

describe('backslash math parse performance (#24550)', () => {
  const measure = (source: string, inlineCount: number, extensions = createRichEditorExtensions()): number => {
    editor?.destroy()
    editor = new Editor({ extensions })
    editor.markdown!.parse(source)
    const samples: number[] = []
    let json: JSONContent = {}
    for (let run = 0; run < 3; run++) {
      const start = performance.now()
      json = editor.markdown!.parse(source)
      samples.push(performance.now() - start)
    }
    editor.schema.nodeFromJSON(json).check()
    expect(JSON.stringify(json)).toContain('SENTINEL')
    expect(countNodes(json, 'inlineMath')).toBe(inlineCount)
    expect(countNodes(json, 'blockMath')).toBe(0)
    return samples.sort((a, b) => a - b)[1]
  }

  // At 4× input, growth was 6.0×/12.6×/19.1×; dollars alone grew 17.8× (193→3441 ms).
  // Growth reflects engine/process load, not our contract; it flakes and cannot distinguish our tokenizer from marked.

  // short-formulas: local 33/132 KiB 373.9/6876.1 ms; CI 132 KiB 15624 ms. Its ceiling only guards against hangs; the 3× dollar-path gate bounds marginal cost.
  // Other ceilings stay 1 s / 2 s / 1 s (unclosed-block / unclosed-paren / late-opener), leaving ≥1.9× headroom over observations.
  it.each(['unclosed-block', 'unclosed-paren', 'short-formulas', 'late-opener'] as const)(
    '%s scales from 33 to 132 KiB',
    { timeout: 120_000 },
    (group) => {
      const ceiling = {
        'unclosed-block': 1000,
        'unclosed-paren': 2000,
        'late-opener': 1000,
        'short-formulas': 30000
      }[group]
      for (const size of [33, 132]) {
        const unit =
          group === 'unclosed-block'
            ? '\\[\n' + 'x'.repeat(64) + '\n\n'
            : group === 'unclosed-paren'
              ? '\\(' + 'x'.repeat(64) + '\n\n'
              : group === 'short-formulas'
                ? '\\(a\\) '
                : 'plain text '
        const count = Math.floor((size * KB) / unit.length)
        const source = unit.repeat(count) + (group === 'late-opener' ? '\\(z\\) ' : '') + 'SENTINEL'
        const medians: number[] = []
        const dollarMedians: number[] = []
        // Load spikes inflate timings; alternating rounds and taking minima reduces that noise.
        for (let round = 0; round < 2; round++) {
          medians.push(measure(source, group === 'short-formulas' ? count : group === 'late-opener' ? 1 : 0))
          if (group === 'short-formulas') dollarMedians.push(measure('$a$ '.repeat(count) + 'SENTINEL', count))
        }
        const ms = Math.min(...medians)
        process.stdout.write(
          `${group} ${size}KiB parse median: ${ms.toFixed(1)} ms (r1: ${medians[0].toFixed(1)}, r2: ${medians[1].toFixed(1)})\n`
        )
        if (group === 'short-formulas') {
          const dollarMs = Math.min(...dollarMedians)
          process.stdout.write(
            `${group} ${size}KiB dollar parse median: ${dollarMs.toFixed(1)} ms (r1: ${dollarMedians[0].toFixed(1)}, r2: ${dollarMedians[1].toFixed(1)})\n`
          )
          // Backslash/dollar observed cost is 1.2–1.5× for the same node count; allow load and GC headroom.
          expect(ms).toBeLessThanOrEqual(3 * Math.max(dollarMs, 150))
        }
        expect(ms).toBeLessThan(ceiling)
      }
    }
  )

  it('parses non-math backslashes without producing math or excessive delay', { timeout: 60_000 }, () => {
    // Observed 543 ms vs upstream 606 ms: indexOf-based start does not regress non-math backslashes.
    const unit = String.raw`C:\Users\x \n \* `
    const count = Math.floor((33 * KB) / unit.length)
    const source = unit.repeat(count) + 'SENTINEL'
    const ms = measure(source, 0)
    const upstreamMs = measure(source, 0, [
      ...createRichEditorExtensions().filter((extension) => extension.name !== 'enhancedMath'),
      Mathematics
    ])
    process.stdout.write(
      `non-math-backslashes 33KiB parse median: ${ms.toFixed(1)}ms; upstream: ${upstreamMs.toFixed(1)}ms\n`
    )
    expect(ms).toBeLessThanOrEqual(3 * Math.max(upstreamMs, 20))
  })
})

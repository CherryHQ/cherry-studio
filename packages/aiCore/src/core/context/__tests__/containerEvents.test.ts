import { describe, expect, it } from 'vitest'

import {
  cloneContainerState,
  containerLine,
  containerLines,
  legacyContainerView,
  initialContainerState
} from '../containerEvents'
import disputed from './containerEvents/disputed-cases.json'
import agreed from './containerEvents/dual-oracle-cases.json'
import transitions from './containerEvents/transition84.json'

function codeFor(raw: string): boolean {
  const state = initialContainerState()
  let code = false
  for (const line of raw.trimEnd().split('\n')) {
    const verdict = containerLine(state, line)
    if (line.includes('MARK')) code = verdict.code
  }
  return code
}
describe('ordered container-event classifier, isolated integration gate', () => {
  it('4533 code/paragraph verdicts agreed by both independent renderers', () => {
    for (const { raw, commonmark, markdownIt } of agreed) {
      expect(commonmark).toBe(markdownIt)
      expect(codeFor(raw), JSON.stringify(raw)).toBe(commonmark)
    }
  })
  it('367 explicitly disputed cases follow CommonMark0.31.2 with published compatibility', () => {
    for (const { raw, commonmark, markdownIt } of disputed) {
      expect(commonmark).not.toBe(markdownIt)
      expect(codeFor(raw), JSON.stringify(raw)).toBe(commonmark)
    }
  })
  it('84 review transition witnesses', () => {
    for (const { raw, want } of transitions) expect(codeFor(raw), JSON.stringify(raw)).toBe(want)
  })
  it('child quote makes an empty ancestor nonempty before its own blank', () => {
    const state = initialContainerState()
    const first = containerLine(state, '-')
    const child = containerLine(state, '  >')
    expect(child.events.map((e) => e.kind)).toEqual(['content', 'open'])
    expect(child.events[1].parent).toBe(first.events[0].id)
    expect(containerLine(state, '    <thinking>MARK</thinking>').code).toBe(false)
  })
  it('structural line closes displaced items before opening sibling quote child', () => {
    const state = initialContainerState()
    containerLine(state, '> -')
    containerLine(state, '>   -')
    const line = containerLine(state, '> >')
    expect(line.events.map((e) => e.kind)).toEqual(['close', 'close', 'open'])
    expect(containerLine(state, '>     <thinking>MARK</thinking>').code).toBe(true)
  })
  it('expanded tab coordinates map to raw input offsets', () => {
    const state = initialContainerState()
    const line = containerLine(state, '-\t>')
    expect(line.events.every((e) => e.at <= 3)).toBe(true)
    expect(line.events[line.events.length - 1].at).toBe(3)
  })
})

it('raw-line checkpoints and cloning preserve parent identity across every complete-line split', () => {
  for (const { raw } of agreed) {
    const whole = containerLines(raw)
    for (const line of whole.lines) {
      const head = containerLines(raw.slice(0, line.rawEnd))
      const saved = cloneContainerState(head.state)
      const tail = containerLines(raw.slice(line.rawEnd), head.state)
      expect(head.state).toEqual(saved)
      expect(tail.state, JSON.stringify({ raw, split: line.rawEnd })).toEqual(whole.state)
      expect([
        ...head.lines,
        ...tail.lines.map((r) => ({
          ...r,
          rawStart: r.rawStart + line.rawEnd,
          rawEnd: r.rawEnd + line.rawEnd,
          events: r.events.map((e) => ({ ...e, at: e.at + line.rawEnd }))
        }))
      ]).toEqual(whole.lines)
    }
  }
})
it('unsettled CRLF and partial marker tails do not advance committed state', () => {
  const prefix = containerLines('-\r\n  >\r\n')
  const pending = containerLines('    <thinking', prefix.state)
  expect(pending.lines).toEqual([])
  expect(pending.state).toEqual(prefix.state)
  expect(prefix.lines.map((r) => [r.rawStart, r.rawEnd])).toEqual([
    [0, 3],
    [3, 8]
  ])
})

it('sealed fences retain literal content and use owning container relative closers', () => {
  for (const raw of [
    '```xml\n<thinking>MARK</thinking>\n```\n',
    '- ```\n    <thinking>MARK</thinking>\n    ```\n',
    '10. ~~~\n    <thinking>MARK</thinking>\n    ~~~\n',
    '> - ```\n>   <thinking>MARK</thinking>\n>   ```\n'
  ]) {
    const state = initialContainerState()
    let literal = false
    for (const line of raw.trimEnd().split('\n')) {
      const out = containerLine(state, line)
      if (line.includes('MARK')) literal = out.code
    }
    expect(literal, raw).toBe(true)
    expect(state.fence, raw).toBeNull()
  }
})
it('fence ownership ends on container exit and a shorter marker stays literal', () => {
  const state = initialContainerState()
  containerLine(state, '> ````')
  containerLine(state, '> ```')
  expect(state.fence?.length).toBe(4)
  const out = containerLine(state, 'outside <thinking>MARK</thinking>')
  expect(out.code).toBe(false)
  expect(state.fence).toBeNull()
})

it('leaf headings, thematic breaks, setext and sealed mask events end paragraphs', () => {
  for (const leaf of ['# title', '***', 'text\n===', '\uE000CODE_FENCE_0\uE001']) {
    const state = initialContainerState()
    for (const line of leaf.split('\n')) containerLine(state, line)
    expect(containerLine(state, '    <thinking>MARK</thinking>').code, leaf).toBe(true)
  }
  const state = initialContainerState()
  containerLine(state, 'paragraph')
  expect(containerLine(state, '    <thinking>MARK</thinking>').code).toBe(false)
})

it('legacy projection preserves per-quote relative columns without owning classifier decisions', () => {
  const state = initialContainerState()
  containerLine(state, '- > 1. text')
  const view = legacyContainerView(state)
  expect(view.listColumnStack).toEqual([
    { column: 2, quoteDepth: 0 },
    { column: 3, quoteDepth: 1 }
  ])
  expect(view.paragraphOpen).toBe(true)
  view.listColumnStack.length = 0
  expect(state.stack).toHaveLength(3)
})

it('official CommonMark0.31.2 quote-indent examples', () => {
  const state = initialContainerState()
  expect(containerLine(state, '    > # Foo').code).toBe(true)
  const quote = initialContainerState()
  expect(containerLine(quote, '>     foo').code).toBe(true)
  expect(containerLine(quote, '    bar').code).toBe(true)
})

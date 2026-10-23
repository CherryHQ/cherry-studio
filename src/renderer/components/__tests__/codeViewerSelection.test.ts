// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { mergeCodeViewerSelection, resolveCodeViewerBoundary } from '../codeViewerSelection'

const sides = ['start', 'end'] as const

function fixture(lines = [['abc'], ['def'], ['ghi']], lineNumbers = false) {
  const scroller = document.createElement('div')
  scroller.className = 'shiki-scroller'
  const list = scroller.appendChild(document.createElement('div'))
  list.className = 'shiki-list'
  const wrapper = list.appendChild(document.createElement('div'))
  wrapper.style.position = 'absolute'
  const rows = lines.map((tokens, index) => {
    const row = wrapper.appendChild(document.createElement('div'))
    row.dataset.index = String(index + 2)
    const line = row.appendChild(document.createElement('div'))
    line.className = 'line'
    if (lineNumbers) {
      const number = line.appendChild(document.createElement('span'))
      number.className = 'line-number'
      number.textContent = String(index + 3)
    }
    const content = line.appendChild(document.createElement('span'))
    content.className = 'line-content'
    for (const text of tokens) {
      const token = content.appendChild(document.createElement('span'))
      token.textContent = text
    }
    return { row, line, content }
  })
  return { scroller, list, wrapper, rows }
}

function multiTokenFixture() {
  return fixture(
    Array.from({ length: 3 }, () => ['const ', 'value3', ' = "abcdefghij"']),
    true
  )
}

describe('resolveCodeViewerBoundary', () => {
  // Before fix: RED — container ancestors have no data-index.
  it('maps container starts to the following rendered row', () => {
    const { scroller, list, wrapper } = fixture()
    for (const node of [scroller, list, wrapper]) {
      expect(resolveCodeViewerBoundary(scroller, node, 0, 'start')).toEqual({ line: 2, offset: 0, source: 'container' })
    }
    expect(resolveCodeViewerBoundary(scroller, wrapper, 2, 'start')).toEqual({
      line: 4,
      offset: 0,
      source: 'container'
    })
  })

  // Before fix: RED — container ends, including oversized offsets, cannot resolve.
  it('maps container ends to the following rendered row or the last line end', () => {
    const { scroller, wrapper } = fixture()
    expect(resolveCodeViewerBoundary(scroller, wrapper, 2, 'end')).toEqual({ line: 4, offset: 0, source: 'container' })
    for (const offset of [3, 8]) {
      expect(resolveCodeViewerBoundary(scroller, wrapper, offset, 'end')).toEqual({
        line: 4,
        offset: 3,
        source: 'container'
      })
    }
  })

  // Before fix: RED — an empty rendered row must still own its container gap.
  it('keeps an empty rendered line at a gap', () => {
    const { scroller, wrapper } = fixture([['abc'], [''], ['ghi']])
    for (const side of sides) {
      expect(resolveCodeViewerBoundary(scroller, wrapper, 1, side)).toEqual({ line: 3, offset: 0, source: 'container' })
    }
  })

  // Before fix: RED — redirecting to line-content loses the data-index ancestor.
  it('excludes line numbers from both sides', () => {
    const { scroller, rows } = multiTokenFixture()
    const number = rows[1].line.firstChild!
    for (const node of [number, number.firstChild!]) {
      for (const offset of [0, 1]) {
        for (const side of sides) {
          expect(resolveCodeViewerBoundary(scroller, node, offset, side)).toEqual({
            line: 3,
            offset: 0,
            source: 'line'
          })
        }
      }
    }
  })

  // Before fix: RED — child indices were interpreted as character offsets.
  it('counts content children in UTF-16 code units', () => {
    const { scroller, rows } = multiTokenFixture()
    for (const [offset, expected] of [
      [0, 0],
      [1, 6],
      [2, 12],
      [3, 27]
    ]) {
      for (const side of sides) {
        expect(resolveCodeViewerBoundary(scroller, rows[1].content, offset, side)).toEqual({
          line: 3,
          offset: expected,
          source: 'line'
        })
      }
    }
  })

  // Before fix: RED — row ancestors included gutter text and counted child indices.
  it('clamps line and row containers to code content', () => {
    const { scroller, rows } = multiTokenFixture()
    for (const [node, offsets] of [
      [rows[1].line, [0, 0, 27]],
      [rows[1].row, [0, 27]]
    ] as const) {
      offsets.forEach((expected, offset) => {
        for (const side of sides) {
          expect(resolveCodeViewerBoundary(scroller, node, offset, side)).toEqual({
            line: 3,
            offset: expected,
            source: 'line'
          })
        }
      })
    }
  })

  // Before fix: RED — token element offsets omitted preceding tokens.
  it('includes preceding tokens for an element boundary', () => {
    const { scroller, rows } = multiTokenFixture()
    for (const [offset, expected] of [
      [0, 6],
      [1, 12]
    ]) {
      for (const side of sides) {
        expect(resolveCodeViewerBoundary(scroller, rows[1].content.children[1], offset, side)).toEqual({
          line: 3,
          offset: expected,
          source: 'line'
        })
      }
    }
  })

  // Before fix: GREEN — text offsets and preceding text already used UTF-16 lengths.
  it('preserves text node offsets', () => {
    const { scroller, rows } = fixture([['abcdefghij'], ['ab', '😀cd'], ['ghi']])
    expect(resolveCodeViewerBoundary(scroller, rows[0].content.firstChild!.firstChild!, 1, 'start')).toEqual({
      line: 2,
      offset: 1,
      source: 'line'
    })
    expect(resolveCodeViewerBoundary(scroller, rows[0].content.firstChild!.firstChild!, 7, 'end')).toEqual({
      line: 2,
      offset: 7,
      source: 'line'
    })
    for (const side of sides) {
      expect(resolveCodeViewerBoundary(scroller, rows[1].content.children[1].firstChild!, 2, side)).toEqual({
        line: 3,
        offset: 4,
        source: 'line'
      })
    }
  })

  // Before fix: GREEN — retaining next-line offset zero preserves the trailing newline.
  it('preserves the next line content offset zero', () => {
    const { scroller, rows } = fixture()
    expect(resolveCodeViewerBoundary(scroller, rows[1].content, 0, 'end')).toEqual({
      line: 3,
      offset: 0,
      source: 'line'
    })
  })

  // Before fix: GREEN — empty content already yields zero; container-gap coverage above is RED.
  it('maps empty content boundaries to their own row', () => {
    const { scroller, rows } = fixture([['abc'], [''], ['ghi']])
    for (const [node, offset] of [
      [rows[1].content, 0],
      [rows[1].content, 1],
      [rows[1].content.firstChild!, 0]
    ] as const) {
      for (const side of sides) {
        expect(resolveCodeViewerBoundary(scroller, node, offset, side)).toEqual({ line: 3, offset: 0, source: 'line' })
      }
    }
  })

  // Before fix: GREEN — no rendered row must not fabricate line zero.
  it('returns null when the viewer has no rendered rows', () => {
    const { scroller, list, wrapper } = fixture([])
    for (const node of [scroller, list, wrapper]) {
      for (const side of sides) expect(resolveCodeViewerBoundary(scroller, node, 0, side)).toBeNull()
    }
  })

  it('rejects boundaries in another viewer', () => {
    const { scroller } = fixture()
    const other = fixture()
    expect(resolveCodeViewerBoundary(scroller, other.rows[0].content, 0, 'start')).toBeNull()
  })
})

describe('mergeCodeViewerSelection', () => {
  it('keeps a captured start when the container boundary moves earlier', () => {
    const previous = { startLine: 10, startOffset: 0, endLine: 29, endOffset: 2 }
    expect(
      mergeCodeViewerSelection(
        previous,
        { line: 0, offset: 0, source: 'container' },
        { line: 29, offset: 2, source: 'line' },
        true
      )
    ).toEqual(previous)
  })

  it('keeps a captured end when the container boundary moves later', () => {
    const previous = { startLine: 10, startOffset: 0, endLine: 20, endOffset: 2 }
    expect(
      mergeCodeViewerSelection(
        previous,
        { line: 10, offset: 0, source: 'line' },
        { line: 29, offset: 2, source: 'container' },
        true
      )
    ).toEqual(previous)
  })

  it('takes real line boundaries in both directions', () => {
    const previous = { startLine: 10, startOffset: 0, endLine: 20, endOffset: 2 }
    for (const [startLine, startOffset, endLine, endOffset] of [
      [0, 0, 29, 2],
      [11, 1, 19, 1],
      [10, 1, 20, 1]
    ]) {
      expect(
        mergeCodeViewerSelection(
          previous,
          { line: startLine, offset: startOffset, source: 'line' },
          { line: endLine, offset: endOffset, source: 'line' },
          true
        )
      ).toEqual({ startLine, startOffset, endLine, endOffset })
    }
  })

  it('keeps a captured line endpoint when no selection input happened', () => {
    expect(
      mergeCodeViewerSelection(
        { startLine: 10, startOffset: 0, endLine: 29, endOffset: 2 },
        { line: 10, offset: 0, source: 'line' },
        { line: 29, offset: 0, source: 'line' },
        false
      )
    ).toEqual({ startLine: 10, startOffset: 0, endLine: 29, endOffset: 2 })
  })

  it('replaces line endpoints when a selection input happened', () => {
    expect(
      mergeCodeViewerSelection(
        { startLine: 10, startOffset: 0, endLine: 29, endOffset: 2 },
        { line: 10, offset: 0, source: 'line' },
        { line: 29, offset: 0, source: 'line' },
        true
      )
    ).toEqual({ startLine: 10, startOffset: 0, endLine: 29, endOffset: 0 })
  })

  it('accepts container boundaries when nothing was captured', () => {
    expect(
      mergeCodeViewerSelection(
        null,
        { line: 10, offset: 0, source: 'container' },
        { line: 29, offset: 2, source: 'container' },
        true
      )
    ).toEqual({ startLine: 10, startOffset: 0, endLine: 29, endOffset: 2 })
  })
})

import { findBlockContext } from '@renderer/utils/branchAnchor/findBlockContext'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Build a DOM fragment like the one MainTextBlock renders, with two
 * sibling blocks under one message. Helpers below assemble specific
 * Range objects to drive the unit tests.
 */
function buildFixture() {
  document.body.innerHTML = `
    <div id="msg" data-message-id="m1">
      <div id="b1" data-block-id="block-a">
        <p id="p1a">Hello <span id="span1a">world</span></p>
        <p id="p2a">Second paragraph in block A</p>
      </div>
      <div id="b2" data-block-id="block-b">
        <p id="p1b">Different block content</p>
      </div>
    </div>
    <div id="loose">No data attributes here</div>
  `
}

function rangeOver(startEl: string, endEl: string): Range {
  const start = document.getElementById(startEl)
  const end = document.getElementById(endEl)
  if (!start || !end) throw new Error(`fixture missing ${startEl} or ${endEl}`)
  const range = document.createRange()
  // Wrap whole element content so the range has non-collapsed contents.
  range.setStart(start, 0)
  range.setEnd(end, end.childNodes.length)
  return range
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('findBlockContext', () => {
  it('returns null when range is missing', () => {
    expect(findBlockContext(null)).toBeNull()
    expect(findBlockContext(undefined)).toBeNull()
  })

  it('returns null when range is collapsed (no actual selection)', () => {
    buildFixture()
    const range = document.createRange()
    range.setStart(document.getElementById('p1a')!, 0)
    range.collapse(true)
    expect(findBlockContext(range)).toBeNull()
  })

  it('resolves messageId + blockId for a selection inside a single block', () => {
    buildFixture()
    const range = rangeOver('p1a', 'p2a')
    expect(findBlockContext(range)).toEqual({ messageId: 'm1', blockId: 'block-a' })
  })

  it('returns null for a cross-block selection within the same message', () => {
    buildFixture()
    const range = rangeOver('p2a', 'p1b')
    expect(findBlockContext(range)).toBeNull()
  })

  it('returns null when the selection sits outside any tagged wrapper', () => {
    buildFixture()
    const range = rangeOver('loose', 'loose')
    expect(findBlockContext(range)).toBeNull()
  })

  it('resolves via a nested element (climbs through child spans)', () => {
    buildFixture()
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('span1a')!)
    expect(findBlockContext(range)).toEqual({ messageId: 'm1', blockId: 'block-a' })
  })

  it('returns null when a block wrapper has no data-message-id ancestor', () => {
    // Defensive case: a stray block without a message wrapper.
    document.body.innerHTML = `
      <div id="orphan" data-block-id="block-x"><p id="p">orphan content</p></div>
    `
    const range = document.createRange()
    range.selectNodeContents(document.getElementById('p')!)
    expect(findBlockContext(range)).toBeNull()
  })
})

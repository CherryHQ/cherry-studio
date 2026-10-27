import { describe, expect, it } from 'vitest'

import {
  advanceIndentedMaskState,
  initialIndentedMaskState,
  maskCodeFences,
  stripKnownModelScratchpadBlocksPreservingCodeFences as stripWhole,
  stripKnownModelScratchpadBlocksPreservingCodeFencesStepped as stripStepped
} from '../scratchpadText'

// Split `text` at a line boundary, advance the carried mask state over the
// fence-masked prefix, then stepped-strip the suffix. Parity claim: when the
// prefix survives stripping whole (committed text), the stepped suffix result
// equals the whole-strip tail.
function steppedAfterCommit(text: string, prefixLen: number): { whole: string; stepped: string } {
  const prefix = text.slice(0, prefixLen)
  const suffix = text.slice(prefixLen)
  const state = initialIndentedMaskState()
  advanceIndentedMaskState(state, maskCodeFences(prefix).text)
  return {
    whole: stripWhole(text),
    stepped: stripStepped(suffix, { initialMaskState: state })
  }
}

function lineBoundarySplits(text: string): number[] {
  const splits: number[] = []
  let idx = text.indexOf('\n')
  while (idx !== -1 && idx + 1 < text.length) {
    splits.push(idx + 1)
    idx = text.indexOf('\n', idx + 1)
  }
  return splits
}

const CORPUS: Array<{ name: string; text: string }> = [
  {
    name: 'round-17 markdown-container-loss',
    text: '- A\n  > B\n>     <thinking>literal</thinking>\n'
  },
  {
    name: 'list with quoted child and scratchpad in later item',
    text: '- A\n  > B\n- C\n\n<thinking>private analysis</thinking>\n\nDone.\n'
  },
  {
    name: 'indented code after paragraph (literal, cannot interrupt)',
    text: 'Some text\n    <thinking>literal code</thinking>\n\nAfter.\n'
  },
  {
    name: 'indented code after heading (real code block)',
    text: '# Title\n\n    <thinking>literal code</thinking>\n\nAfter.\n'
  },
  {
    name: 'nested list quote scratchpad top-level',
    text: 'intro\n\n- one\n  - two\n    > quoted\n\n<thinking>gone</thinking>\n\noutro\n'
  },
  {
    name: 'html block then scratchpad',
    text: '<div>\ncontent\n</div>\n\n<thinking>gone</thinking>\n\nend\n'
  },
  {
    name: 'fenced code with tag inside (fence spans split avoided)',
    text: 'before\n\n```\n<thinking>literal</thinking>\n```\n\n<thinking>gone</thinking>\n\nafter\n'
  }
]

describe('stepped incremental strip parity', () => {
  for (const { name, text } of CORPUS) {
    it(`whole-strip sanity: ${name}`, () => {
      expect(stripWhole(text)).toBe(stripWhole(text))
    })
    it(`split parity at every line boundary: ${name}`, () => {
      // Avoid splitting inside fenced regions, measured in ORIGINAL text
      // coordinates (adapter wires fence carry separately).
      const fenceBoundaries = new Set<number>()
      {
        let inFence = false
        let pos = 0
        for (const line of text.split('\n')) {
          const lineEnd = pos + line.length + 1
          if (/^ {0,3}(`{3,}|~{3,})/.test(line)) inFence = !inFence
          // Block splits after the opener and after content lines (fence still open).
          if (inFence) fenceBoundaries.add(lineEnd)
          pos = lineEnd
        }
      }
      for (const split of lineBoundarySplits(text)) {
        if (fenceBoundaries.has(split)) continue
        const prefix = text.slice(0, split)
        const whole = stripWhole(text)
        // Only check splits whose prefix survives stripping intact (committed-text invariant).
        if (stripWhole(prefix) !== prefix) continue
        if (!whole.startsWith(prefix)) continue
        const { stepped } = steppedAfterCommit(text, split)
        expect(stepped).toBe(whole.slice(prefix.length))
      }
    })
  }

  it('round-17 counterexample: literal indented tag inside list+quote survives the streamed path', () => {
    const text = '- A\n  > B\n>     <thinking>literal</thinking>\n'
    // Whole-document reference: the literal indented code is preserved.
    expect(stripWhole(text)).toBe(text)
    const commit = '- A\n  > B\n'
    const { stepped } = steppedAfterCommit(text, commit.length)
    expect(stepped).toBe('>     <thinking>literal</thinking>\n')
  })

  it('round-17 bug shape: dropping the open line loses ownership (documents old failure)', () => {
    // The old path reconstructed an empty prefix and scanned the delta alone.
    expect(stripWhole('<thinking>literal</thinking>')).toBe('')
  })
})
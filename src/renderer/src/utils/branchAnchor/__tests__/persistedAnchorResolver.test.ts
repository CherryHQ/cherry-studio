import { afterEach, describe, expect, it } from 'vitest'

import { type PersistedAnchorLike, resolvePersistedBranchAnchorRange } from '../persistedAnchorResolver'

function makeBlock(html: string): Element {
  const block = document.createElement('div')
  block.setAttribute('data-block-id', 'block-1')
  block.innerHTML = html
  document.body.appendChild(block)
  return block
}

function makeAnchor(overrides: Partial<PersistedAnchorLike> = {}): PersistedAnchorLike {
  return {
    id: 'anchor-1',
    branchTopicId: 'branch-topic-1',
    blockId: 'block-1',
    selectedText: 'beta',
    selectionStart: 6,
    selectionEnd: 10,
    ...overrides
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('resolvePersistedBranchAnchorRange', () => {
  it('hydrates valid offsets with the original start/end', () => {
    const block = makeBlock('alpha beta gamma')

    expect(resolvePersistedBranchAnchorRange(block, makeAnchor())).toEqual({
      status: 'hydrated',
      resolvedSelectionStart: 6,
      resolvedSelectionEnd: 10
    })
  })

  it('hydrates with unique selectedText fallback when offsets are out of range', () => {
    const block = makeBlock('alpha beta gamma')

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectionStart: 50,
          selectionEnd: 54
        })
      )
    ).toEqual({
      status: 'hydrated',
      resolvedSelectionStart: 6,
      resolvedSelectionEnd: 10
    })
  })

  it('hydrates with unique selectedText fallback when offsets point at different text', () => {
    const block = makeBlock('prefix alpha beta gamma')

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectionStart: 0,
          selectionEnd: 4
        })
      )
    ).toEqual({
      status: 'hydrated',
      resolvedSelectionStart: 13,
      resolvedSelectionEnd: 17
    })
  })

  it('skips when selectedText appears multiple times', () => {
    const block = makeBlock('alpha beta beta gamma')

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectionStart: 50,
          selectionEnd: 54
        })
      )
    ).toEqual({
      status: 'skipped',
      skippedReason: 'selected_text_ambiguous'
    })
  })

  it('skips when selectedText is not found', () => {
    const block = makeBlock('alpha gamma delta')

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectionStart: 0,
          selectionEnd: 5
        })
      )
    ).toEqual({
      status: 'skipped',
      skippedReason: 'selected_text_not_found'
    })
  })

  it('skips empty selectedText', () => {
    const block = makeBlock('alpha beta gamma')

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectedText: '',
          selectionStart: 0,
          selectionEnd: 0
        })
      )
    ).toEqual({
      status: 'skipped',
      skippedReason: 'invalid_selected_text'
    })
  })

  it('skips invalid offsets with no fallback as offset_out_of_range', () => {
    const block = makeBlock('alpha gamma delta')

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectedText: 'missing',
          selectionStart: -1,
          selectionEnd: 4
        })
      )
    ).toEqual({
      status: 'skipped',
      skippedReason: 'offset_out_of_range'
    })
  })

  it('uses JavaScript string indexing for unicode and CJK text', () => {
    const block = makeBlock('前缀你好世界后缀')
    const selectedText = '你好世界'
    const selectionStart = block.textContent!.indexOf(selectedText)

    expect(
      resolvePersistedBranchAnchorRange(
        block,
        makeAnchor({
          selectedText,
          selectionStart,
          selectionEnd: selectionStart + selectedText.length
        })
      )
    ).toEqual({
      status: 'hydrated',
      resolvedSelectionStart: 2,
      resolvedSelectionEnd: 6
    })
  })

  it('does not mutate block.innerHTML', () => {
    const block = makeBlock('alpha <strong>beta</strong> gamma')
    const before = block.innerHTML

    resolvePersistedBranchAnchorRange(block, makeAnchor())

    expect(block.innerHTML).toBe(before)
  })
})

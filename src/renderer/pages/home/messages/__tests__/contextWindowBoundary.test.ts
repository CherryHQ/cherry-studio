import { describe, expect, it } from 'vitest'

import { createClearContextPart } from '@shared/data/types/uiParts'

import { type ContextWindowPathRow, findContextWindowBoundary } from '../contextWindowBoundary'

const u = (id: string): ContextWindowPathRow => ({ id, role: 'user', data: {} })
const a = (id: string): ContextWindowPathRow => ({ id, role: 'assistant', data: {} })
const clear = (id: string): ContextWindowPathRow => ({
  id,
  role: 'user',
  data: { parts: [createClearContextPart()] }
})

const appendNextTurn = { nextTurnFillsActiveNode: false }

describe('findContextWindowBoundary', () => {
  it('shows nothing when the limit is off or the next request still carries every message', () => {
    const path = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')]
    expect(findContextWindowBoundary(path, null, appendNextTurn)).toBeNull()
    expect(findContextWindowBoundary(path, 7, appendNextTurn)).toBeNull()
    expect(findContextWindowBoundary([], 2, appendNextTurn)).toBeNull()
  })

  it('counts the message about to be sent, so the boundary lands where main cuts the next request', () => {
    // Migrated v1 default (6): after four full turns the next question no longer carries the first one.
    const path = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3'), u('u4'), a('a4')]
    expect(findContextWindowBoundary(path, 6, appendNextTurn)).toEqual({ kind: 'before', messageId: 'u2' })
    expect(findContextWindowBoundary(path.slice(0, 6), 6, appendNextTurn)).toBeNull()
  })

  it('moves the boundary back to the user row that opens the kept turn', () => {
    const path = [u('u1'), a('a1'), u('u2'), a('a2')]
    // Last 2 of [..., a2, next] would open on a2; main extends back to u2.
    expect(findContextWindowBoundary(path, 2, appendNextTurn)).toEqual({ kind: 'before', messageId: 'u2' })
  })

  it('can mark the first loaded user row when the cut reaches the page edge', () => {
    const path = [u('u2'), a('a2')]
    const options = { ...appendNextTurn, precedingMessageId: 'a1' }
    expect(findContextWindowBoundary(path, 2, options)).toEqual({
      kind: 'before',
      messageId: 'u2',
      precedingMessageId: 'a1'
    })
    expect(findContextWindowBoundary(path, 4, options)).toBeNull()
    expect(findContextWindowBoundary([a('a2')], 2, options)).toBeNull()
    expect(findContextWindowBoundary([clear('reset'), ...path], 2, options)).toBeNull()
  })

  it('places the boundary after the whole history when only the new message is sent', () => {
    expect(findContextWindowBoundary([u('u1'), a('a1')], 1, appendNextTurn)).toEqual({ kind: 'after-last' })
  })

  it('windows only what follows the latest clear-context marker', () => {
    const path = [u('u1'), a('a1'), u('u2'), a('a2'), clear('c1'), u('u3'), a('a3')]
    expect(findContextWindowBoundary(path, 3, appendNextTurn)).toBeNull()
    expect(findContextWindowBoundary(path, 1, appendNextTurn)).toEqual({ kind: 'after-last' })
    expect(findContextWindowBoundary([...path.slice(0, 4), clear('c1')], 1, appendNextTurn)).toBeNull()
  })

  it('does not add a row when the next submit fills a reserved blank user leaf', () => {
    const path = [u('u1'), a('a1'), u('u2'), a('a2'), u('blank')]
    const fillsLeaf = { nextTurnFillsActiveNode: true }
    expect(findContextWindowBoundary(path, 3, fillsLeaf)).toEqual({ kind: 'before', messageId: 'u2' })
    expect(findContextWindowBoundary(path, 1, fillsLeaf)).toEqual({ kind: 'after-last' })
  })
})

import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'

import { messagePartEntries, messagePartsAt, replyParts } from '../messagePartRows'

const parts = (text: string): CherryMessagePart[] => [{ type: 'text', text }]
const reply = (id: string, parts: CherryMessagePart[], partIds?: string[]): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts,
  partIds
})

describe('reading live reply parts', () => {
  it.each([20, 20_000])('touches only the requested row in a history of %i messages', (size) => {
    let reads = 0
    const history: Record<string, CherryMessagePart[]> = {}
    const saved = parts('saved')
    for (let i = 0; i < size; i++) {
      Object.defineProperty(history, String(i), {
        enumerable: true,
        get: () => {
          reads++
          return saved
        }
      })
    }
    const source = new Proxy(history, {
      ownKeys: () => {
        throw new Error('enumerated history')
      }
    })
    const id = String(size - 1)
    const live = parts('streaming')
    const current = replyParts(source, [reply(id, live), reply('new', live)])
    expect(messagePartsAt(current, id)).toBe(live)
    expect(messagePartsAt(current, 'new')).toBe(live)
    expect(reads).toBe(0)
    expect(messagePartsAt(replyParts(source, [reply(id, [], [])]), id)).toEqual([])
    expect(reads).toBe(0)
    expect(messagePartsAt(replyParts(source, [reply(id, [])]), id)).toBe(saved)
    expect(messagePartsAt(replyParts(source, []), 'new')).toBeUndefined()
    expect(reads).toBe(1)
  })

  it('enumerates current rows once in history order, including live-only replies at the end', () => {
    const a = parts('a')
    const old = parts('b')
    const current = parts('new b')
    const live = parts('c')
    const history = { a, b: old }
    const rows = replyParts(history, [reply('c', live), reply('b', current)])
    expect([...messagePartEntries(rows)]).toEqual([
      ['a', a],
      ['b', current],
      ['c', live]
    ])
    expect(history.b).toBe(old)
  })
})

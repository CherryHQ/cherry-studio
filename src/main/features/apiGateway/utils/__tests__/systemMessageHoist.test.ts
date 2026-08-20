import type { CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { hoistSystemMessages } from '../systemMessageHoist'

const msg = (role: CherryUIMessage['role'], text: string, id: string = role): CherryUIMessage =>
  ({ id, role, parts: [{ type: 'text', text }] }) as CherryUIMessage

describe('hoistSystemMessages', () => {
  it('merges non-leading system messages into the leading one, preserving order', () => {
    const out = hoistSystemMessages([
      msg('system', 'Base.', 's0'),
      msg('user', 'go'),
      msg('system', 'MCP connecting.', 's1'),
      msg('assistant', 'ok'),
      msg('system', 'Agent types changed.', 's2')
    ])

    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(out[0].parts).toEqual([{ type: 'text', text: 'Base.\n\nMCP connecting.\n\nAgent types changed.' }])
  })

  it('promotes the first inline system message when there is no leading one', () => {
    const out = hoistSystemMessages([msg('user', 'go'), msg('system', 'MCP connecting.')])

    expect(out.map((m) => m.role)).toEqual(['system', 'user'])
    expect(out[0].parts).toEqual([{ type: 'text', text: 'MCP connecting.' }])
  })

  it('returns the input untouched when only a leading system message is present', () => {
    const input = [msg('system', 'Base.'), msg('user', 'go'), msg('assistant', 'ok')]

    expect(hoistSystemMessages(input)).toBe(input)
  })

  it('returns the input untouched when there is no system message at all', () => {
    const input = [msg('user', 'go'), msg('assistant', 'ok')]

    expect(hoistSystemMessages(input)).toBe(input)
  })

  it('drops an empty system message rather than emitting a blank leading turn', () => {
    const out = hoistSystemMessages([msg('user', 'go'), { id: 's', role: 'system', parts: [] } as CherryUIMessage])

    expect(out.map((m) => m.role)).toEqual(['user'])
  })
})

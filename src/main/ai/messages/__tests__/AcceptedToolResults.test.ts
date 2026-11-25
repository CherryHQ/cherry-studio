import { describe, expect, it } from 'vitest'

import { AcceptedToolResults } from '../AcceptedToolResults'

const tool = (output: unknown) => ({
  type: 'dynamic-tool' as const,
  toolName: 'Read',
  toolCallId: 'call',
  state: 'output-available' as const,
  input: {},
  output
})

describe('accepted tool results', () => {
  it('snapshots mutable native output and replaces the same call only at acceptance', () => {
    const owner = new AcceptedToolResults('topic')
    const output = { text: 'a'.repeat(64 * 1024) }
    owner.accept('message', tool(output))
    output.text = 'b'.repeat(64 * 1024)
    expect(owner.get('message', 'call')).toMatchObject({ found: true, output: { text: 'a'.repeat(64 * 1024) } })
    owner.accept('message', tool(output))
    expect(owner.get('message', 'call')).toMatchObject({ found: true, output })
    expect(owner.get('another-message', 'call')).toEqual({ found: false })
    owner.clear()
    expect(owner.get('message', 'call')).toEqual({ found: false })
  })

  it('reuses a settled compact part without inspecting or serializing its unchanged body', () => {
    const owner = new AcceptedToolResults('topic')
    const output = { text: 'a'.repeat(64 * 1024) }
    const part = tool(output)
    const compact = owner.accept('message', part)
    Object.defineProperty(output, 'toJSON', {
      value: () => {
        throw Error('Settled output was serialized again')
      }
    })
    expect(owner.project('message', part)).toBe(compact)
    expect(owner.project('message', part)).toBe(compact)
    const result = owner.get('message', 'call')
    if (!result.found) throw Error('Accepted result missing')
    expect(JSON.parse(result.serializedBytes.toString('utf8'))).toEqual({ text: 'a'.repeat(64 * 1024) })
    const again = owner.get('message', 'call')
    if (!again.found) throw Error('Accepted result missing')
    expect(again.serializedBytes).toBe(result.serializedBytes)
  })
})

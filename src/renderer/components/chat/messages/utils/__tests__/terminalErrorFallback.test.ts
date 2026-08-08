import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { withTerminalErrorFallback } from '../terminalErrorFallback'

function makeMessage(id: string, status: 'success' | 'error' | undefined, parts: CherryMessagePart[]): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts,
    metadata: status === undefined ? undefined : { status }
  } as unknown as CherryUIMessage
}

const stepStart = { type: 'step-start' } as CherryMessagePart
const text = { type: 'text', text: 'hello' } as CherryMessagePart
const errorPart = {
  type: 'data-error',
  data: { name: 'Error', message: 'boom', stack: null }
} as CherryMessagePart

describe('withTerminalErrorFallback', () => {
  it('appends a no-response error part to a success message with only hidden parts', () => {
    const messages = [makeMessage('m1', 'success', [stepStart])]
    const partsByMessageId = { m1: [stepStart] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next).not.toBe(partsByMessageId)
    expect(next.m1).toEqual([
      stepStart,
      { type: 'data-error', data: { name: 'AgentRuntimeError', message: 'No response', stack: null } }
    ])
  })

  it('appends a no-response error part to a success message with no parts', () => {
    const messages = [makeMessage('m1', 'success', [])]
    const partsByMessageId = { m1: [] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next.m1).toHaveLength(1)
    expect(next.m1[0]).toMatchObject({ type: 'data-error', data: { message: 'No response' } })
  })

  it('appends a no-response error part to an error message lacking a data-error part', () => {
    const messages = [makeMessage('m1', 'error', [stepStart])]
    const partsByMessageId = { m1: [stepStart] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next.m1.some((part) => part.type === 'data-error')).toBe(true)
  })

  it('leaves an error message that already has a data-error part unchanged', () => {
    const messages = [makeMessage('m1', 'error', [errorPart])]
    const partsByMessageId = { m1: [errorPart] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next).toBe(partsByMessageId)
  })

  it('leaves a success message with visible content unchanged', () => {
    const messages = [makeMessage('m1', 'success', [text])]
    const partsByMessageId = { m1: [text] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next).toBe(partsByMessageId)
  })

  it('ignores non-assistant messages', () => {
    const userMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'hi' }]
    } as unknown as CherryUIMessage
    const partsByMessageId = {}

    const next = withTerminalErrorFallback([userMessage], partsByMessageId, 'No response')

    expect(next).toBe(partsByMessageId)
  })

  it('only clones the map when at least one message needs a fallback', () => {
    const messages = [makeMessage('ok', 'success', [text]), makeMessage('empty', 'success', [stepStart])]
    const partsByMessageId = { ok: [text], empty: [stepStart] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next).not.toBe(partsByMessageId)
    expect(next.ok).toBe(partsByMessageId.ok)
    expect(next.empty.some((part) => part.type === 'data-error')).toBe(true)
  })
})

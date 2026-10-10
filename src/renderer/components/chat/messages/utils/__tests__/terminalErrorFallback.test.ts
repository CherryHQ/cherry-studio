import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { createDismissedNoResponsePart } from '@shared/data/types/uiParts'

import { withEmptySuccessFallback, withNoResponseFallback, withTerminalErrorFallback } from '../terminalErrorFallback'

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

  it('leaves empty success messages unchanged since empty turns are legitimate for agent sessions', () => {
    const messages = [makeMessage('m1', 'success', [stepStart])]
    const partsByMessageId = { m1: [stepStart] }

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

  it('does not add fallback to error message that already has visible content without data-error', () => {
    const messages = [makeMessage('m1', 'error', [text])]
    const partsByMessageId = { m1: [text] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next).toBe(partsByMessageId)
  })

  it('does not add fallback when dismissed marker is present', () => {
    const dismissed = createDismissedNoResponsePart() as unknown as CherryMessagePart
    const messages = [makeMessage('m1', 'error', [dismissed])]
    const partsByMessageId = { m1: [dismissed] }

    const next = withTerminalErrorFallback(messages, partsByMessageId, 'No response')

    expect(next).toBe(partsByMessageId)
  })
})

describe('withEmptySuccessFallback', () => {
  it('appends a no-response error part to a success message with only hidden parts', () => {
    const messages = [makeMessage('m1', 'success', [stepStart])]
    const partsByMessageId = { m1: [stepStart] }

    const next = withEmptySuccessFallback(messages, partsByMessageId, 'No response')

    expect(next).not.toBe(partsByMessageId)
    expect(next.m1).toEqual([
      stepStart,
      {
        type: 'data-error',
        data: { name: 'NoResponseError', message: 'No response', stack: null, i18nKey: 'no_response' }
      }
    ])
  })

  it('leaves error messages unchanged', () => {
    const messages = [makeMessage('m1', 'error', [stepStart])]
    const partsByMessageId = { m1: [stepStart] }

    const next = withEmptySuccessFallback(messages, partsByMessageId, 'No response')

    expect(next).toBe(partsByMessageId)
  })
})

describe('withNoResponseFallback', () => {
  it('covers both empty success and error without data-error, preserving unaffected entries', () => {
    const messages = [makeMessage('ok', 'success', [text]), makeMessage('empty', 'success', [stepStart])]
    const partsByMessageId = { ok: [text], empty: [stepStart] }

    const next = withNoResponseFallback(messages, partsByMessageId, 'No response')

    expect(next).not.toBe(partsByMessageId)
    expect(next.ok).toBe(partsByMessageId.ok)
    expect(next.empty.some((part) => part.type === 'data-error')).toBe(true)
  })
})

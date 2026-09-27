import { describe, expect, it } from 'vitest'

import type { CherryUIMessage, MessageStatus } from '@shared/data/types/message'

import { isFailedAssistantMessage } from '../isFailedAssistantMessage'

describe('isFailedAssistantMessage', () => {
  const assistant = (status: MessageStatus, parts: CherryUIMessage['parts']): CherryUIMessage => ({
    id: 'a1',
    role: 'assistant',
    parts,
    metadata: { status }
  })

  it('matches error, paused, and empty assistant rows that are not pending', () => {
    expect(isFailedAssistantMessage(assistant('error', [{ type: 'text', text: 'x' }]))).toBe(true)
    expect(isFailedAssistantMessage(assistant('paused', [{ type: 'text', text: 'x' }]))).toBe(true)
    expect(isFailedAssistantMessage(assistant('success', []))).toBe(true)
  })

  it('excludes pending assistants and successful responses with content', () => {
    expect(isFailedAssistantMessage(assistant('pending', []))).toBe(false)
    expect(isFailedAssistantMessage(assistant('success', [{ type: 'text', text: 'ok' }]))).toBe(false)
  })
})

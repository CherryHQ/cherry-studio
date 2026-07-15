import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { canEditAssistantMessageParts } from '../partsHelpers'

const parts = (...items: Array<Record<string, unknown>>) => items as CherryMessagePart[]

describe('canEditAssistantMessageParts', () => {
  it.each([
    {
      messageParts: parts(
        { type: 'reasoning', text: 'reasoning' },
        { type: 'text', text: 'answer' },
        { type: 'data-translation', data: { content: 'translation', targetLanguage: 'en-us' } }
      )
    },
    {
      messageParts: parts(
        { type: 'dynamic-tool', toolCallId: 'tool-1', toolName: 'read', state: 'output-available' },
        { type: 'text', text: 'answer' }
      )
    },
    {
      messageParts: parts(
        { type: 'text', text: 'answer' },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'data-citation', data: {} }
      )
    },
    {
      messageParts: parts({ type: 'text', text: 'first paragraph' }, { type: 'text', text: 'second paragraph' })
    }
  ])('allows one unambiguous editable run', ({ messageParts }) => {
    expect(canEditAssistantMessageParts(messageParts)).toBe(true)
  })

  it.each([
    {
      messageParts: parts(
        { type: 'text', text: 'before tool' },
        { type: 'dynamic-tool', toolCallId: 'tool-1', toolName: 'read', state: 'output-available' },
        { type: 'text', text: 'after tool' }
      )
    },
    {
      messageParts: parts(
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'text', text: 'answer' }
      )
    },
    {
      messageParts: parts(
        { type: 'text', text: 'before file' },
        { type: 'file', mediaType: 'image/png', url: 'file:///result.png' },
        { type: 'text', text: 'after file' }
      )
    },
    { messageParts: parts({ type: 'reasoning', text: 'reasoning only' }) }
  ])('rejects parts that Composer cannot write back without reordering', ({ messageParts }) => {
    expect(canEditAssistantMessageParts(messageParts)).toBe(false)
  })
})

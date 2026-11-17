import { describe, expect, it } from 'vitest'

import type { SpeechTextEvent } from '@shared/ai/voice'

import { IncrementalReadableText } from '../incrementalReadableText'
import { SpeechTextInput } from '../SpeechTextInput'

describe('stable incremental readable text', () => {
  it('commits plain sentences once and preserves an unfinished tail through replay and EOF', () => {
    const cursor = new IncrementalReadableText()
    expect(cursor.update('Hello. Next')).toBe('Hello.')
    expect(cursor.update('Hello. Next')).toBe('')
    expect(cursor.update('Hello. Next sentence.', true)).toBe('\nNext sentence.')
    expect(cursor.update('Hello. Next sentence.', true)).toBe('')
  })

  it.each([
    ['[unfinished link.', '[unfinished link.](https://example.com)', 'unfinished link.'],
    ['```ts\nconst x = 1.\n', '```ts\nconst x = 1.\n```', 'const x = 1.'],
    ['**unfinished emphasis.', '**unfinished emphasis.**', 'unfinished emphasis.']
  ])(
    'retains incomplete Markdown instead of committing a normalization that can change',
    (partial, complete, expected) => {
      const cursor = new IncrementalReadableText()
      expect(cursor.update(partial)).toBe('')
      expect(cursor.update(complete, true)).toBe(expected)
    }
  )

  it('accepts tail revisions but rejects edits to already spoken text', () => {
    const cursor = new IncrementalReadableText()
    expect(cursor.update('First. draft')).toBe('First.')
    expect(cursor.update('First. revised', true)).toBe('\nrevised')
    expect(() => cursor.update('Other. revised')).toThrow()
  })

  it('applies the total reading limit across updates', () => {
    const cursor = new IncrementalReadableText()
    cursor.update('a'.repeat(3000) + '. ')
    expect(() => cursor.update('a'.repeat(3000) + '. ' + 'b'.repeat(3000), true)).toThrow()
  })
})

describe('bounded renderer text backlog', () => {
  it('preserves unicode, text/flush order and drains the final tail', async () => {
    const source = new SpeechTextInput()
    const text = 'a'.repeat(2047) + '😀end'
    source.push(text)
    source.finish()
    const events: SpeechTextEvent[] = []
    for await (const event of source) events.push(event)
    expect(
      events
        .filter((event) => event.type === 'text')
        .map((event) => event.text)
        .join('')
    ).toBe(text)
    expect(events.at(-1)).toEqual({ type: 'flush' })
    expect(events[0]).toEqual({ type: 'text', text: 'a'.repeat(2047) })
  })

  it('counts actual Unicode-safe chunks against the event budget', async () => {
    const source = new SpeechTextInput()
    for (let i = 0; i < 30; i++) source.push('a')
    const reader = source[Symbol.asyncIterator]()
    await reader.next()
    source.push('b')
    expect(() => source.push('a'.repeat(2047) + '😀' + 'b'.repeat(2047))).toThrow(RangeError)
    source.cancel()
  })

  it('rejects excessive paused backlog and wakes a cancelled reader', async () => {
    const source = new SpeechTextInput()
    source.push('a'.repeat(5000))
    expect(() => source.push('b')).toThrow()
    source.cancel()
    const waiting = new SpeechTextInput()
    const next = waiting[Symbol.asyncIterator]().next()
    waiting.cancel()
    await expect(next).rejects.toMatchObject({ reason: 'aborted' })
  })
})

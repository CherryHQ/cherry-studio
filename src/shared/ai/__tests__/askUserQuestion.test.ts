import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { questionKeyRecord } from '../askUserQuestion'

describe('literal question keys', () => {
  const answers = questionKeyRecord(z.string())

  it.each(['__proto__', 'constructor', 'toString'])('preserves the answer for %s as an own property', (question) => {
    const parsed = answers.parse(Object.fromEntries([[question, 'Use JSON logs']]))

    expect(Object.hasOwn(parsed, question)).toBe(true)
    expect(parsed[question]).toBe('Use JSON logs')
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
  })

  it('accepts a null-prototype answer map and preserves per-question notes', () => {
    const input = Object.setPrototypeOf(Object.fromEntries([['__proto__', { notes: 'Keep context' }]]), null)
    const parsed = questionKeyRecord(z.object({ notes: z.string() })).parse(input)

    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
    expect(parsed['__proto__']).toEqual({ notes: 'Keep context' })
  })

  it.each(['Choose logger', '__proto__'])('rejects a non-string answer for %s', (question) => {
    expect(answers.safeParse(Object.fromEntries([[question, { notes: 'Not an answer' }]])).success).toBe(false)
  })

  it.each([null, [['Choose logger', 'Pino']], new Date(), new Map(), new Set()])(
    'rejects a value that is not an answer object: %j',
    (input) => {
      expect(answers.safeParse(input).success).toBe(false)
    }
  )

  it('rejects a class instance and enumerable symbol keys', () => {
    class AnswerMap {
      answer = 'Pino'
    }

    expect(answers.safeParse(new AnswerMap()).success).toBe(false)
    expect(answers.safeParse({ [Symbol('question')]: 'Pino' }).success).toBe(false)
  })
})

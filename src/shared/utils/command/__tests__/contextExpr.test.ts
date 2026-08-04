import { describe, expect, it } from 'vitest'

import {
  canContextExprsOverlap,
  collectContextKeys,
  ContextKeyService,
  evaluateContextExpr,
  parseContextExpr
} from '../contextExpr'

describe('parseContextExpr', () => {
  it('parses boolean keys and negation', () => {
    expect(parseContextExpr('chat.active')).toEqual({ type: 'key', key: 'chat.active' })
    expect(parseContextExpr('!chat.generating')).toEqual({
      type: 'not',
      expr: { type: 'key', key: 'chat.generating' }
    })
  })

  it('parses and/or with precedence', () => {
    expect(parseContextExpr('a || b && !c')).toEqual({
      type: 'or',
      exprs: [
        { type: 'key', key: 'a' },
        {
          type: 'and',
          exprs: [
            { type: 'key', key: 'b' },
            { type: 'not', expr: { type: 'key', key: 'c' } }
          ]
        }
      ]
    })
  })

  it('parses grouped expressions', () => {
    expect(parseContextExpr('(a || b) && !c')).toEqual({
      type: 'and',
      exprs: [
        {
          type: 'or',
          exprs: [
            { type: 'key', key: 'a' },
            { type: 'key', key: 'b' }
          ]
        },
        { type: 'not', expr: { type: 'key', key: 'c' } }
      ]
    })
  })

  it('parses equality and inequality', () => {
    expect(parseContextExpr("view == 'chat'")).toEqual({ type: 'equals', key: 'view', value: 'chat' })
    expect(parseContextExpr("platform != 'darwin'")).toEqual({ type: 'notEquals', key: 'platform', value: 'darwin' })
  })

  it('parses supported literal forms', () => {
    expect(parseContextExpr('count == 1.5')).toEqual({ type: 'equals', key: 'count', value: 1.5 })
    expect(parseContextExpr('enabled == true')).toEqual({ type: 'equals', key: 'enabled', value: true })
    expect(parseContextExpr('enabled != false')).toEqual({ type: 'notEquals', key: 'enabled', value: false })
    expect(parseContextExpr("view == 'chat\\'room'")).toEqual({
      type: 'equals',
      key: 'view',
      value: "chat'room"
    })
    expect(parseContextExpr('editor.mode:active == "markdown"')).toEqual({
      type: 'equals',
      key: 'editor.mode:active',
      value: 'markdown'
    })
  })

  it('rejects unsupported operators and JavaScript-like expressions', () => {
    expect(() => parseContextExpr('')).toThrow()
    expect(() => parseContextExpr('view > 1')).toThrow()
    expect(() => parseContextExpr('fn()')).toThrow()
    expect(() => parseContextExpr('!a == true')).toThrow()
    expect(() => parseContextExpr('(a || b) == true')).toThrow()
    expect(() => parseContextExpr('a b')).toThrow()
    expect(() => parseContextExpr('1abc')).toThrow()
    expect(() => parseContextExpr('"input-mode" == "chat"')).toThrow()
    expect(() => parseContextExpr('true')).toThrow()
    expect(() => parseContextExpr('@chat.active')).toThrow()
  })

  it('rejects malformed grouped expressions and literals', () => {
    expect(() => parseContextExpr('(a || b')).toThrow()
    expect(() => parseContextExpr('view ==')).toThrow()
    expect(() => parseContextExpr("view == 'chat")).toThrow()
    expect(() => parseContextExpr("view == 'chat\\")).toThrow()
    expect(() => parseContextExpr('count == 1.2.3')).toThrow()
    expect(() => parseContextExpr('view == input.value')).toThrow()
  })
})

describe('evaluateContextExpr', () => {
  it('treats an empty expression as enabled', () => {
    expect(evaluateContextExpr(undefined, {})).toBe(true)
  })

  it('evaluates boolean keys and missing keys', () => {
    expect(evaluateContextExpr(parseContextExpr('chat.active'), { 'chat.active': true })).toBe(true)
    expect(evaluateContextExpr(parseContextExpr('chat.active'), {})).toBe(false)
  })

  it('reads context values from Map and function readers', () => {
    expect(evaluateContextExpr(parseContextExpr('chat.active'), new Map([['chat.active', true]]))).toBe(true)
    expect(
      evaluateContextExpr(parseContextExpr("view == 'chat'"), (key) => (key === 'view' ? 'chat' : undefined))
    ).toBe(true)
  })

  it('uses strict equality without coercion', () => {
    expect(evaluateContextExpr(parseContextExpr('count == 1'), { count: 1 })).toBe(true)
    expect(evaluateContextExpr(parseContextExpr('count == 1'), { count: '1' })).toBe(false)
    expect(evaluateContextExpr(parseContextExpr('count != 1'), { count: '1' })).toBe(true)
    expect(evaluateContextExpr(parseContextExpr('count != 1'), { count: 1 })).toBe(false)
  })

  it('short-circuits composite expressions', () => {
    expect(evaluateContextExpr(parseContextExpr('a && !b'), { a: true, b: false })).toBe(true)
    expect(evaluateContextExpr(parseContextExpr('(a || b) && !c'), { a: false, b: true, c: false })).toBe(true)
    expect(evaluateContextExpr(parseContextExpr('(a || b) && !c'), { a: false, b: false, c: false })).toBe(false)

    const reader = (key: string) => {
      if (key === 'b') {
        throw new Error('b should not be read')
      }
      return key === 'a'
    }

    expect(evaluateContextExpr(parseContextExpr('a || b'), reader)).toBe(true)
    expect(evaluateContextExpr(parseContextExpr('!a && b'), reader)).toBe(false)
  })
})

describe('collectContextKeys', () => {
  it('returns an empty list for missing expressions', () => {
    expect(collectContextKeys(undefined)).toEqual([])
  })

  it('collects unique keys from composite expressions', () => {
    expect(collectContextKeys(parseContextExpr("(a || b) && !a && view == 'chat'"))).toEqual(['a', 'b', 'view'])
  })

  it('collects keys from direct inequality expressions', () => {
    expect(collectContextKeys(parseContextExpr("platform != 'darwin'"))).toEqual(['platform'])
  })
})

describe('canContextExprsOverlap', () => {
  it('detects mutually exclusive boolean keys', () => {
    expect(canContextExprsOverlap(parseContextExpr('chat.active'), parseContextExpr('!chat.active'))).toBe(false)
  })

  it('detects mutually exclusive equality values', () => {
    expect(canContextExprsOverlap(parseContextExpr("view == 'chat'"), parseContextExpr("view == 'notes'"))).toBe(false)
  })

  it('treats overlapping disjunctions as possible', () => {
    expect(
      canContextExprsOverlap(parseContextExpr('(chat.active || notes.active)'), parseContextExpr('chat.active'))
    ).toBe(true)
  })

  it('treats a missing expression as possibly overlapping', () => {
    expect(canContextExprsOverlap(undefined, parseContextExpr('chat.active'))).toBe(true)
  })

  it('falls back to possible overlap when expressions exceed the DNF limit', () => {
    const left = Array.from({ length: 7 }, (_, index) => `(a${index} || b${index})`).join(' && ')

    expect(canContextExprsOverlap(parseContextExpr(left), parseContextExpr('!never.active'))).toBe(true)
  })
})

describe('ContextKeyService', () => {
  it('sets, unsets, updates, evaluates, and snapshots context keys', () => {
    const service = new ContextKeyService()

    service.set('chat.active', true)
    service.update({ view: 'chat', empty: null })

    expect(service.get('chat.active')).toBe(true)
    expect(service.get('empty')).toBeNull()
    expect(service.evaluate(parseContextExpr("chat.active && view == 'chat'"))).toBe(true)
    expect(service.snapshot()).toEqual(
      new Map<string, unknown>([
        ['chat.active', true],
        ['view', 'chat'],
        ['empty', null]
      ])
    )

    service.set('chat.active', undefined)

    expect(service.get('chat.active')).toBeUndefined()
    expect(service.evaluate(parseContextExpr('chat.active'))).toBe(false)
  })
})

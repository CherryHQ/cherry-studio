import { describe, expect, it } from 'vitest'

import { classNames } from '../style'

describe('style', () => {
  describe('classNames', () => {
    it('should handle string arguments', () => {
      expect(classNames('foo', 'bar')).toBe('foo bar')
      expect(classNames('foo bar', 'baz')).toBe('foo bar baz')
      expect(classNames('foo', '')).toBe('foo')
    })

    it('should handle number arguments', () => {
      expect(classNames(1, 2)).toBe('1 2')
      expect(classNames('foo', 123)).toBe('foo 123')
    })

    it('should filter out falsy values', () => {
      expect(classNames('foo', null, 'bar')).toBe('foo bar')
      expect(classNames('foo', undefined, 'bar')).toBe('foo bar')
      expect(classNames('foo', false, 'bar')).toBe('foo bar')
      expect(classNames('foo', true, 'bar')).toBe('foo bar')
      expect(classNames('foo', 0, 'bar')).toBe('foo bar') // 数字 0 被视为假值，被过滤掉
    })

    it('should handle object arguments', () => {
      expect(classNames({ foo: true, bar: false })).toBe('foo')
      expect(classNames({ foo: true, bar: true })).toBe('foo bar')
      expect(classNames({ 'foo-bar': true })).toBe('foo-bar')
      expect(classNames({ foo: 1, bar: 0 })).toBe('foo')
      expect(classNames({ foo: {}, bar: [] })).toBe('foo bar') // non-empty objects/arrays are truthy
      expect(classNames({ foo: '', bar: null })).toBe('')
    })

    it('should handle array arguments', () => {
      expect(classNames(['foo', 'bar'])).toBe('foo bar')
      expect(classNames(['foo'], ['bar'])).toBe('foo bar')
      expect(classNames(['foo', null])).toBe('foo')
    })

    it('should handle nested arrays', () => {
      expect(classNames(['foo', ['bar', 'baz']])).toBe('foo bar baz')
      expect(classNames(['foo', ['bar', ['baz', 'qux']]])).toBe('foo bar baz qux')
    })

    it('should handle mixed argument types', () => {
      expect(classNames('foo', { bar: true, baz: false }, ['qux'])).toBe('foo bar qux')
      expect(classNames('a', ['b', { c: true, d: false }], 'e')).toBe('a b c e')
    })

    it('should handle complex combinations', () => {
      const result = classNames(
        'btn',
        {
          'btn-primary': true,
          'btn-large': false,
          'btn-disabled': null,
          'btn-active': 1
        },
        ['btn-block', ['btn-responsive', { 'btn-focus': true }]]
      )
      expect(result).toBe('btn btn-primary btn-active btn-block btn-responsive btn-focus')
    })

    it('should handle empty arguments', () => {
      expect(classNames()).toBe('')
      expect(classNames(null, undefined, false, '')).toBe('')
      expect(classNames({})).toBe('')
      expect(classNames([])).toBe('')
    })

    it('should filter out empty strings after processing', () => {
      expect(classNames({ '': true })).toBe('')
      expect(classNames([''])).toBe('')
      expect(classNames('foo', '', 'bar')).toBe('foo bar')
    })
  })
})

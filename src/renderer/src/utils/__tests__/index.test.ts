import { describe, expect, it } from 'vitest'

import { runAsyncFunction } from '../index'
import { hasPath, isFreeModel, isValidProxyUrl, removeQuotes, removeSpecialCharacters } from '../index'

describe('Unclassified Utils', () => {
  describe('runAsyncFunction', () => {
    it('should execute async function', async () => {
      // 验证异步函数被执行
      let called = false
      await runAsyncFunction(async () => {
        called = true
      })
      expect(called).toBe(true)
    })

    it('should throw error if async function fails', async () => {
      // 验证异步函数抛出错误
      await expect(
        runAsyncFunction(async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')
    })
  })

  describe('isFreeModel', () => {
    const base = { provider: '', group: '' }
    it('should return true if id or name contains "free" (case-insensitive)', () => {
      expect(isFreeModel({ id: 'free-model', name: 'test', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'FreePlan', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'notfree', ...base })).toBe(true)
      expect(isFreeModel({ id: 'model', name: 'test', ...base })).toBe(false)
    })

    it('should handle empty id or name', () => {
      expect(isFreeModel({ id: '', name: 'free', ...base })).toBe(true)
      expect(isFreeModel({ id: 'free', name: '', ...base })).toBe(true)
      expect(isFreeModel({ id: '', name: '', ...base })).toBe(false)
    })
  })

  describe('removeQuotes', () => {
    it('should remove all single and double quotes', () => {
      expect(removeQuotes('"hello"')).toBe('hello')
      expect(removeQuotes("'hello'")).toBe('hello')
      expect(removeQuotes('"hello"')).toBe('hello')
      expect(removeQuotes('noquotes')).toBe('noquotes')
    })

    it('should handle empty string', () => {
      expect(removeQuotes('')).toBe('')
    })

    it('should handle string with only quotes', () => {
      expect(removeQuotes('""')).toBe('')
      expect(removeQuotes("''")).toBe('')
    })
  })

  describe('removeSpecialCharacters', () => {
    it('should remove newlines, quotes, and special characters', () => {
      expect(removeSpecialCharacters('hello\nworld!')).toBe('helloworld')
      expect(removeSpecialCharacters('"hello, world!"')).toBe('hello world')
      expect(removeSpecialCharacters('你好，世界！')).toBe('你好世界')
    })

    it('should handle empty string', () => {
      expect(removeSpecialCharacters('')).toBe('')
    })

    it('should handle string with only special characters', () => {
      expect(removeSpecialCharacters('"\n!,.')).toBe('')
    })
  })

  describe('isValidProxyUrl', () => {
    it('should return true for string containing "://"', () => {
      expect(isValidProxyUrl('http://localhost')).toBe(true)
      expect(isValidProxyUrl('socks5://127.0.0.1:1080')).toBe(true)
    })

    it('should return false for string not containing "://"', () => {
      expect(isValidProxyUrl('localhost')).toBe(false)
      expect(isValidProxyUrl('127.0.0.1:1080')).toBe(false)
    })

    it('should handle empty string', () => {
      expect(isValidProxyUrl('')).toBe(false)
    })

    it('should return true for only "://"', () => {
      expect(isValidProxyUrl('://')).toBe(true)
    })
  })

  describe('hasPath', () => {
    it('should return true if url has path', () => {
      expect(hasPath('http://a.com/path')).toBe(true)
      expect(hasPath('http://a.com/path/to')).toBe(true)
    })

    it('should return false if url has no path or only root', () => {
      expect(hasPath('http://a.com/')).toBe(false)
      expect(hasPath('http://a.com')).toBe(false)
    })

    it('should return false for invalid url', () => {
      expect(hasPath('not a url')).toBe(false)
      expect(hasPath('')).toBe(false)
    })
  })
})

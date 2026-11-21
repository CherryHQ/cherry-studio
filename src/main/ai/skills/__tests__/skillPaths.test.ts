import { describe, expect, it } from 'vitest'

import { normalizeFolderKey, sanitizeFolderName } from '../skillPaths'

describe('skillPaths', () => {
  describe('sanitizeFolderName', () => {
    it('preserves existing ASCII folder names and replaces unsafe characters with underscores', () => {
      expect(sanitizeFolderName('find-skills')).toBe('find-skills')
      expect(sanitizeFolderName('cherry_browser_2')).toBe('cherry_browser_2')
      expect(sanitizeFolderName('my skill')).toBe('my_skill')
      expect(sanitizeFolderName('foo/bar\\baz')).toBe('foo_bar_baz')
      expect(sanitizeFolderName('../secret.skill')).toBe('___secret_skill')
      expect(sanitizeFolderName('a\0b')).toBe('ab')
    })

    it('preserves distinct non-ASCII names instead of collapsing them into underscores', () => {
      const a = sanitizeFolderName('剪口播')
      const b = sanitizeFolderName('自进化')
      const c = sanitizeFolderName('口播成片')
      expect(a).toBe('剪口播')
      expect(b).toBe('自进化')
      expect(c).toBe('口播成片')
      expect(a).not.toBe(b)
      expect(sanitizeFolderName('Huashu Design 花叔设计')).toBe('Huashu_Design_花叔设计')
      expect(sanitizeFolderName('スキル-1')).toBe('スキル-1')
      expect(sanitizeFolderName('हिंदी')).toBe('हिंदी')
    })

    it('normalizes NFD and NFC inputs to the same folder name and strips leading combining marks', () => {
      const nfd = 'Cafe\u0301'
      const nfc = 'Caf\u00e9'
      expect(sanitizeFolderName(nfd)).toBe(nfc)
      expect(sanitizeFolderName(nfc)).toBe(nfc)
      expect(sanitizeFolderName('\u0301abc')).toBe('abc')
    })

    it('returns empty for blank input and hashes distinct punctuation-only names without colliding', () => {
      expect(sanitizeFolderName('')).toBe('')
      expect(sanitizeFolderName('   ')).toBe('')
      const q = sanitizeFolderName('???')
      const s = sanitizeFolderName('***')
      expect(q).toMatch(/^skill-[0-9a-f]{8}$/)
      expect(s).toMatch(/^skill-[0-9a-f]{8}$/)
      expect(q).not.toBe(s)
    })

    it('truncates long names by Unicode code points without splitting surrogate pairs or colliding', () => {
      const base = '𠀀'.repeat(80)
      const first = sanitizeFolderName(`${base}A`)
      const second = sanitizeFolderName(`${base}B`)
      expect(Array.from(first).length).toBeLessThanOrEqual(80)
      expect(Array.from(second).length).toBeLessThanOrEqual(80)
      expect(first).toBe(first.toWellFormed())
      expect(second).toBe(second.toWellFormed())
      expect(first).not.toBe(second)
    })

    it('suffixes Windows reserved device names case-insensitively', () => {
      expect(sanitizeFolderName('con')).toBe('con-skill')
      expect(sanitizeFolderName('NUL')).toBe('NUL-skill')
      expect(sanitizeFolderName('COM1')).toBe('COM1-skill')
      expect(sanitizeFolderName('lpt9')).toBe('lpt9-skill')
      expect(sanitizeFolderName('console')).toBe('console')
    })
  })

  describe('normalizeFolderKey', () => {
    it('folds both case and Unicode composition so NFD and NFC names match', () => {
      expect(normalizeFolderKey('Cafe\u0301')).toBe(normalizeFolderKey('CAF\u00c9'))
      expect(normalizeFolderKey('剪口播')).toBe('剪口播')
    })
  })
})

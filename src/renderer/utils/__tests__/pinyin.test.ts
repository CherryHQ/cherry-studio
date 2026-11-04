import { describe, expect, it } from 'vitest'

import { matchesPinyinInitials, matchesSearchText, toPinyinForms } from '../pinyin'

describe('Chinese list search', () => {
  it.each([
    ['知识库', 'zsk', true],
    ['知识库', 'ZSK', true],
    ['知识库', 'sk', true],
    ['知识库', 'zk', false],
    ['知识库', 'zsx', false],
    ['API知识库2026', 'apizsk2026', true],
    ['API 知识库', 'api zsk', true],
    ['知-A-识库', 'zsk', false],
    ['知识 库', 'zsk', false],
    ['GPT-4o', 'g4', false],
    ['知识库', '知识', true],
    ['Cherry 知识库', 'CHERRY', true],
    ['Cherry 知识库', '知识库', true],
    ['知识库', '', true],
    ['知识库', ' ', false],
    ['知识库', '[', false]
  ])('matches %s against %s: %s', (text, query, expected) => {
    expect(matchesSearchText(text, query)).toBe(expected)
  })

  it('preserves existing settings full-pinyin and Chinese-only initials', () => {
    expect(toPinyinForms('API 网关')).toEqual({ full: 'api wangguan', initials: 'wg' })
    expect(toPinyinForms('代理')).toEqual({ full: 'daili', initials: 'dl' })
    expect(matchesPinyinInitials('代理', 'daili')).toBe(false)
    expect(matchesPinyinInitials('English', 'eng')).toBe(false)
  })
})

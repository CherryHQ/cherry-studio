import { describe, expect, it } from 'vitest'

import { createNameComparator } from '../nameOrdering'

describe('localized conversation names', () => {
  // Binary order misplaces accented letters, digraphs, Thai leading vowels and numeric suffixes.
  it.each([
    ['en-US', ['item2', 'item10', 'z']],
    ['de-DE', ['a', 'ä', 'b']],
    ['el-GR', ['α', 'ά', 'β']],
    ['es-ES', ['n', 'ñ', 'o']],
    ['fr-FR', ['e', 'é', 'f']],
    ['it-IT', ['e', 'è', 'f']],
    ['pl-PL', ['l', 'ł', 'm']],
    ['pt-PT', ['a', 'ã', 'b']],
    ['ro-RO', ['a', 'ă', 'â', 'b']],
    ['ru-RU', ['е', 'ё', 'ж']],
    ['cs-CZ', ['h', 'ch', 'i']],
    ['th-TH', ['กบ', 'เกาะ', 'ขา']],
    ['tr-TR', ['h', 'ı', 'i', 'j']],
    ['vi-VN', ['a', 'ă', 'â', 'b', 'd', 'đ', 'e']],
    ['zh-CN', ['阿', '八', '中']],
    ['zh-TW', ['一', '二', '三']],
    ['ja-JP', ['あ2', 'あ10', 'い']],
    ['ar', ['جلسة٢', 'جلسة١٠']],
    ['ko', ['가2', '가10', '나']]
  ] as const)('uses %s language rules', (locale, expected) => {
    const rows = expected.toReversed().map((name, index) => ({ id: String(index), name }))
    expect(rows.toSorted(createNameComparator(locale)).map((row) => row.name)).toEqual(expected)
    expect(rows.toSorted(createNameComparator(locale, 'desc')).map((row) => row.name)).toEqual(expected.toReversed())
  })

  it.each(['asc', 'desc'] as const)('keeps canonical and case ties in id order for %s', (direction) => {
    const rows = [
      { id: 'c', name: 'é' },
      { id: 'a', name: 'É' },
      { id: 'b', name: 'e\u0301' }
    ]
    expect(rows.toSorted(createNameComparator('fr-FR', direction)).map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('distinguishes accents and punctuation while comparing numeric values naturally', () => {
    const rows = ['é', 'item10', 'ab', 'e', 'a-b', 'item2'].map((name) => ({ id: name, name }))
    expect(rows.toSorted(createNameComparator('en-US')).map((row) => row.name)).toEqual([
      'a-b',
      'ab',
      'e',
      'é',
      'item2',
      'item10'
    ])
  })
})

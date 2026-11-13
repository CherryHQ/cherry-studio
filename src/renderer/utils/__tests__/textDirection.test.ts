import { describe, expect, it } from 'vitest'

import { textDirection } from '../textDirection'

describe('textDirection', () => {
  it('votes rtl for Arabic prose starting with a Latin word', () => {
    expect(textDirection('React هي مكتبة لبناء واجهات المستخدم')).toBe('rtl')
  })

  it('votes ltr for English prose containing an Arabic word', () => {
    expect(textDirection('The Arabic label is مرحبا, and this paragraph is English.')).toBe('ltr')
  })

  it('prefers the sentence majority when sentences disagree', () => {
    // Two Arabic sentences outweigh one English one, even though the text starts with English.
    expect(textDirection('This is English. هذه جملة عربية. هذه أيضًا جملة عربية.')).toBe('rtl')
  })

  it('breaks a tie with the first strong character', () => {
    expect(textDirection('Hello مرحبا')).toBe('ltr')
    expect(textDirection('مرحبا Hello')).toBe('rtl')
  })

  it('ignores fenced and inline code when voting', () => {
    expect(textDirection('```\nconst x = 1\n```\nهذا شرح عربي للمكتبة')).toBe('rtl')
    expect(textDirection('`React` هي مكتبة لبناء واجهات')).toBe('rtl')
  })

  it('ignores bare URLs and link targets when voting', () => {
    expect(textDirection('هذا رابط https://example.com/very/english/path للنص')).toBe('rtl')
    expect(textDirection('راجع [المستند](https://example.com/docs) للتفاصيل')).toBe('rtl')
  })

  it('returns auto without strong text', () => {
    expect(textDirection('')).toBe('auto')
    expect(textDirection('123 !!! ...')).toBe('auto')
  })
})

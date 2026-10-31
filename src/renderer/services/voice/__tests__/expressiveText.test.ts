import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  expressiveToSpeech,
  protectCodeForSpeech,
  setCustomExpressiveRules,
  setExpressiveEnabled,
  speechLanguageFromLocale
} from '../expressiveText'

describe('speechLanguageFromLocale', () => {
  it('picks Chinese for every zh locale and English otherwise', () => {
    expect(speechLanguageFromLocale('zh-CN')).toBe('zh')
    expect(speechLanguageFromLocale('zh-TW')).toBe('zh')
    expect(speechLanguageFromLocale('en-US')).toBe('en')
    expect(speechLanguageFromLocale(undefined)).toBe('en')
  })
})

beforeEach(() => {
  setExpressiveEnabled(true)
  setCustomExpressiveRules([])
})

afterEach(() => {
  setExpressiveEnabled(true)
  setCustomExpressiveRules([])
})

describe('expressiveToSpeech', () => {
  it('rewrites common emoji with the interface language', () => {
    expect(expressiveToSpeech('完成了 😄', 'zh')).toBe('完成了 [开心]')
    expect(expressiveToSpeech('done 😄', 'en')).toBe('done [happy]')
    expect(expressiveToSpeech('😭 太难了', 'zh')).toBe('[大哭] 太难了')
  })

  it('handles variation selectors and skin tones', () => {
    expect(expressiveToSpeech('❤️', 'zh')).toBe('[喜欢]')
    expect(expressiveToSpeech('👍🏽', 'zh')).toBe('[赞同]')
    expect(expressiveToSpeech('☀️', 'en')).toBe('[sunny]')
  })

  it('handles zero-width-joiner sequences as one label', () => {
    expect(expressiveToSpeech('👨‍👩‍👧', 'zh')).toBe('[一家人]')
    expect(expressiveToSpeech('🧑‍💻', 'en')).toBe('[developer]')
  })

  it('drops emoji it has no label for instead of reading them character by character', () => {
    expect(expressiveToSpeech('结果 🫥 出来了', 'zh')).toBe('结果 出来了')
  })

  it('resolves a custom rule for a whole flag sequence', () => {
    setCustomExpressiveRules([{ kind: 'emoji', match: '🇺🇸', zh: '美国', en: 'United States' }])

    expect(expressiveToSpeech('来自🇺🇸', 'zh')).toBe('来自[美国]')
    expect(expressiveToSpeech('from 🇺🇸', 'en')).toBe('from [United States]')
  })

  it('drops an unlabelled flag as one sequence instead of two halves', () => {
    expect(expressiveToSpeech('🇯🇵 好', 'zh')).toBe('好')
  })

  it('treats a keycap as one unknown emoji', () => {
    expect(expressiveToSpeech('第1️⃣名', 'zh')).toBe('第名')
  })

  it('resolves a custom keycap rule as one emoji', () => {
    setCustomExpressiveRules([{ kind: 'emoji', match: '1️⃣', zh: '一', en: 'one' }])

    expect(expressiveToSpeech('第1️⃣名', 'zh')).toBe('第[一]名')
  })

  it('consumes a tag-sequence flag as one emoji', () => {
    expect(expressiveToSpeech('\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F} 好', 'zh')).toBe('好')
  })

  it('rewrites common kaomoji', () => {
    expect(expressiveToSpeech('太好了 (＾▽＾)', 'zh')).toBe('太好了 [开心]')
    expect(expressiveToSpeech('好难过 (T_T)', 'zh')).toBe('好难过 [难过]')
    expect(expressiveToSpeech('(╯°□°)╯︵ ┻━┻', 'zh')).toBe('[掀桌]')
    expect(expressiveToSpeech('¯\\_(ツ)_/¯', 'en')).toBe('[shrug]')
  })

  it('leaves ordinary parentheses and text alone', () => {
    expect(expressiveToSpeech('计算 (a+b) 的值', 'zh')).toBe('计算 (a+b) 的值')
    expect(expressiveToSpeech('调用 f(x) 即可', 'zh')).toBe('调用 f(x) 即可')
    expect(expressiveToSpeech('版本 1.2.3', 'zh')).toBe('版本 1.2.3')
  })

  it('keeps text symbols that only look like emoji', () => {
    expect(expressiveToSpeech('版权 © 2026，商标 ™', 'zh')).toBe('版权 © 2026，商标 ™')
  })

  it('collapses the gaps left behind and trims the result', () => {
    expect(expressiveToSpeech('  😄  好的  ', 'zh')).toBe('[开心] 好的')
    expect(expressiveToSpeech('😀😀', 'zh')).toBe('[高兴][高兴]')
  })

  it('uses a custom rule before the built-in table', () => {
    setCustomExpressiveRules([{ kind: 'emoji', match: '🫥', zh: '躲藏', en: 'hiding' }])

    expect(expressiveToSpeech('🫥', 'zh')).toBe('[躲藏]')
    expect(expressiveToSpeech('🫥', 'en')).toBe('[hiding]')
  })

  it('matches custom kaomoji literally and prefers the longer one', () => {
    setCustomExpressiveRules([
      { kind: 'kaomoji', match: '(o_o)', zh: '发呆', en: 'dazed' },
      { kind: 'kaomoji', match: '(o_o)?', zh: '疑惑', en: 'confused' }
    ])

    expect(expressiveToSpeech('(o_o)?', 'zh')).toBe('[疑惑]')
    expect(expressiveToSpeech('(o_o)', 'zh')).toBe('[发呆]')
  })

  it('leaves the text untouched when the switch is off', () => {
    setExpressiveEnabled(false)

    expect(expressiveToSpeech('完成了 😄 (＾▽＾)', 'zh')).toBe('完成了 😄 (＾▽＾)')
  })

  it('leaves protected code spans verbatim', () => {
    expect(expressiveToSpeech(`Use ${protectCodeForSpeech('😄')} now`, 'en')).toBe('Use 😄 now')
    expect(expressiveToSpeech(`完成${protectCodeForSpeech('(T_T)')}后`, 'zh')).toBe('完成(T_T)后')
    expect(expressiveToSpeech(`a ${protectCodeForSpeech('😄')} b`, 'zh')).toBe('a 😄 b')
  })

  it('still strips code markers when the switch is off', () => {
    setExpressiveEnabled(false)

    expect(expressiveToSpeech(`Use ${protectCodeForSpeech('😄')} now`, 'en')).toBe('Use 😄 now')
  })
})

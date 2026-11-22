import dayjs from 'dayjs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setDayjsLocale } from '../resolver'

describe('date locale selection', () => {
  let originalLocale: string

  beforeEach(() => {
    originalLocale = dayjs.locale()
  })

  afterEach(() => {
    dayjs.locale(originalLocale)
  })

  it('selects the requested supported locale', () => {
    setDayjsLocale('zh-CN')
    expect(dayjs.locale()).toBe('zh-cn')

    setDayjsLocale('en-US')
    expect(dayjs.locale()).toBe('en')
  })

  it.each(['en-GB', 'constructor', 'toString', '__proto__'])('falls back to English for %s', (language) => {
    setDayjsLocale('zh-CN')

    setDayjsLocale(language)

    expect(dayjs.locale()).toBe('en')
  })
})

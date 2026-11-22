import { describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { getWeekdayLabel } from '../scheduleForm'

describe('weekday label fallback', () => {
  it.each(['7', 'constructor', 'toString', '__proto__'])('retains the unsupported weekday %s', (weekday) => {
    expect(getWeekdayLabel(weekday, i18n.t)).toBe(weekday)
  })
})

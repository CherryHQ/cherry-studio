import { afterEach, describe, expect, it, vi } from 'vitest'

import { getLocaleFirstDayOfWeek } from '@renderer/utils/time'

import { buildHeatmapDays } from '../UsageHeatmap'

afterEach(() => {
  vi.useRealTimers()
})

describe('buildHeatmapDays', () => {
  it('keeps a one-year grid while marking only the selected range as active', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 27, 12))

    const range = {
      from: new Date(2026, 5, 28).getTime(),
      to: new Date(2026, 6, 27, 23, 59, 59, 999).getTime()
    }
    const days = buildHeatmapDays([], range, getLocaleFirstDayOfWeek('en-US'))

    expect(days).toHaveLength(53 * 7)
    expect(days.filter((day) => !day.isOutsideRange)).toHaveLength(30)
    expect(days[0].date.getDay()).toBe(0)
    expect(days.at(-1)?.date.getDay()).toBe(6)

    const mondayFirstDays = buildHeatmapDays([], range, getLocaleFirstDayOfWeek('zh-CN'))
    expect(mondayFirstDays[0].date.getDay()).toBe(1)
    expect(mondayFirstDays.at(-1)?.date.getDay()).toBe(0)
  })
})

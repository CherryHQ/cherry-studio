import { describe, expect, it } from 'vitest'

import type { ChartTheme } from '../../useChartTheme'
import { buildPieChart } from '../buildPieChart'

const THEME: ChartTheme = {
  background: '#background',
  border: '#border',
  colors: ['#chart-1'],
  foregroundTertiary: '#foreground-tertiary',
  muted: '#muted',
  mutedForeground: '#muted-foreground',
  popover: '#popover',
  popoverForeground: '#popover-foreground'
}

describe('buildPieChart', () => {
  it('uses the native timeline to switch between period distributions', () => {
    const frames = [
      { label: 'Jul 27', data: [{ name: 'Model A', value: 10 }] },
      { label: 'Jul 28', data: [{ name: 'Model A', value: 20 }] }
    ]
    const option = buildPieChart(
      {
        data: frames[1].data,
        option: { legend: {} },
        timeline: { currentIndex: 1, frames }
      },
      false,
      THEME
    )

    expect(option).toMatchObject({
      baseOption: {
        legend: { bottom: 46, left: 'center' },
        timeline: {
          axisType: 'category',
          autoPlay: false,
          currentIndex: 1,
          data: ['Jul 27', 'Jul 28']
        },
        series: [{ id: 'distribution', type: 'pie', data: frames[1].data }]
      },
      options: [
        { series: [{ id: 'distribution', type: 'pie', data: frames[0].data }] },
        { series: [{ id: 'distribution', type: 'pie', data: frames[1].data }] }
      ]
    })
  })
})

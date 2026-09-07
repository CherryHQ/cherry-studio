import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChartTheme } from '../useChartTheme'

const THEME_TOKENS = [
  '--background',
  '--border',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--foreground-tertiary',
  '--muted',
  '--muted-foreground',
  '--popover',
  '--popover-foreground'
] as const

function setThemeTokens(red: number) {
  for (const [index, token] of THEME_TOKENS.entries()) {
    document.documentElement.style.setProperty(token, `rgba(${red + index}, 20, 30, 1)`)
  }
}

function createCanvasContext(): CanvasRenderingContext2D {
  let fillStyle = ''

  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    get fillStyle() {
      return fillStyle
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      fillStyle = String(value)
    },
    getImageData: vi.fn(() => {
      const channels = fillStyle.match(/[\d.]+/g)?.map(Number)
      if (!channels || channels.length < 3) throw new Error(`Unexpected test color: ${fillStyle}`)
      return { data: new Uint8ClampedArray([channels[0], channels[1], channels[2], 255]) } as unknown as ImageData
    })
  } as unknown as CanvasRenderingContext2D
}

describe('useChartTheme', () => {
  beforeEach(() => {
    setThemeTokens(10)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createCanvasContext())
  })

  afterEach(() => {
    cleanup()
    for (const token of THEME_TOKENS) {
      document.documentElement.style.removeProperty(token)
    }
    vi.restoreAllMocks()
  })

  it('refreshes resolved canvas colors after root theme tokens change', async () => {
    const { result } = renderHook(() => useChartTheme())

    expect(result.current.background).toBe('rgba(10, 20, 30, 1)')
    expect(result.current.colors[0]).toBe('rgba(12, 20, 30, 1)')

    act(() => setThemeTokens(100))

    await waitFor(() => {
      expect(result.current.background).toBe('rgba(100, 20, 30, 1)')
      expect(result.current.colors[0]).toBe('rgba(102, 20, 30, 1)')
    })
  })
})

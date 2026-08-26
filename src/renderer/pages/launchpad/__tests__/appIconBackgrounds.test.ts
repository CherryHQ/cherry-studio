import type { SidebarAppId } from '@renderer/utils/sidebar'
import { describe, expect, it } from 'vitest'

import {
  APP_ICON_MESH_STOPS_DARK,
  APP_ICON_MESH_STOPS_LIGHT,
  hexContrastRatio,
  LAUNCHPAD_ICON_GRAIN,
  LAUNCHPAD_ICON_INK,
  MIN_LAUNCHPAD_ICON_CONTRAST
} from '../appIconBackgrounds'

describe('hexContrastRatio', () => {
  it('matches WCAG relative-luminance contrast for known pairs', () => {
    expect(hexContrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5)
    expect(hexContrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5)
    // Independent mid-tone oracle: WebAIM Contrast Checker reports #777777 vs #FFFFFF as 4.48:1.
    expect(hexContrastRatio('#FFFFFF', '#777777')).toBeCloseTo(4.48, 2)
  })

  it('rejects the previous lime-400 core and accepts lime-600', () => {
    expect(hexContrastRatio(LAUNCHPAD_ICON_INK, '#A3E635')).toBeLessThan(MIN_LAUNCHPAD_ICON_CONTRAST)
    expect(hexContrastRatio(LAUNCHPAD_ICON_INK, '#65A30D')).toBeGreaterThanOrEqual(MIN_LAUNCHPAD_ICON_CONTRAST)
  })
})

describe('launchpad mesh palettes', () => {
  it('keeps white glyphs at least 3:1 on every light and dark mesh stop', () => {
    const palettes = [
      ['light', APP_ICON_MESH_STOPS_LIGHT],
      ['dark', APP_ICON_MESH_STOPS_DARK]
    ] as const

    for (const [theme, stops] of palettes) {
      for (const [id, triple] of Object.entries(stops) as [SidebarAppId, readonly [string, string, string]][]) {
        triple.forEach((hex, index) => {
          expect(
            hexContrastRatio(LAUNCHPAD_ICON_INK, hex),
            `${theme}/${id} stop ${index} (${hex})`
          ).toBeGreaterThanOrEqual(MIN_LAUNCHPAD_ICON_CONTRAST)
        })
      }
    }
  })

  it('keeps a distinct core hue per app so tiles stay scannable', () => {
    const lightCores = Object.values(APP_ICON_MESH_STOPS_LIGHT).map((stops) => stops[1])
    const darkCores = Object.values(APP_ICON_MESH_STOPS_DARK).map((stops) => stops[1])

    expect(new Set(lightCores).size).toBe(lightCores.length)
    expect(new Set(darkCores).size).toBe(darkCores.length)
  })

  it('uses a different mesh per theme so light and dark tiles stay distinct', () => {
    for (const id of Object.keys(APP_ICON_MESH_STOPS_LIGHT) as SidebarAppId[]) {
      expect(APP_ICON_MESH_STOPS_LIGHT[id], id).not.toEqual(APP_ICON_MESH_STOPS_DARK[id])
    }
  })

  it('encodes grayscale turbulence grain for the tile overlay', () => {
    expect(LAUNCHPAD_ICON_GRAIN).toContain('feTurbulence')
    expect(LAUNCHPAD_ICON_GRAIN).toContain("values='0'")
  })
})

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { generateIconWebpAssets, resolveActiveLogoDirs, resolveIconTypes, STATIC_ICON_SIZE } from '../icons-generate'

describe('resolveIconTypes', () => {
  it('generates every icon group when no type is requested', () => {
    expect(resolveIconTypes(null)).toEqual(['icons', 'providers', 'models'])
  })

  it('generates only the requested icon group', () => {
    expect(resolveIconTypes('providers')).toEqual(['providers'])
  })
})

describe('resolveActiveLogoDirs', () => {
  it('preserves the hand-written OpenCode provider alongside generated providers', () => {
    expect(resolveActiveLogoDirs('providers', ['openai'])).toEqual(new Set(['openai', 'opencode']))
  })
})

describe('generateIconWebpAssets', () => {
  it('exports fixed-size light and dark WebPs for a theme-aware source', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'cherry-ui-webp-'))
    const source =
      '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="currentColor"/></svg>'

    try {
      const result = await generateIconWebpAssets(source, null, outputDir)
      const lightPath = join(outputDir, 'light.webp')
      const darkPath = join(outputDir, 'dark.webp')

      expect(result).toEqual({ hasDark: true, size: STATIC_ICON_SIZE })
      expect(existsSync(lightPath)).toBe(true)
      expect(existsSync(darkPath)).toBe(true)

      const [light, dark] = await Promise.all([sharp(lightPath).metadata(), sharp(darkPath).metadata()])
      expect(light).toMatchObject({ format: 'webp', width: STATIC_ICON_SIZE, height: STATIC_ICON_SIZE })
      expect(dark).toMatchObject({ format: 'webp', width: STATIC_ICON_SIZE, height: STATIC_ICON_SIZE })

      const [lightPixel, darkPixel] = await Promise.all([
        sharp(lightPath).raw().toBuffer(),
        sharp(darkPath).raw().toBuffer()
      ])
      expect([...lightPixel.subarray(0, 3)]).toEqual([0, 0, 0])
      expect([...darkPixel.subarray(0, 3)]).toEqual([255, 255, 255])
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})

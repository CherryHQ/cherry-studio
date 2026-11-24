import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { extractColorPrimary, resolveActiveLogoDirs, resolveIconTypes } from '../icons-generate'
import { detectHasBackground, resolveIconComponentModule } from '../icons-generate-avatars'

describe('resolveIconTypes', () => {
  it('generates only the requested icon group', () => {
    expect(resolveIconTypes('providers')).toEqual(['providers'])
  })
})

describe('resolveActiveLogoDirs', () => {
  it('preserves the hand-written OpenCode provider alongside generated providers', () => {
    expect(resolveActiveLogoDirs('providers', ['openai'])).toEqual(new Set(['openai', 'opencode']))
  })
})

describe('resolveIconComponentModule', () => {
  it('uses named modules for new icons while preserving legacy index.tsx modules', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'cherry-ui-icons-'))
    const newIconDir = join(baseDir, 'new-icon')
    const legacyIconDir = join(baseDir, 'legacy-icon')
    mkdirSync(newIconDir)
    mkdirSync(legacyIconDir)
    writeFileSync(join(legacyIconDir, 'index.tsx'), '')

    try {
      expect(resolveIconComponentModule(baseDir, 'new-icon')).toEqual({
        outPath: join(newIconDir, 'new-icon.tsx'),
        modulePath: './new-icon/new-icon'
      })
      expect(resolveIconComponentModule(baseDir, 'legacy-icon')).toEqual({
        outPath: join(legacyIconDir, 'index.tsx'),
        modulePath: undefined
      })
    } finally {
      rmSync(baseDir, { recursive: true, force: true })
    }
  })
})

// A raster mark on a full-canvas background must not be enlarged as an inset logo.
describe('detectHasBackground', () => {
  it.each(['#FFFFFF', '#4D6BFE'])('preserves the %s tile behind an embedded image', (fill) => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-icon-background-'))
    const file = join(dir, 'icon.svg')
    try {
      writeFileSync(
        file,
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="${fill}"/><image x="18" y="18" width="84" height="84" href="data:image/png;base64,AA=="/></svg>`
      )
      expect(detectHasBackground(file)).toBe(true)
      writeFileSync(
        file,
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><image x="18" y="18" width="84" height="84" href="data:image/png;base64,AA=="/></svg>'
      )
      expect(detectHasBackground(file)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('extractColorPrimary', () => {
  it('keeps presentation background variables out of brand-color metadata', () => {
    const svg = '<svg><rect fill="var(--icon-neutral-background, #FFFFFF)"/><path fill="#4285F4"/></svg>'
    expect(extractColorPrimary(svg)).toBe('#4285F4')
  })
})

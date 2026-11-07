import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateLogoDirDual, resolveActiveLogoDirs, resolveIconTypes } from '../icons-generate'
import { resolveIconComponentModule } from '../icons-generate-avatars'

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

describe('generateLogoDirDual artwork metadata', () => {
  it('carries a full-canvas source declaration into regenerated asset metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cherry-ui-artwork-'))
    const source = join(dir, 'source.svg')
    writeFileSync(
      source,
      '<svg xmlns="http://www.w3.org/2000/svg" data-artwork-kind="full-canvas" viewBox="0 0 32 32"><path d="M0 0h32v32H0z"/></svg>'
    )
    try {
      await generateLogoDirDual({ light: source, dark: null }, dir, 'example', 'Example')
      expect(readFileSync(join(dir, 'example', 'meta.ts'), 'utf8')).toContain("artworkKind: 'full-canvas'")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

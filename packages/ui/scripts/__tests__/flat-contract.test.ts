import { describe, expect, it } from 'vitest'

import { buildFlatContractCss } from '../build-theme-css'

describe('buildFlatContractCss', () => {
  it('inlines every @import', async () => {
    const css = await buildFlatContractCss()
    expect(css).not.toMatch(/@import/)
  })

  it('carries no Tailwind compile-time directives', async () => {
    const css = await buildFlatContractCss()
    expect(css).not.toMatch(/@theme\b/)
    expect(css).not.toMatch(/@apply\b/)
  })

  it('exposes the public semantic variables', async () => {
    const css = await buildFlatContractCss()
    expect(css).toContain('--background')
    expect(css).toContain('--foreground')
  })

  it('mirrors every .dark block under prefers-color-scheme so guests without the class still switch', async () => {
    // The bug this guards: a builder that only emits `.dark { … }` class blocks, which
    // nothing in a mini app document ever applies.
    const css = await buildFlatContractCss()
    const declarations = (body: string) => new Set(body.match(/--[a-z0-9-]+:[^;]*;/g))
    const mirrored = [
      ...css.matchAll(
        /^\.dark \{\n([\s\S]*?)^\}\n\n@media \(prefers-color-scheme: dark\) \{\n {2}:root \{\n([\s\S]*?)^ {2}\}\n\}\n/gm
      )
    ]
    expect(mirrored.length).toBeGreaterThan(0)
    expect(mirrored.length).toBe(css.match(/^\.dark \{/gm)?.length)
    for (const [, classBody, mediaBody] of mirrored) {
      expect(declarations(classBody).size).toBeGreaterThan(0)
      expect(declarations(mediaBody)).toEqual(declarations(classBody))
    }
  })
})

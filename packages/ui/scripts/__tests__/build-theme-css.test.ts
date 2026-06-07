import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildThemeContractCss, loadThemeContractInputs } from '../build-theme-css'

describe('buildThemeContractCss', () => {
  it('maps token sources into the public theme contract', async () => {
    const stylesDir = path.resolve(import.meta.dirname, '../../src/styles')
    const css = buildThemeContractCss(await loadThemeContractInputs(stylesDir))

    expect(css).toContain("@import './tokens.css';")
    expect(css).toContain('/* Runtime Theme Inputs */')
    expect(css).toContain('--cs-theme-primary: var(--cs-primary);')
    expect(css).toContain('--cs-theme-ring: color-mix(in srgb, var(--cs-theme-primary) 40%, transparent);')
    expect(css).not.toContain('--cs-user-font-family:')
    expect(css).not.toContain('--cs-user-code-font-family:')
    expect(css).toContain('/* Compatibility Aliases */')
    expect(css).toContain('--primary: var(--color-primary);')
    expect(css).toContain('--ring: var(--color-ring);')
    expect(css).toContain('--color-neutral-50: var(--cs-neutral-50);')
    expect(css).toContain('--color-brand-500: var(--cs-brand-500);')
    expect(css).toContain('/* Semantic Colors */')
    expect(css).toContain('--color-primary: var(--cs-theme-primary);')
    expect(css).toContain('--color-ring: var(--cs-theme-ring);')
    expect(css).not.toContain('--color-ring: var(--cs-ring);')
    expect(css).toContain('--color-destructive: var(--cs-destructive);')
    expect(css).toContain('--color-error-base: var(--cs-error-base);')
    expect(css).toContain('--radius-md: var(--cs-radius-md);')
    expect(css).toContain('--font-size-body-md: var(--cs-font-size-body-md);')
    // Body scale overrides the built-in text-xs/sm/base/lg with the design line-height
    expect(css).toContain('--text-xs: var(--cs-font-size-body-xs);')
    expect(css).toContain('--text-xs--line-height: var(--cs-line-height-body-xs);')
    expect(css).toContain('--text-sm: var(--cs-font-size-body-sm);')
    // Headings get semantic text-heading-* names (not the built-in text-xl/2xl/5xl)
    expect(css).toContain('--text-heading-md: var(--cs-font-size-heading-md);')
    expect(css).toContain('--text-heading-md--line-height: var(--cs-line-height-heading-md);')
    expect(css).not.toContain('--text-body-sm:')
    // heading-2xl has no line-height token -> font-size only, no pairing
    expect(css).toContain('--text-heading-2xl: var(--cs-font-size-heading-2xl);')
    expect(css).not.toContain('--text-heading-2xl--line-height:')
    expect(css).not.toContain('.dark {')
  })
})

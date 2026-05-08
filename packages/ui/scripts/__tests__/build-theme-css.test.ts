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
    expect(css).not.toContain('.dark {')
  })
})

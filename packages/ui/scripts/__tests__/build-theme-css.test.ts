import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildThemeContractCss,
  CHERRY_PRODUCT_COLOR_TOKENS,
  loadThemeContractInputs,
  SHADCN_COLOR_TOKENS
} from '../build-theme-css'

describe('buildThemeContractCss', () => {
  it('maps token sources into the public theme contract', async () => {
    const stylesDir = path.resolve(import.meta.dirname, '../../src/styles')
    const css = buildThemeContractCss(await loadThemeContractInputs(stylesDir))

    expect(css).toContain("@import './contract.css';")
    expect(css).not.toContain("@import './tokens.css';")
    expect(css).not.toContain("@import './shadcn.css';")
    expect(css).toContain('@theme inline {')
    expect(css).not.toContain('/* Runtime Theme Inputs */')
    expect(css).not.toContain('--cs-theme-primary:')
    expect(css).not.toContain('--cs-theme-ring:')
    expect(css).not.toContain('--cs-user-font-family:')
    expect(css).not.toContain('--cs-user-code-font-family:')
    expect(css).not.toContain('--primary: var(--color-primary);')
    expect(css).not.toContain('--ring: var(--color-ring);')
    expect(css).toContain('--color-neutral-50: var(--cs-neutral-50);')
    expect(css).toContain('--color-brand-500: var(--cs-brand-500);')
    expect(css).toContain('/* Canonical Shadcn Colors */')
    expect(css).toContain('/* Cherry Studio Product Colors */')
    expect(css).toContain('--color-background: var(--background);')
    expect(css).toContain('--color-primary: var(--primary);')
    expect(css).toContain('--color-muted-foreground: var(--muted-foreground);')
    expect(css).toContain('--color-chart-5: var(--chart-5);')
    expect(css).toContain('--color-sidebar-ring: var(--sidebar-ring);')
    expect(css).toContain('--color-success-subtle: var(--cs-success-subtle);')
    expect(css).toContain('--color-error-border: var(--cs-error-border);')
    expect(css).toContain('--color-ring: var(--ring);')
    expect(css).not.toContain('--color-primary: var(--cs-theme-primary);')
    expect(css).not.toContain('--color-ring: var(--cs-ring);')
    expect(css).toContain('--color-destructive: var(--destructive);')
    expect(css).toContain('--color-primary-hover: var(--cs-primary-hover);')
    expect(css).toContain('--color-error-base: var(--cs-error-base);')
    expect(css).toContain('--radius-md: calc(var(--radius) - 0.125rem);')
    expect(css).toContain('--radius-lg: var(--radius);')
    expect(css).toContain('--radius-full: var(--cs-radius-round);')
    expect(css).toContain('--radius-round: var(--cs-radius-round);')
    expect(css).toContain('--font-size-body-md: var(--cs-font-size-body-md);')
    expect(css).toContain('--animate-checkbox-bounce: checkbox-bounce 300ms cubic-bezier(0.4, 0, 0.2, 1);')
    expect(css).toContain('--animate-checkbox-icon-in: checkbox-icon-in 160ms ease-out both;')
    expect(css).toContain('@keyframes checkbox-bounce {')
    expect(css).toContain('@keyframes checkbox-icon-in {')
    expect(css).not.toContain('.dark {')

    for (const token of SHADCN_COLOR_TOKENS) {
      expect(css).toContain(`--color-${token}: var(--${token});`)
    }

    for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
      expect(css).toContain(`--color-${token}: var(--cs-${token});`)
    }
  })
})

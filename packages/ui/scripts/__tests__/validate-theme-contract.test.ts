import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  loadThemeContractSources,
  type ThemeContractSources,
  validateThemeContractSources
} from '../validate-theme-contract'

const STYLES_DIR = path.resolve(import.meta.dirname, '../../src/styles')

async function loadSources(): Promise<ThemeContractSources> {
  return loadThemeContractSources(STYLES_DIR)
}

describe('validateThemeContractSources', () => {
  it('accepts the authored variable graph', async () => {
    const sources = await loadSources()

    expect(() => validateThemeContractSources(sources)).not.toThrow()
  })

  it('rejects cross-layer duplicate ownership', async () => {
    const sources = await loadSources()
    sources.product += '\n:root { --cs-background: hotpink; }\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/--cs-background is defined twice/)
  })

  it('rejects an upward dependency from the foundation layer', async () => {
    const sources = await loadSources()
    sources.semanticColors = sources.semanticColors.replace(
      '--cs-primary: var(--cs-brand-500);',
      '--cs-primary: var(--background);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(/foundation --cs-primary cannot depend/)
  })

  it('rejects variable cycles in a supported mode', async () => {
    const sources = await loadSources()
    sources.product = sources.product
      .replace('--cs-text-primary: var(--foreground);', '--cs-text-primary: var(--cs-text-secondary);')
      .replace('--cs-text-secondary: var(--cs-foreground-secondary);', '--cs-text-secondary: var(--cs-text-primary);')

    expect(() => validateThemeContractSources(sources)).toThrow(/light variable cycle/)
  })

  it('rejects a stable product role that depends on migration-only behavior', async () => {
    const sources = await loadSources()
    sources.product = sources.product.replace(
      '--cs-chat-user-foreground: var(--foreground);',
      '--cs-chat-user-foreground: var(--cs-text-primary);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(/stable product .* cannot depend on migration-only/)
  })

  it('rejects an ambiguous semantic entry order', async () => {
    const sources = await loadSources()
    sources.contractEntry = sources.contractEntry.replace(
      "@import './shadcn.css';\n@import './product.css';",
      "@import './product.css';\n@import './shadcn.css';"
    )

    expect(() => validateThemeContractSources(sources)).toThrow(/contract.css imports must be exactly/)
  })
})

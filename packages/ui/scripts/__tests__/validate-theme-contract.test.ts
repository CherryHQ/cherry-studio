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

  it('rejects an unregistered runtime input', async () => {
    const sources = await loadSources()
    sources.themeInput += '\n:root {\n  --cs-theme-speculative: hotpink;\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/declares unregistered runtime input/)
  })

  it('rejects a runtime input declared by the foundation layer', async () => {
    const sources = await loadSources()
    sources.primitiveColors += '\n:root {\n  --cs-theme-speculative: hotpink;\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/foundation cannot declare runtime input/)
  })

  it('rejects an upper-layer dependency from a runtime input', async () => {
    const sources = await loadSources()
    sources.themeInput = sources.themeInput.replace('var(--cs-primary)', 'var(--primary)')

    expect(() => validateThemeContractSources(sources)).toThrow(/runtime input .* cannot depend on upper-layer/)
  })

  it('requires official variables to be owned by shadcn.css', async () => {
    const sources = await loadSources()
    sources.shadcn = sources.shadcn.replace('  --background: var(--cs-background);\n', '')
    sources.primitiveColors += '\n:root {\n  --background: var(--cs-background);\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/Shadcn contract in shadcn.css is missing/)
  })

  it('requires product variables to be owned by approved product sources', async () => {
    const sources = await loadSources()
    sources.product = sources.product.replace('  --cs-chat-user: rgba(0, 0, 0, 0.045);\n', '')
    sources.primitiveColors += '\n:root {\n  --cs-chat-user: rgba(0, 0, 0, 0.045);\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/product contract in approved sources is missing/)
  })

  it('rejects unregistered variables in shadcn.css', async () => {
    const sources = await loadSources()
    sources.shadcn += '\n:root {\n  --success: hotpink;\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/declares unregistered Shadcn variable --success/)
  })

  it('rejects variable cycles in a supported mode', async () => {
    const sources = await loadSources()
    sources.product = sources.product
      .replace('--cs-inline-code: rgba(0, 0, 0, 0.06);', '--cs-inline-code: var(--cs-inline-code-foreground);')
      .replace('--cs-inline-code-foreground: rgb(218, 97, 92);', '--cs-inline-code-foreground: var(--cs-inline-code);')

    expect(() => validateThemeContractSources(sources)).toThrow(/light variable cycle/)
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

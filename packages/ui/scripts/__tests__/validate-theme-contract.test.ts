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

  it('pairs the runtime primary with an adaptive foreground and an independent ring', async () => {
    const sources = await loadSources()

    expect(sources.themeInput).toContain('--cs-theme-primary-foreground: var(--cs-primary-foreground);')
    expect(sources.shadcn).toContain('--primary-foreground: var(--cs-theme-primary-foreground);')
    expect(sources.shadcn).toContain('--ring: var(--cs-ring);')
    expect(sources.shadcn).not.toContain('--ring: color-mix(in srgb, var(--primary)')
  })

  it('rejects cross-layer duplicate ownership', async () => {
    const sources = await loadSources()
    sources.product += '\n:root { --cs-background: hotpink; }\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/--cs-background is defined twice/)
  })

  it('rejects an upward dependency from the foundation layer', async () => {
    const sources = await loadSources()
    sources.providerColors = sources.providerColors.replace(
      '--cs-primary: var(--cs-brand-500);',
      '--cs-primary: var(--background);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(/foundation --cs-primary cannot depend/)
  })

  it('rejects a product dependency from the foundation layer', async () => {
    const sources = await loadSources()
    sources.providerColors = sources.providerColors.replace(
      '--cs-primary: var(--cs-brand-500);',
      '--cs-primary: var(--success);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(/foundation --cs-primary cannot depend/)
  })

  it('rejects an unregistered runtime input', async () => {
    const sources = await loadSources()
    sources.themeInput += '\n:root {\n  --cs-theme-speculative: hotpink;\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/declares unregistered runtime input/)
  })

  it('rejects custom property names outside the contract convention', async () => {
    const sources = await loadSources()
    sources.product += '\n:root {\n  --sidebarWidth: 1px;\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(
      /product\.css declares invalid custom property --sidebarWidth/
    )
  })

  it('resolves references with whitespace after var opening', async () => {
    const sources = await loadSources()
    sources.providerColors = sources.providerColors.replace(
      '--cs-primary: var(--cs-brand-500);',
      '--cs-primary: var( --cs-missing-primary);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(
      /light --cs-primary .* references undefined --cs-missing-primary/
    )
  })

  it('rejects invalid referenced custom property names', async () => {
    const sources = await loadSources()
    sources.product = sources.product.replace(
      '--highlight-foreground: var(--foreground);',
      '--highlight-foreground: var(--foregroundMuted);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(
      /product\.css references invalid custom property --foregroundMuted/
    )
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

  it('requires product variables to be owned by product.css', async () => {
    const sources = await loadSources()
    sources.product = sources.product.replace('  --chat-user: rgba(0, 0, 0, 0.045);\n', '')
    sources.primitiveColors += '\n:root {\n  --chat-user: rgba(0, 0, 0, 0.045);\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/product contract in product.css is missing/)
  })

  it('rejects unregistered variables in shadcn.css', async () => {
    const sources = await loadSources()
    sources.shadcn += '\n:root {\n  --success: hotpink;\n}\n'

    expect(() => validateThemeContractSources(sources)).toThrow(/declares unregistered Shadcn variable --success/)
  })

  it('rejects variable cycles in a supported mode', async () => {
    const sources = await loadSources()
    sources.product = sources.product
      .replace('--inline-code: rgba(0, 0, 0, 0.06);', '--inline-code: var(--inline-code-foreground);')
      .replace('--inline-code-foreground: rgb(218, 97, 92);', '--inline-code-foreground: var(--inline-code);')

    expect(() => validateThemeContractSources(sources)).toThrow(/light variable cycle/)
  })

  it('rejects unresolved references introduced by a dark override', async () => {
    const sources = await loadSources()
    sources.providerColors = sources.providerColors.replace(
      '--cs-background: oklch(0.209 0 0 / 0.55);',
      '--cs-background: var( --cs-missing-dark-background);'
    )

    expect(() => validateThemeContractSources(sources)).toThrow(
      /dark --cs-background .* references undefined --cs-missing-dark-background/
    )
  })

  it('rejects variable cycles introduced by dark overrides', async () => {
    const sources = await loadSources()
    sources.product = sources.product
      .replace('--code-block: #323232;', '--code-block: var(--inline-code);')
      .replace('--inline-code: #323232;', '--inline-code: var(--code-block);')

    expect(() => validateThemeContractSources(sources)).toThrow(/dark variable cycle/)
  })

  it('rejects an ambiguous semantic entry order', async () => {
    const sources = await loadSources()
    sources.contractEntry = sources.contractEntry.replace(
      "@import './shadcn.css';\n@import './product.css';",
      "@import './product.css';\n@import './shadcn.css';"
    )

    expect(() => validateThemeContractSources(sources)).toThrow(/contract.css imports must be exactly/)
  })

  it('rejects extra token imports written with url syntax', async () => {
    const sources = await loadSources()
    sources.tokensIndex += "\n@import url('./colors/escape.css');\n"

    expect(() => validateThemeContractSources(sources)).toThrow(/tokens\/index\.css imports must be exactly/)
  })
})

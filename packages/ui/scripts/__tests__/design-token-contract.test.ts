import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CHERRY_PRODUCT_COLOR_TOKENS,
  CHERRY_PRODUCT_VARIABLE_TOKENS,
  RUNTIME_THEME_INPUT_TOKENS,
  SHADCN_COLOR_TOKENS,
  SHADCN_VARIABLE_TOKENS
} from '../theme-contract'

const STYLES_DIR = path.resolve(import.meta.dirname, '../../src/styles')
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..')
const MIGRATION_STRATEGIES = new Set(['exact', 'contextual', 'review', 'preserve'])

interface MigrationRule {
  source: string
  target: string | null
  strategy: string
}

interface MigrationRegistry {
  version: number
  contract: string
  exclude: string[]
  rules: MigrationRule[]
}

describe('design token contract', () => {
  it('keeps every product variable stable and Tailwind exposure explicit', () => {
    const productTokens = new Set<string>(CHERRY_PRODUCT_VARIABLE_TOKENS)

    expect(productTokens.size).toBe(CHERRY_PRODUCT_VARIABLE_TOKENS.length)

    for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
      expect(productTokens.has(token)).toBe(true)
    }
  })

  it('documents every runtime input and public variable in the operational catalog', async () => {
    const catalog = await fs.readFile(path.resolve(STYLES_DIR, '../../docs/variable-catalog.md'), 'utf8')

    for (const token of RUNTIME_THEME_INPUT_TOKENS) {
      expect(catalog).toContain(`\`--cs-theme-${token}\``)
    }
    for (const token of SHADCN_VARIABLE_TOKENS) {
      expect(catalog).toContain(`\`--${token}\``)
    }
    for (const token of CHERRY_PRODUCT_VARIABLE_TOKENS) {
      expect(catalog).toContain(`\`--cs-${token}\``)
    }
  })

  it('separates official Shadcn colors from Cherry Studio product colors', async () => {
    const [themeInputSource, shadcnSource, semanticSource, statusSource, productSource] = await Promise.all([
      fs.readFile(path.join(STYLES_DIR, 'theme-input.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'shadcn.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'tokens/colors/semantic.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'tokens/colors/status.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'product.css'), 'utf8')
    ])
    const productContractSource = `${semanticSource}\n${statusSource}\n${productSource}`

    for (const token of RUNTIME_THEME_INPUT_TOKENS) {
      expect(themeInputSource).toMatch(new RegExp(`^\\s*--cs-theme-${token}:`, 'm'))
      expect(shadcnSource).not.toMatch(new RegExp(`^\\s*--cs-theme-${token}:`, 'm'))
    }

    for (const token of SHADCN_COLOR_TOKENS) {
      expect(shadcnSource).toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
    }

    for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
      expect(productContractSource).toMatch(new RegExp(`^\\s*--cs-${token}:`, 'm'))
      expect(shadcnSource).not.toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
    }

    for (const token of CHERRY_PRODUCT_VARIABLE_TOKENS) {
      expect(productContractSource).toMatch(new RegExp(`^\\s*--cs-${token}:`, 'm'))
    }

    expect(shadcnSource).not.toContain('var(--color-')
    expect(shadcnSource).not.toContain('var(--app-')
  })

  it('keeps the migration registry deterministic and machine-readable', async () => {
    const source = await fs.readFile(path.join(STYLES_DIR, 'migrations/shadcn-v2.json'), 'utf8')
    const registry = JSON.parse(source) as MigrationRegistry
    const canonicalVariableNames = new Set<string>([
      ...SHADCN_VARIABLE_TOKENS.map((token) => `--${token}`),
      ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--cs-${token}`)
    ])
    const sourceNames = registry.rules.map((rule) => rule.source)

    expect(registry.version).toBe(1)
    expect(registry.contract).toBe('shadcn-v2')
    expect(registry.exclude).toContain('packages/ui/src/styles/theme.css')
    expect(registry.exclude).toContain('packages/ui/src/styles/theme-input.css')
    expect(registry.exclude).toContain('packages/ui/src/styles/product.css')
    expect(registry.exclude).toContain('src/renderer/assets/styles/legacy-vars.css')
    expect(registry.exclude).toContain('src/renderer/assets/styles/tailwind.css')
    expect(new Set(sourceNames).size).toBe(sourceNames.length)

    for (const rule of registry.rules) {
      expect(rule.source).toMatch(/^--[a-z0-9-]+$/)
      expect(MIGRATION_STRATEGIES.has(rule.strategy)).toBe(true)

      if (rule.strategy === 'exact') {
        expect(rule.target).not.toBeNull()
      }

      if (rule.target) {
        expect(rule.target).toMatch(/^--[a-z0-9-]+$/)
        expect(canonicalVariableNames.has(rule.target)).toBe(true)
      }
    }
  })

  it('keeps compatibility bridges out of the renderer theme entry', async () => {
    const legacyPath = path.join(REPOSITORY_ROOT, 'src/renderer/assets/styles/legacy-vars.css')
    const rendererThemeSource = await fs.readFile(
      path.join(REPOSITORY_ROOT, 'src/renderer/assets/styles/tailwind.css'),
      'utf8'
    )

    await expect(fs.readFile(legacyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(rendererThemeSource).not.toContain("@import './legacy-vars.css'")
    expect(rendererThemeSource).not.toContain('--app-')
  })
})

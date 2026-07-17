import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHERRY_PRODUCT_COLOR_TOKENS, SHADCN_COLOR_TOKENS } from '../build-theme-css'

const STYLES_DIR = path.resolve(import.meta.dirname, '../../src/styles')
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
  it('separates official Shadcn colors from Cherry Studio product colors', async () => {
    const [shadcnSource, semanticSource, statusSource] = await Promise.all([
      fs.readFile(path.join(STYLES_DIR, 'shadcn.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'tokens/colors/semantic.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'tokens/colors/status.css'), 'utf8')
    ])
    const productSource = `${semanticSource}\n${statusSource}`

    for (const token of SHADCN_COLOR_TOKENS) {
      expect(shadcnSource).toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
    }

    for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
      expect(productSource).toMatch(new RegExp(`^\\s*--cs-${token}:`, 'm'))
      expect(shadcnSource).not.toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
    }

    expect(shadcnSource).not.toContain('var(--color-')
    expect(shadcnSource).not.toContain('var(--app-')
  })

  it('keeps the migration registry deterministic and machine-readable', async () => {
    const source = await fs.readFile(path.join(STYLES_DIR, 'migrations/shadcn-v2.json'), 'utf8')
    const registry = JSON.parse(source) as MigrationRegistry
    const canonicalVariableNames = new Set<string>([
      ...SHADCN_COLOR_TOKENS.map((token) => `--${token}`),
      ...CHERRY_PRODUCT_COLOR_TOKENS.map((token) => `--cs-${token}`)
    ])
    const sourceNames = registry.rules.map((rule) => rule.source)

    expect(registry.version).toBe(1)
    expect(registry.contract).toBe('shadcn-v2')
    expect(registry.exclude).toContain('packages/ui/src/styles/theme.css')
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
})

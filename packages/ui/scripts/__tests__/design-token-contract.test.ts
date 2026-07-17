import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CANONICAL_COLOR_TOKENS } from '../build-theme-css'

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
  it('defines every canonical color without depending on adapter or app variables', async () => {
    const source = await fs.readFile(path.join(STYLES_DIR, 'shadcn.css'), 'utf8')

    for (const token of CANONICAL_COLOR_TOKENS) {
      expect(source).toMatch(new RegExp(`^\\s*--${token}:`, 'm'))
    }

    expect(source).not.toContain('var(--color-')
    expect(source).not.toContain('var(--app-')
  })

  it('keeps the migration registry deterministic and machine-readable', async () => {
    const source = await fs.readFile(path.join(STYLES_DIR, 'migrations/shadcn-v2.json'), 'utf8')
    const registry = JSON.parse(source) as MigrationRegistry
    const canonicalTokenNames = new Set<string>(CANONICAL_COLOR_TOKENS)
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
        expect(canonicalTokenNames.has(rule.target.slice(2))).toBe(true)
      }
    }
  })
})

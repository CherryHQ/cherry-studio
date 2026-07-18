import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS,
  CHERRY_PRODUCT_COLOR_TOKENS,
  CHERRY_PRODUCT_VARIABLE_TOKENS,
  CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS,
  SHADCN_COLOR_TOKENS
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

interface VariableDeclaration {
  name: string
  value: string
}

function extractVariableDeclarations(source: string, include: (name: string) => boolean): VariableDeclaration[] {
  return [...source.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)]
    .map((match) => ({ name: match[1], value: match[2].trim() }))
    .filter(({ name }) => include(name))
}

function expectCompatibilityAliases(
  declarations: VariableDeclaration[],
  canonicalVariableNames: Set<string>,
  registry: MigrationRegistry
): void {
  expect(declarations.length).toBeGreaterThan(0)

  for (const declaration of declarations) {
    const aliasMatch = declaration.value.match(/^var\((--[a-z0-9-]+)\)$/)

    expect(aliasMatch, `${declaration.name} must be a single canonical var() alias`).not.toBeNull()
    if (!aliasMatch) continue

    const target = aliasMatch[1]
    expect(canonicalVariableNames.has(target), `${declaration.name} points outside the canonical contract`).toBe(true)
    expect(registry.rules).toContainEqual({ source: declaration.name, target, strategy: 'exact' })
  }
}

describe('design token contract', () => {
  it('classifies every product variable by stability and Tailwind exposure', () => {
    const stableTokens = new Set<string>(CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS)
    const migrationTokens = new Set<string>(CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS)
    const productTokens = new Set<string>(CHERRY_PRODUCT_VARIABLE_TOKENS)

    expect(stableTokens.size).toBe(CHERRY_STABLE_PRODUCT_VARIABLE_TOKENS.length)
    expect(migrationTokens.size).toBe(CHERRY_MIGRATION_PRODUCT_VARIABLE_TOKENS.length)
    expect(productTokens.size).toBe(CHERRY_PRODUCT_VARIABLE_TOKENS.length)
    expect([...stableTokens].filter((token) => migrationTokens.has(token))).toEqual([])
    expect(productTokens).toEqual(new Set([...stableTokens, ...migrationTokens]))

    for (const token of CHERRY_PRODUCT_COLOR_TOKENS) {
      expect(productTokens.has(token)).toBe(true)
    }
  })

  it('separates official Shadcn colors from Cherry Studio product colors', async () => {
    const [shadcnSource, semanticSource, statusSource, productSource] = await Promise.all([
      fs.readFile(path.join(STYLES_DIR, 'shadcn.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'tokens/colors/semantic.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'tokens/colors/status.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'product.css'), 'utf8')
    ])
    const productContractSource = `${semanticSource}\n${statusSource}\n${productSource}`

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
      ...SHADCN_COLOR_TOKENS.map((token) => `--${token}`),
      ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--cs-${token}`)
    ])
    const sourceNames = registry.rules.map((rule) => rule.source)

    expect(registry.version).toBe(1)
    expect(registry.contract).toBe('shadcn-v2')
    expect(registry.exclude).toContain('packages/ui/src/styles/theme.css')
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

  it('keeps renderer compatibility layers as canonical aliases only', async () => {
    const [legacySource, rendererThemeSource, registrySource] = await Promise.all([
      fs.readFile(path.join(REPOSITORY_ROOT, 'src/renderer/assets/styles/legacy-vars.css'), 'utf8'),
      fs.readFile(path.join(REPOSITORY_ROOT, 'src/renderer/assets/styles/tailwind.css'), 'utf8'),
      fs.readFile(path.join(STYLES_DIR, 'migrations/shadcn-v2.json'), 'utf8')
    ])
    const registry = JSON.parse(registrySource) as MigrationRegistry
    const canonicalVariableNames = new Set<string>([
      ...SHADCN_COLOR_TOKENS.map((token) => `--${token}`),
      ...CHERRY_PRODUCT_VARIABLE_TOKENS.map((token) => `--cs-${token}`)
    ])
    const legacyDeclarations = extractVariableDeclarations(legacySource, () => true)
    const appDeclarations = extractVariableDeclarations(rendererThemeSource, (name) => name.startsWith('--app-'))

    expectCompatibilityAliases(legacyDeclarations, canonicalVariableNames, registry)
    expectCompatibilityAliases(appDeclarations, canonicalVariableNames, registry)
    expect(legacySource).not.toMatch(/^\s*\.dark\s*{/m)
  })
})

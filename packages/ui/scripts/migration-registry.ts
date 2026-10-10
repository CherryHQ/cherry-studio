const VARIABLE_NAME_PATTERN = /^--[a-z0-9-]+$/
const MIGRATION_STRATEGIES = ['exact', 'contextual', 'review', 'preserve'] as const

export type MigrationStrategy = (typeof MIGRATION_STRATEGIES)[number]

export interface MigrationRule {
  source: string
  target: string | null
  strategy: MigrationStrategy
}

export interface MigrationRegistry {
  version: number
  contract: string
  defaultKind: string
  exclude: string[]
  rules: MigrationRule[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMigrationStrategy(value: string): value is MigrationStrategy {
  return MIGRATION_STRATEGIES.some((strategy) => strategy === value)
}

export function parseMigrationRegistry(source: string): MigrationRegistry {
  let parsed: unknown

  try {
    parsed = JSON.parse(source) as unknown
  } catch (error) {
    throw new Error('[theme-contract] migration registry is not valid JSON', { cause: error })
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.exclude) || !Array.isArray(parsed.rules)) {
    throw new Error('[theme-contract] migration registry has an invalid top-level shape')
  }
  if (!parsed.exclude.every((entry) => typeof entry === 'string')) {
    throw new Error('[theme-contract] migration registry exclude entries must be strings')
  }
  if (
    typeof parsed.version !== 'number' ||
    typeof parsed.contract !== 'string' ||
    typeof parsed.defaultKind !== 'string'
  ) {
    throw new Error('[theme-contract] migration registry metadata is invalid')
  }

  const sources = new Set<string>()
  const rules = parsed.rules.map((entry, index): MigrationRule => {
    if (
      !isRecord(entry) ||
      typeof entry.source !== 'string' ||
      (entry.target !== null && typeof entry.target !== 'string') ||
      typeof entry.strategy !== 'string'
    ) {
      throw new Error(`[theme-contract] migration rule ${index} has an invalid shape`)
    }
    if (!VARIABLE_NAME_PATTERN.test(entry.source)) {
      throw new Error(`[theme-contract] invalid migration source ${entry.source}`)
    }
    if (sources.has(entry.source)) {
      throw new Error(`[theme-contract] duplicate migration source ${entry.source}`)
    }
    if (!isMigrationStrategy(entry.strategy)) {
      throw new Error(`[theme-contract] ${entry.source} uses unknown migration strategy ${entry.strategy}`)
    }
    if (entry.strategy === 'exact' && !entry.target) {
      throw new Error(`[theme-contract] exact migration ${entry.source} requires a target`)
    }
    if (entry.target && !VARIABLE_NAME_PATTERN.test(entry.target)) {
      throw new Error(`[theme-contract] invalid migration target ${entry.target}`)
    }
    if (entry.target === entry.source) {
      throw new Error(`[theme-contract] migration ${entry.source} cannot target itself`)
    }

    sources.add(entry.source)
    return {
      source: entry.source,
      target: entry.target,
      strategy: entry.strategy
    }
  })

  return {
    version: parsed.version,
    contract: parsed.contract,
    defaultKind: parsed.defaultKind,
    exclude: parsed.exclude,
    rules
  }
}

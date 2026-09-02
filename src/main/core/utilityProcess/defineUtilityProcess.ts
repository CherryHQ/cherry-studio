import type { UtilityProcessContract, UtilityProcessDefinition } from './types'

const ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/
const ENTRY_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const CANCELLATIONS: ReadonlySet<string> = new Set(['terminate', 'cooperative'])

/** Throws a TypeError naming the first invalid field; shared by `defineUtilityProcess` and manifest installation. */
export function validateUtilityProcessDefinition(definition: UtilityProcessDefinition<any, any>): void {
  if (typeof definition.id !== 'string' || !ID_PATTERN.test(definition.id)) {
    throw new TypeError(
      `utility process id must be a lowercase namespaced identifier like 'domain.name', got ${JSON.stringify(definition.id)}`
    )
  }
  if (typeof definition.entry !== 'string' || !ENTRY_PATTERN.test(definition.entry)) {
    throw new TypeError(
      `utility process '${definition.id}': entry must be a lowercase kebab-case build key, got ${JSON.stringify(definition.entry)}`
    )
  }
  if (!CANCELLATIONS.has(definition.cancellation)) {
    throw new TypeError(
      `utility process '${definition.id}': cancellation must be 'terminate' or 'cooperative', got ${JSON.stringify(definition.cancellation)}`
    )
  }
  if (definition.idleTimeoutMs !== undefined) {
    if (!Number.isInteger(definition.idleTimeoutMs) || definition.idleTimeoutMs <= 0) {
      throw new TypeError(
        `utility process '${definition.id}': idleTimeoutMs must be a positive integer, got ${JSON.stringify(definition.idleTimeoutMs)}`
      )
    }
  }
  if (definition.createEnv !== undefined && typeof definition.createEnv !== 'function') {
    throw new TypeError(`utility process '${definition.id}': createEnv must be a function`)
  }
  if (definition.createInitData !== undefined && typeof definition.createInitData !== 'function') {
    throw new TypeError(`utility process '${definition.id}': createInitData must be a function`)
  }
}

/** Builds a frozen, validated definition. Object identity is the registration key. */
export function defineUtilityProcess<Contract extends UtilityProcessContract, InitData = void>(
  definition: Omit<UtilityProcessDefinition<Contract, InitData>, '__contract'>
): UtilityProcessDefinition<Contract, InitData> {
  validateUtilityProcessDefinition(definition)
  return Object.freeze({ ...definition })
}

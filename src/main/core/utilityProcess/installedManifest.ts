import { validateUtilityProcessDefinition } from './defineUtilityProcess'
import type { UtilityProcessDefinition, UtilityProcessManifest } from './types'

let installed: ReadonlyMap<string, UtilityProcessDefinition<any, any>> | null = null

/**
 * Installs the closed production manifest exactly once, before `application.registerAll()`.
 * `UtilityProcessManager.client()` only accepts definition objects present here.
 */
export function installUtilityProcessManifest(manifest: UtilityProcessManifest): void {
  if (installed !== null) {
    throw new Error('utility process manifest is already installed; it must be installed exactly once at boot')
  }
  const byId = new Map<string, UtilityProcessDefinition<any, any>>()
  for (const definition of manifest) {
    validateUtilityProcessDefinition(definition)
    if (byId.has(definition.id)) {
      throw new Error(`utility process manifest declares id '${definition.id}' more than once`)
    }
    byId.set(definition.id, definition)
  }
  installed = byId
}

export function getInstalledUtilityProcessManifest(): ReadonlyMap<string, UtilityProcessDefinition<any, any>> {
  if (installed === null) {
    throw new Error(
      'utility process manifest is not installed; call installUtilityProcessManifest() in main.ts before application.registerAll()'
    )
  }
  return installed
}

/** Test-only: clears the slot so each test can install its own manifest. */
export function __resetInstalledUtilityProcessManifestForTesting(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__resetInstalledUtilityProcessManifestForTesting is only available under NODE_ENV=test')
  }
  installed = null
}

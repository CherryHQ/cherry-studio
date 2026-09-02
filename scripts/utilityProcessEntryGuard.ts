/**
 * Build-time backstop for the child-safe zone: eslint only sees direct imports, so a
 * main-only singleton could still reach a utility-process entry through a chain of
 * innocent modules. Used by the production entries build and the smoke harness alike.
 */

const FORBIDDEN = [
  /src[\\/]main[\\/]core[\\/](logger|application|lifecycle|paths)[\\/]/,
  /src[\\/]main[\\/](data|ipc)[\\/]/,
  /utilityProcess[\\/]host[\\/]/,
  /utilityProcess[\\/]UtilityProcessManager\./
]

export function hermeticEntryGuardPlugin() {
  return {
    name: 'utility-process-hermetic-entry-guard',
    load(id: string) {
      const match = FORBIDDEN.find((pattern) => pattern.test(id))
      if (match !== undefined) {
        throw new Error(`utility-process entry graph must not include main-only module: ${id}`)
      }
      return null
    }
  }
}

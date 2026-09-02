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

interface EmittedChunk {
  type: string
  fileName: string
  isEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
}

export function hermeticEntryGuardPlugin() {
  return {
    name: 'utility-process-hermetic-entry-guard',
    load(id: string) {
      const match = FORBIDDEN.find((pattern) => pattern.test(id))
      if (match !== undefined) {
        throw new Error(`utility-process entry graph must not include main-only module: ${id}`)
      }
      return null
    },
    generateBundle(_options: unknown, bundle: Record<string, EmittedChunk>) {
      const entries = new Set(
        Object.values(bundle)
          .filter((chunk) => chunk.type === 'chunk' && chunk.isEntry)
          .map((chunk) => chunk.fileName)
      )
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        // electron-builder resolves `node_modules` against the real dependency tree and
        // drops everything else under that name, so a chunk emitted there (what
        // `preserveModules` does to bundled devDependencies) is missing from the packaged
        // app and the child dies with MODULE_NOT_FOUND on first spawn.
        if (/(^|\/)node_modules\//.test(chunk.fileName)) {
          throw new Error(`utility-process chunk must not be emitted under node_modules/: ${chunk.fileName}`)
        }
        for (const imported of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
          // Requiring another entry would run its `serveUtilityProcess()` in this process.
          if (entries.has(imported) && imported !== chunk.fileName) {
            throw new Error(`utility-process entry ${chunk.fileName} must not import another entry: ${imported}`)
          }
        }
      }
    }
  }
}

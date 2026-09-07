import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { REGISTRY_SCHEMA_VERSION } from '../src/registry-loader'

interface CompatibilityCheckOptions {
  compatDirectory?: string
  dataDirectory?: string
  schemaVersion?: number
}

interface FrozenValidator {
  schemaVersion: number
  validateCatalogDirectory: (dataDirectory: string) => void
}

const scriptPath = fileURLToPath(import.meta.url)
const packageRoot = path.resolve(path.dirname(scriptPath), '..')

export async function checkCatalogCompatibility(options: CompatibilityCheckOptions = {}): Promise<void> {
  const schemaVersion = options.schemaVersion ?? REGISTRY_SCHEMA_VERSION
  const compatDirectory = options.compatDirectory ?? path.join(packageRoot, 'compat')
  const dataDirectory = options.dataDirectory ?? path.join(packageRoot, 'data')
  const validatorPath = path.join(compatDirectory, `v${schemaVersion}-validator.mjs`)

  if (!existsSync(validatorPath)) {
    throw new Error(
      `Missing frozen compatibility validator compat/v${schemaVersion}-validator.mjs. ` +
        'Run pnpm --filter @cherrystudio/provider-registry compat:baseline after reviewing the version bump.'
    )
  }

  const validator = (await import(pathToFileURL(validatorPath).href)) as FrozenValidator
  if (validator.schemaVersion !== schemaVersion) {
    throw new Error(
      `Frozen validator ${path.basename(validatorPath)} reports schema version ${validator.schemaVersion}`
    )
  }
  validator.validateCatalogDirectory(dataDirectory)
}

const isCommandLine = process.argv[1] && path.resolve(process.argv[1]) === scriptPath
if (isCommandLine) {
  void checkCatalogCompatibility()
    .then(() => console.log(`Catalog is compatible with frozen registry schema v${REGISTRY_SCHEMA_VERSION}`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
}

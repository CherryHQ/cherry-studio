import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGISTRY_FILES, REGISTRY_SCHEMA_VERSION, type RegistryFileName } from '../src/registry-loader'
import { ModelListSchema } from '../src/schemas/model'
import { ProviderListSchema } from '../src/schemas/provider'
import { ProviderModelListSchema } from '../src/schemas/provider-models'

const SCHEMAS = {
  'models.json': ModelListSchema,
  'providers.json': ProviderListSchema,
  'provider-models.json': ProviderModelListSchema
} as const

export const schemaVersion = REGISTRY_SCHEMA_VERSION

function formatValidationError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    return JSON.stringify(error.issues)
  }
  return error instanceof Error ? error.message : String(error)
}

export function validateCatalogFile(file: RegistryFileName, data: unknown): void {
  SCHEMAS[file].parse(data)
}

export function validateCatalogDirectory(dataDirectory: string): void {
  for (const file of REGISTRY_FILES) {
    try {
      validateCatalogFile(file, JSON.parse(readFileSync(path.join(dataDirectory, file), 'utf8')))
    } catch (error) {
      throw new Error(
        `${file} is not compatible with registry schema v${schemaVersion}: ${formatValidationError(error)}`
      )
    }
  }
}

const isCommandLine = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCommandLine) {
  const dataDirectory = process.argv[2]
  if (!dataDirectory) {
    console.error('Usage: node vN-validator.mjs <catalog-data-directory>')
    process.exitCode = 1
  } else {
    try {
      validateCatalogDirectory(path.resolve(dataDirectory))
      console.log(`Catalog is compatible with frozen registry schema v${schemaVersion}`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}

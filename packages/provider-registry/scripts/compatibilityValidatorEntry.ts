import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as z from 'zod'

import { REGISTRY_SCHEMA_VERSION, type RegistryFileName } from '../src/registry-loader'
import { ModelConfigSchema, ModelListSchema } from '../src/schemas/model'
import { ProviderListSchema } from '../src/schemas/provider'
import { ProviderModelListSchema, ProviderModelOverrideSchema } from '../src/schemas/provider-models'
import { validateProviderImageCapabilities } from '../src/utils/imageCapabilities'

const SCHEMAS = {
  // Validate image declarations before forward-compatible parsing can drop invalid rows.
  'models.json': ModelListSchema.extend({
    models: z.array(ModelConfigSchema.pick({ imageGeneration: true }).loose())
  }).transform((catalog) => ModelListSchema.parse(catalog)),
  'providers.json': ProviderListSchema,
  'provider-models.json': ProviderModelListSchema.extend({
    overrides: z.array(ProviderModelOverrideSchema.pick({ imageGeneration: true }).loose())
  }).transform((catalog) => ProviderModelListSchema.parse(catalog))
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
  function readCatalogFile<T>(file: RegistryFileName, schema: z.ZodType<T>): T {
    try {
      return schema.parse(JSON.parse(readFileSync(path.join(dataDirectory, file), 'utf8')))
    } catch (error) {
      throw new Error(
        `${file} is not compatible with registry schema v${schemaVersion}: ${formatValidationError(error)}`
      )
    }
  }
  const { models } = readCatalogFile('models.json', SCHEMAS['models.json'])
  readCatalogFile('providers.json', SCHEMAS['providers.json'])
  const { overrides } = readCatalogFile('provider-models.json', SCHEMAS['provider-models.json'])
  validateProviderImageCapabilities(models, overrides)
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

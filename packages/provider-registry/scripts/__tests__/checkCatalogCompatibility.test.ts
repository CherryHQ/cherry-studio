import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { ModelListSchema } from '../../src/schemas/model'
import { ProviderModelListSchema } from '../../src/schemas/provider-models'
import { checkCatalogCompatibility } from '../checkCatalogCompatibility'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryDirectories: string[] = []

function copyCatalog(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'provider-registry-compat-'))
  temporaryDirectories.push(directory)
  cpSync(path.join(packageRoot, 'data'), directory, { recursive: true })
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('provider-registry wire compatibility', () => {
  it('accepts the committed catalog with the frozen current-version validator', async () => {
    await expect(checkCatalogCompatibility()).resolves.toBeUndefined()
  })

  it('does not publish the v2 image vocabulary to v1 clients', async () => {
    await expect(checkCatalogCompatibility({ schemaVersion: 1 })).rejects.toThrow('models.json')
  })

  it('rejects catalog data that the frozen validator cannot parse', async () => {
    const dataDirectory = copyCatalog()
    const modelsPath = path.join(dataDirectory, 'models.json')
    const models = JSON.parse(readFileSync(modelsPath, 'utf8'))
    models.models[0].capabilities.push('future-incompatible-capability')
    writeFileSync(modelsPath, JSON.stringify(models))

    await expect(checkCatalogCompatibility({ dataDirectory })).rejects.toThrow('models.json')
  })

  it('rejects impossible composed inputs in a creator declaration before publication', async () => {
    const dataDirectory = copyCatalog()
    const modelsPath = path.join(dataDirectory, 'models.json')
    const models = ModelListSchema.parse(JSON.parse(readFileSync(modelsPath, 'utf8')))
    const support = models.models.find((model) => model.imageGeneration)?.imageGeneration
    if (!support) throw new Error('Missing catalog image capability')
    support.inputs.images = { min: 0, max: { kind: 'known', value: 3 } }
    support.withImages = { inputs: { images: { min: 2 } } }
    support.operations = { generate: { inputs: { images: { max: { kind: 'known', value: 1 } } } } }
    writeFileSync(modelsPath, JSON.stringify(models))

    await expect(checkCatalogCompatibility({ dataDirectory })).rejects.toThrow('minimum image count exceeds maximum')
  })

  it('rejects an invalid creator/provider combination even when each file is valid alone', async () => {
    const dataDirectory = copyCatalog()
    const modelsPath = path.join(dataDirectory, 'models.json')
    const overridesPath = path.join(dataDirectory, 'provider-models.json')
    const models = ModelListSchema.parse(JSON.parse(readFileSync(modelsPath, 'utf8')))
    const providerModels = ProviderModelListSchema.parse(JSON.parse(readFileSync(overridesPath, 'utf8')))
    const override = providerModels.overrides.find((row) =>
      models.models.some((model) => model.id === row.modelId && model.imageGeneration)
    )
    if (!override) throw new Error('Missing provider override for a catalog image model')
    const support = models.models.find((model) => model.id === override.modelId)?.imageGeneration
    if (!support) throw new Error('Missing creator image capability')
    support.inputs.images = { min: 0, max: { kind: 'known', value: 3 } }
    support.withImages = { inputs: { images: { min: 2 } } }
    delete support.operations
    override.imageGeneration = {
      operations: { generate: { inputs: { images: { max: { kind: 'known', value: 1 } } } } }
    }
    writeFileSync(modelsPath, JSON.stringify(ModelListSchema.parse(models)))
    writeFileSync(overridesPath, JSON.stringify(ProviderModelListSchema.parse(providerModels)))

    await expect(checkCatalogCompatibility({ dataDirectory })).rejects.toThrow(
      `Invalid image capability for ${override.providerId}/${override.modelId}`
    )
  })

  it('fails closed when the current schema version has no frozen validator', async () => {
    const compatDirectory = mkdtempSync(path.join(tmpdir(), 'provider-registry-baseline-'))
    temporaryDirectories.push(compatDirectory)

    await expect(checkCatalogCompatibility({ compatDirectory })).rejects.toThrow(
      'Missing frozen compatibility validator'
    )
  })
})

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

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

  it('rejects catalog data that the frozen validator cannot parse', async () => {
    const dataDirectory = copyCatalog()
    const modelsPath = path.join(dataDirectory, 'models.json')
    const models = JSON.parse(readFileSync(modelsPath, 'utf8'))
    models.models[0].capabilities.push('future-incompatible-capability')
    writeFileSync(modelsPath, JSON.stringify(models))

    await expect(checkCatalogCompatibility({ dataDirectory })).rejects.toThrow('models.json')
  })

  it('fails closed when the current schema version has no frozen validator', async () => {
    const compatDirectory = mkdtempSync(path.join(tmpdir(), 'provider-registry-baseline-'))
    temporaryDirectories.push(compatDirectory)

    await expect(checkCatalogCompatibility({ compatDirectory })).rejects.toThrow(
      'Missing frozen compatibility validator'
    )
  })
})

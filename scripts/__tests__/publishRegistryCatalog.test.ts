import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { publishRegistryCatalog } from '../publishRegistryCatalog'

const COMPAT_DIRECTORY = path.resolve(__dirname, '../../packages/provider-registry/compat')

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function makeDirectories() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-publish-'))
  temporaryDirectories.push(root)
  const sourceDirectory = path.join(root, 'data')
  const destinationDirectory = path.join(root, 'pub')
  fs.mkdirSync(sourceDirectory)
  fs.mkdirSync(destinationDirectory)
  return { sourceDirectory, destinationDirectory }
}

/** A v1-shaped override carrying `ultra`, the effort v1's frozen enum does not know. */
function writeCatalog(sourceDirectory: string, override: Record<string, unknown>) {
  fs.writeFileSync(path.join(sourceDirectory, 'models.json'), JSON.stringify({ version: 'm1', models: [] }))
  fs.writeFileSync(path.join(sourceDirectory, 'providers.json'), JSON.stringify({ version: 'p1', providers: [] }))
  fs.writeFileSync(
    path.join(sourceDirectory, 'provider-models.json'),
    JSON.stringify({ version: 'pm1', overrides: [override] })
  )
}

const OVERRIDE_WITH_UNKNOWN_EFFORT = {
  providerId: 'openai-codex',
  modelId: 'gpt-6-astra',
  reasoningContracts: {
    'openai-responses': {
      support: { controls: [{ default: 'low', kind: 'effort', values: ['low', 'max', 'ultra'] }], defaultEffort: 'low' }
    }
  }
}

const publishOptions = {
  compatDirectory: COMPAT_DIRECTORY,
  currentVersion: 2,
  minAppVersion: '2.0.13',
  sourceAppVersion: '2.0.12',
  revision: 41
}

describe('publishRegistryCatalog', () => {
  it('keeps a model reaching an older schema by dropping only what it cannot represent', async () => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)

    const published = await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory })

    expect(published).toEqual(['v1', 'v2'])
    const v1 = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v1/provider-models.json'), 'utf8'))
    expect(v1.overrides).toHaveLength(1)
    expect(v1.overrides[0].reasoningContracts['openai-responses'].support.controls[0].values).toEqual(['low', 'max'])

    const { validateCatalogFile } = await import(path.join(COMPAT_DIRECTORY, 'v1-validator.mjs'))
    expect(() => validateCatalogFile('provider-models.json', v1)).not.toThrow()
  })

  it('publishes the current version untouched', async () => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)

    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory })

    const v2 = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v2/provider-models.json'), 'utf8'))
    expect(v2.overrides[0].reasoningContracts['openai-responses'].support.controls[0].values).toEqual([
      'low',
      'max',
      'ultra'
    ])
  })

  it('leaves an older dir untouched when its break cannot be dropped', async () => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)
    fs.writeFileSync(path.join(sourceDirectory, 'models.json'), JSON.stringify({ version: 'm1', models: 'retyped' }))
    fs.mkdirSync(path.join(destinationDirectory, 'v1'))
    fs.writeFileSync(path.join(destinationDirectory, 'v1/models.json'), 'previous snapshot')

    const published = await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory })

    expect(published).toEqual(['v2'])
    expect(fs.readFileSync(path.join(destinationDirectory, 'v1/models.json'), 'utf8')).toBe('previous snapshot')
  })

  it('keeps an older stream on the semantic floor it was published with', async () => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)
    fs.mkdirSync(path.join(destinationDirectory, 'v1'))
    fs.writeFileSync(
      path.join(destinationDirectory, 'v1/manifest.json'),
      JSON.stringify({ minAppVersion: '2.0.9', sourceAppVersion: '2.0.12', revision: 35, schemaVersion: 1, files: {} })
    )

    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory })

    const v1 = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v1/manifest.json'), 'utf8'))
    const v2 = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v2/manifest.json'), 'utf8'))
    expect(v1).toMatchObject({ minAppVersion: '2.0.9', schemaVersion: 1, revision: 41 })
    expect(v2).toMatchObject({ minAppVersion: '2.0.13', schemaVersion: 2 })
    expect(v1.files).toEqual({ 'models.json': 'm1', 'providers.json': 'p1', 'provider-models.json': 'pm1' })
  })
})

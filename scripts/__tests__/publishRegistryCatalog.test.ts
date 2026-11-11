import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { stampAndSerialize } from '../../packages/provider-registry/scripts/catalogSerialization.mjs'
import { REGISTRY_MIN_APP_VERSION, REGISTRY_SCHEMA_VERSION } from '../../packages/provider-registry/src/registry-loader'
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

// Legacy validators discard parse results; expose the actual reader in a temporary copy.
// The immutable shipped bundle and its schema implementation remain unchanged.
async function readFrozenCatalog(version: number) {
  const baselinePath = path.join(COMPAT_DIRECTORY, `v${version}-validator.mjs`)
  const baseline = await import(pathToFileURL(baselinePath).href)
  const validateSource = baseline.validateCatalogFile.toString()
  const readSource = validateSource.replace(/(\{\s*)([\w$]+\[[\w$]+\]\.parse\([\w$]+\))(;?\s*\})$/, '$1return $2$3')
  if (validateSource === readSource) throw new Error('Unsupported frozen validator entry point')
  const source = fs.readFileSync(baselinePath, 'utf8')
  if (!source.includes(validateSource)) throw new Error('Frozen validator function source was not found')
  // Keep Node resolution available for v2's immutable external semver import.
  const directory = fs.mkdtempSync(path.join(__dirname, 'registry-reader-'))
  temporaryDirectories.push(directory)
  const readerPath = path.join(directory, `v${version}-reader.mjs`)
  fs.writeFileSync(readerPath, source.replace(validateSource, readSource))
  return (await import(pathToFileURL(readerPath).href)).validateCatalogFile
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
  it('keeps existing catalog streams available when the current schema advances', async () => {
    const { destinationDirectory } = makeDirectories()
    const sourceDirectory = path.resolve(COMPAT_DIRECTORY, '../data')
    // Both lanes already exist in production; their floors must survive a newer current stream.
    for (const [schemaVersion, minAppVersion] of [
      [2, '2.0.13'],
      [3, '2.1.4']
    ] as const) {
      const directory = path.join(destinationDirectory, `v${schemaVersion}`)
      fs.mkdirSync(directory)
      fs.writeFileSync(
        path.join(directory, 'manifest.json'),
        JSON.stringify({ minAppVersion, sourceAppVersion: '2.1.4', revision: 35, schemaVersion, files: {} })
      )
    }

    const published = await publishRegistryCatalog({
      ...publishOptions,
      sourceDirectory,
      destinationDirectory,
      currentVersion: REGISTRY_SCHEMA_VERSION,
      minAppVersion: REGISTRY_MIN_APP_VERSION,
      sourceAppVersion: REGISTRY_MIN_APP_VERSION
    })

    expect(published).toEqual(expect.arrayContaining(['v2', 'v3']))
    const v2Directory = path.join(destinationDirectory, 'v2')
    const v2Manifest = JSON.parse(fs.readFileSync(path.join(v2Directory, 'manifest.json'), 'utf8'))
    expect(v2Manifest).toMatchObject({
      minAppVersion: '2.0.13',
      sourceAppVersion: REGISTRY_MIN_APP_VERSION,
      revision: 41,
      schemaVersion: 2
    })
    const { validateCatalogDirectory } = await import(path.join(COMPAT_DIRECTORY, 'v2-validator.mjs'))
    expect(() => validateCatalogDirectory(v2Directory)).not.toThrow()

    const sourceModels = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'models.json'), 'utf8'))
    const v2Models = JSON.parse(fs.readFileSync(path.join(v2Directory, 'models.json'), 'utf8'))
    expect(v2Models.models).toContainEqual(
      sourceModels.models.find((model: { id: string }) => model.id === 'claude-opus-5-5')
    )
    // A converted catalog has its own content identity, not necessarily the source version.
    const { version: v2Version, ...v2Body } = v2Models
    const contentHash = createHash('sha256').update(JSON.stringify(v2Body)).digest('hex').slice(0, 16)
    expect(v2Version).toBe(contentHash)
    expect(v2Manifest.files['models.json']).toBe(contentHash)

    const v3Directory = path.join(destinationDirectory, 'v3')
    const v3Manifest = JSON.parse(fs.readFileSync(path.join(v3Directory, 'manifest.json'), 'utf8'))
    expect(v3Manifest).toMatchObject({ minAppVersion: '2.1.4', schemaVersion: 3 })
    const v3Models = JSON.parse(fs.readFileSync(path.join(v3Directory, 'models.json'), 'utf8'))
    expect(v3Models.models).toContainEqual(
      expect.objectContaining({
        id: 'claude-sonnet-5-5',
        reasoning: expect.objectContaining({ wireDialect: 'adaptive-between-tools' })
      })
    )
    for (const file of ['models.json', 'providers.json', 'provider-models.json']) {
      const publishedBytes = fs.readFileSync(path.join(destinationDirectory, `v${REGISTRY_SCHEMA_VERSION}`, file))
      expect(publishedBytes.equals(fs.readFileSync(path.join(sourceDirectory, file)))).toBe(true)
    }
  })

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

  it.each([1, 2, 3])('removes unsupported GIF choices while retaining static controls in v%s', async (version) => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)
    const formats = [
      { type: 'enum', options: ['png', 'gif', 'webp'], default: 'gif' },
      { type: 'enum', options: ['png', 'gif', 'webp'], default: 'png' },
      { type: 'enum', options: ['gif'], default: 'gif' },
      { type: 'enum', options: ['png', 'webp'], default: 'webp' }
    ]
    const expectedFormats = [
      { type: 'enum', options: ['png', 'webp'] },
      { type: 'enum', options: ['png', 'webp'], default: 'png' },
      undefined,
      formats[3]
    ]
    const quality = { type: 'enum', options: ['low', 'high'] }
    const files = [
      ['models.json', 'models'],
      ['provider-models.json', 'overrides']
    ] as const
    for (const [file, key] of files) {
      const entries = formats.map((outputFormat, index) => ({
        ...(key === 'models'
          ? { id: `format-model-${index}`, name: `Format model ${index}` }
          : { providerId: 'openai', modelId: `format-model-${index}` }),
        imageGeneration: {
          modes: Object.fromEntries(
            ['generate', 'edit', 'remix', 'upscale', 'merge'].map((mode) => [
              mode,
              { supports: { outputFormat, quality } }
            ])
          )
        }
      }))
      fs.writeFileSync(path.join(sourceDirectory, file), JSON.stringify({ version: 'original', [key]: entries }))
    }
    const directory = path.join(destinationDirectory, `v${version}`)
    fs.mkdirSync(directory)
    const oldFloor = ['2.0.9', '2.0.13', '2.1.4'][version - 1]
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ minAppVersion: oldFloor }))

    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory, currentVersion: 4 })

    const read = await readFrozenCatalog(version)
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'))
    expect(manifest.minAppVersion).toBe(oldFloor)
    for (const [file, key] of files) {
      const wire = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
      const decoded = read(file, wire)
      expect(decoded[key]).toHaveLength(formats.length)
      for (const [index, entry] of decoded[key].entries()) {
        for (const descriptor of Object.values(entry.imageGeneration.modes) as Array<{
          supports: Record<string, unknown>
        }>) {
          expect(descriptor.supports.outputFormat).toEqual(expectedFormats[index])
          expect(descriptor.supports.quality).toEqual(quality)
        }
      }
      expect(manifest.files[file]).toBe(wire.version)
      expect(wire.version).not.toBe('original')
      const original = JSON.parse(fs.readFileSync(path.join(sourceDirectory, file), 'utf8'))
      expect(original[key][0].imageGeneration.modes.generate.supports.outputFormat).toEqual(formats[0])
    }
  })

  it.each([1, 2, 3])('publishes only executable legacy OpenAI controls in v%s', async (version) => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    const endpointTypes = ['openai-image-generation', 'openai-image-edit']
    const supports = {
      numImages: { type: 'range', min: 1, max: 10, step: 1 },
      size: { type: 'enum', options: ['1024x1024'] },
      quality: { type: 'enum', options: ['low', 'high'] },
      background: { type: 'enum', options: ['opaque', 'transparent'] },
      moderation: { type: 'enum', options: ['auto', 'low'] },
      style: { type: 'enum', options: ['natural', 'vivid'] },
      outputFormat: { type: 'enum', options: ['png', 'jpeg', 'webp'] },
      outputCompression: { type: 'range', min: 0, max: 100, step: 1 },
      frameCount: { type: 'range', min: 2, max: 16 },
      complexity: { type: 'enum', options: ['low', 'high'] }
    }
    const imageGeneration = {
      modes: Object.fromEntries(['generate', 'edit', 'remix', 'upscale', 'merge'].map((mode) => [mode, { supports }]))
    }
    const model = { id: 'image-model', name: 'Image model', endpointTypes, imageGeneration }
    fs.writeFileSync(path.join(sourceDirectory, 'models.json'), JSON.stringify({ version: 'm1', models: [model] }))
    const providers = [
      {
        id: 'native-images',
        name: 'Native images',
        metadata: { website: {} },
        endpointConfigs: { 'openai-image-generation': { adapterFamily: 'openai' } }
      },
      {
        id: 'router-images',
        name: 'Router images',
        metadata: { website: {} },
        endpointConfigs: { 'openai-image-generation': { adapterFamily: 'openrouter' } }
      }
    ]
    fs.writeFileSync(path.join(sourceDirectory, 'providers.json'), JSON.stringify({ version: 'p1', providers }))
    const overrides = [
      { providerId: 'native-images', modelId: model.id, imageGeneration },
      { providerId: 'native-images', modelId: 'offer-only', endpointTypes, imageGeneration },
      { providerId: 'router-images', modelId: model.id, endpointTypes, imageGeneration }
    ]
    fs.writeFileSync(path.join(sourceDirectory, 'provider-models.json'), JSON.stringify({ version: 'pm1', overrides }))
    const originals = Object.fromEntries(
      ['models.json', 'providers.json', 'provider-models.json'].map((file) => [
        file,
        fs.readFileSync(path.join(sourceDirectory, file))
      ])
    )
    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory, currentVersion: 4 })
    const read = await readFrozenCatalog(version)
    const models = read(
      'models.json',
      JSON.parse(fs.readFileSync(path.join(destinationDirectory, `v${version}/models.json`), 'utf8'))
    ).models
    const offers = read(
      'provider-models.json',
      JSON.parse(fs.readFileSync(path.join(destinationDirectory, `v${version}/provider-models.json`), 'utf8'))
    ).overrides
    expect(models).toHaveLength(1)
    expect(offers).toHaveLength(3)
    for (const entry of [models[0], offers[0], offers[1]]) {
      for (const mode of Object.values(entry.imageGeneration.modes) as Array<{ supports: Record<string, unknown> }>) {
        expect(mode.supports).toEqual({
          numImages: supports.numImages,
          size: supports.size,
          quality: supports.quality,
          background: supports.background,
          moderation: supports.moderation,
          style: supports.style
        })
      }
    }
    for (const mode of Object.values(offers[2].imageGeneration.modes) as Array<{ supports: Record<string, unknown> }>) {
      expect(mode.supports.outputFormat).toEqual(supports.outputFormat)
      expect(mode.supports.outputCompression).toEqual(supports.outputCompression)
      expect(mode.supports.frameCount).toBeUndefined()
      expect(mode.supports.complexity).toBeUndefined()
    }
    for (const [file, original] of Object.entries(originals)) {
      expect(fs.readFileSync(path.join(sourceDirectory, file))).toEqual(original)
    }
  })

  it('retains a legacy model when optional image parameter vocabulary expands', async () => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)
    const readV3 = await readFrozenCatalog(3)
    const model = {
      id: 'legacy-image-model',
      name: 'Legacy image model',
      imageGeneration: {
        modes: {
          generate: {
            supports: {
              quality: { type: 'enum', options: ['low', 'high'] }
            }
          }
        }
      }
    }
    expect(readV3('models.json', { version: 'm1', models: [model] }).models).toHaveLength(1)
    const expanded = structuredClone(model)
    Object.assign(expanded.imageGeneration.modes.generate.supports, {
      futureImageOption: { type: 'text' }
    })
    const input = JSON.stringify({ version: 'm1', models: [expanded] })
    expect(readV3('models.json', JSON.parse(input)).models).toHaveLength(0)
    fs.writeFileSync(path.join(sourceDirectory, 'models.json'), input)

    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory, currentVersion: 4 })

    const wire = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v3/models.json'), 'utf8'))
    // Independently calculated SHA-256 of the version-less canonical fixture.
    expect(wire.version).toBe('157664e676b7c329')
    const manifest = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v3/manifest.json'), 'utf8'))
    expect(manifest.files['models.json']).toBe(wire.version)
    const decoded = readV3('models.json', wire)
    expect(decoded.models).toContainEqual(
      expect.objectContaining({
        id: 'legacy-image-model',
        imageGeneration: {
          modes: {
            generate: {
              supports: {
                quality: { type: 'enum', options: ['low', 'high'] }
              }
            }
          }
        }
      })
    )
    expect(fs.readFileSync(path.join(sourceDirectory, 'models.json'), 'utf8')).toBe(input)
  })

  it.each([1, 2, 3])('preserves models and overrides in every v%s image mode', async (version) => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, OVERRIDE_WITH_UNKNOWN_EFFORT)
    const read = await readFrozenCatalog(version)
    const known = { quality: { type: 'enum', options: ['high', 'low'] } }
    const modes = Object.fromEntries(
      ['generate', 'edit', 'remix', 'upscale', 'merge'].map((mode) => [
        mode,
        {
          supports: { ...known, futureImageOption: { type: 'text' }, anotherFutureOption: { type: 'switch' } }
        }
      ])
    )
    for (const [file, key, identity] of [
      ['models.json', 'models', { id: 'image-model', name: 'Image model' }],
      ['provider-models.json', 'overrides', { providerId: 'openai', modelId: 'image-model' }]
    ] as const) {
      fs.writeFileSync(
        path.join(sourceDirectory, file),
        JSON.stringify({
          version: 'original',
          [key]: [{ ...identity, imageGeneration: { modes } }, identity]
        })
      )
    }

    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory, currentVersion: 4 })

    for (const [file, key] of [
      ['models.json', 'models'],
      ['provider-models.json', 'overrides']
    ]) {
      const raw = JSON.parse(fs.readFileSync(path.join(destinationDirectory, `v${version}`, file), 'utf8'))
      const decoded = read(file, raw)
      expect(decoded[key]).toHaveLength(2)
      for (const mode of Object.keys(modes)) {
        expect(raw[key][0].imageGeneration.modes[mode].supports).toEqual(known)
        expect(decoded[key][0].imageGeneration.modes[mode].supports).toEqual(known)
      }
    }
  })

  it('preserves current and unchanged legacy catalog bytes', async () => {
    const { sourceDirectory, destinationDirectory } = makeDirectories()
    writeCatalog(sourceDirectory, { providerId: 'openai', modelId: 'image-model' })
    const input =
      '{ "version": "untouched", "models": [{ "id": "image-model", "name": "Image model", "imageGeneration": { "modes": { "generate": { "supports": { "quality": { "type": "enum", "options": ["high"] }, "outputFormat": { "type": "enum", "options": ["png", "webp"], "default": "png" } } } } } }] }'
    fs.writeFileSync(path.join(sourceDirectory, 'models.json'), input)
    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory, currentVersion: 3 })
    for (const version of [1, 2, 3]) {
      for (const file of ['models.json', 'providers.json', 'provider-models.json']) {
        expect(fs.readFileSync(path.join(destinationDirectory, `v${version}`, file))).toEqual(
          fs.readFileSync(path.join(sourceDirectory, file))
        )
      }
    }
    const expanded = JSON.parse(input)
    expanded.models[0].imageGeneration.modes.generate.supports.futureImageOption = { type: 'text' }
    expanded.models[0].imageGeneration.modes.generate.supports.outputFormat.options.push('gif')
    expanded.models[0].imageGeneration.modes.generate.supports.outputFormat.default = 'gif'
    fs.writeFileSync(path.join(sourceDirectory, 'models.json'), JSON.stringify(expanded))
    await publishRegistryCatalog({ ...publishOptions, sourceDirectory, destinationDirectory, currentVersion: 3 })
    expect(fs.readFileSync(path.join(destinationDirectory, 'v3/models.json'))).toEqual(
      fs.readFileSync(path.join(sourceDirectory, 'models.json'))
    )
  })

  it.each(['models.json', 'providers.json', 'provider-models.json'])(
    'preserves the generator content version and write shape for %s',
    (file) => {
      const original = fs.readFileSync(path.resolve(COMPAT_DIRECTORY, '../data', file), 'utf8')
      const body = JSON.parse(original)
      delete body.version
      expect(stampAndSerialize(body)).toBe(`${JSON.stringify(JSON.parse(original), null, 2)}\n`)
    }
  )

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
    const override = JSON.parse(fs.readFileSync(path.join(destinationDirectory, 'v1/provider-models.json'), 'utf8'))
    expect(v1.files).toEqual({ 'models.json': 'm1', 'providers.json': 'p1', 'provider-models.json': override.version })
    expect(override.version).not.toBe('pm1')
  })
})

/**
 * Meta creator catalog — MuseSpark 1.3 regression guard for #20096.
 *
 * The issue: the model shipped (2026-09-02) before the catalog listed it, so
 * runtime lookups missed and `isVisionModel` came back false — chat images
 * degraded to OCR text instead of being sent natively. The creator now
 * hand-lists the model so inclusion no longer depends on the models.dev
 * listing catching up. These tests pin both ends of that contract:
 * the issue's raw wire id must resolve to a vision-capable catalog row, and
 * the hand-listed entry must stay in the creator source.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { CREATORS } from '../creators'
import { inferReasoningControls } from '../patterns/reasoning-heuristics'
import { createRegistry } from '../registry'
import { RegistryLoader } from '../registry-loader'
import { normalizeModelId } from '../utils/normalize'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Meta Muse Spark Open catalog', () => {
  const registry = createRegistry(bundledCatalog)

  it.each([
    ['meta-models/Muse-Spark-Open-816B-A42B', 'muse-spark-open-816b-a42b'],
    ['muse-spark-open-816b-a42b', 'muse-spark-open-816b-a42b'],
    ['meta-models/Muse-Spark-Open-816B-A42B-NVFP4', 'muse-spark-open-816b-a42b-nvfp4']
  ])('resolves %s as the multimodal open-weight model without losing its size', (apiModelId, expectedId) => {
    expect(registry.findModel(apiModelId)).toMatchObject({
      id: expectedId,
      ownedBy: 'meta',
      openWeights: true,
      contextWindow: 1048576,
      capabilities: expect.arrayContaining([
        'function-call',
        'reasoning',
        'image-recognition',
        'audio-recognition',
        'video-recognition'
      ]),
      inputModalities: expect.arrayContaining(['text', 'image', 'video', 'audio']),
      outputModalities: ['text']
    })
  })

  it('does not substitute another parameter size', () => {
    expect(registry.findModel('meta-models/Muse-Spark-Open-30B')).toBeNull()
  })

  it.each(['meta-models/Muse-Spark-Open-816B-A42B', 'meta-models/Muse-Spark-Open-816B-A42B-NVFP4'])(
    'offers only the official template efforts and preserves the xhigh default for %s',
    (apiModelId) => {
      const model = registry.findModel(apiModelId)
      expect(model?.reasoning).toMatchObject({
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh'], default: 'xhigh' }],
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: 'xhigh'
      })
      expect(inferReasoningControls(apiModelId)).toEqual([
        { kind: 'effort', values: ['low', 'medium', 'high', 'xhigh'] }
      ])
    }
  )
})

describe('Meta MuseSpark 1.3 catalog (#20096)', () => {
  it('resolves the issue’s raw wire id to a vision-capable catalog row', () => {
    // OpenRouter serves `meta/muse-spark-1.3`; the runtime lookup normalizes
    // namespace and dot/ dash spelling before hitting the catalog.
    const normalized = normalizeModelId('meta/muse-spark-1.3')
    expect(normalized).toBe('muse-spark-1-3')

    expect(loader.findModel(normalized)).toMatchObject({
      id: 'muse-spark-1-3',
      // Meta is the lineage owner — Vercel's gateway listing only resells it.
      ownedBy: 'meta',
      // image-recognition + image input are what isVisionModel reads — without
      // them chat images degrade to OCR text before reaching the provider.
      capabilities: expect.arrayContaining(['image-recognition']),
      inputModalities: expect.arrayContaining(['image'])
    })
  })

  it('hand-lists the model in the creator so inclusion survives listing churn', () => {
    const meta = CREATORS.find(({ id }) => id === 'meta')

    expect(meta?.models?.find(({ id }) => id === 'muse-spark-1-3')).toMatchObject({
      name: 'Muse Spark 1.3',
      family: 'muse',
      capabilities: expect.arrayContaining(['image-recognition', 'reasoning', 'function-call']),
      inputModalities: expect.arrayContaining(['text', 'image']),
      outputModalities: ['text'],
      contextWindow: 1048576
    })
  })
})

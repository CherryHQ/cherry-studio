/**
 * Vercel creator catalog — MuseSpark 1.3 regression guard for #20096.
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

import { CREATORS } from '../creators'
import { RegistryLoader } from '../registry-loader'
import { normalizeModelId } from '../utils/normalize'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

describe('Vercel MuseSpark 1.3 catalog (#20096)', () => {
  it('resolves the issue’s raw wire id to a vision-capable catalog row', () => {
    // OpenRouter serves `meta/muse-spark-1.3`; the runtime lookup normalizes
    // namespace and dot/ dash spelling before hitting the catalog.
    const normalized = normalizeModelId('meta/muse-spark-1.3')
    expect(normalized).toBe('muse-spark-1-3')

    expect(loader.findModel(normalized)).toMatchObject({
      id: 'muse-spark-1-3',
      ownedBy: 'vercel',
      // image-recognition + image input are what isVisionModel reads — without
      // them chat images degrade to OCR text before reaching the provider.
      capabilities: expect.arrayContaining(['image-recognition']),
      inputModalities: expect.arrayContaining(['image'])
    })
  })

  it('hand-lists the model in the creator so inclusion survives listing churn', () => {
    const vercel = CREATORS.find(({ id }) => id === 'vercel')

    expect(vercel?.models?.find(({ id }) => id === 'muse-spark-1-3')).toMatchObject({
      name: 'Muse Spark 1.3',
      family: 'muse',
      capabilities: expect.arrayContaining(['image-recognition', 'reasoning', 'function-call']),
      inputModalities: expect.arrayContaining(['text', 'image']),
      outputModalities: ['text'],
      contextWindow: 1048576
    })
  })
})

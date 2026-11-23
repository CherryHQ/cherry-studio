import { afterEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { translatePaintingGenerateError } from '../../errors/paintingGenerateError'
import type { PaintingData } from '../../model/types/paintingData'
import { validateSeedreamPaintingParams } from '../validateSeedreamPaintingParams'
import { validateSeedreamPaintingProvider } from '../validateSeedreamPaintingProvider'

const model = 'doubao-seedream-5-5'

function rejection(run: () => void): Error {
  try {
    run()
  } catch (error) {
    return error as Error
  }
  throw new Error('expected a validation error')
}

describe('Seedream validation messages', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it.each([
    [{ size: '2150x2160' }, 'paintings.seedream.invalid_size'],
    [{ background: 'transparent', outputFormat: 'jpeg' }, 'paintings.seedream.transparent_png']
  ])('tells a German user why %j was rejected', async (params, key) => {
    await i18n.changeLanguage('de-DE')
    const error = rejection(() => validateSeedreamPaintingParams({ model, params } as unknown as PaintingData))
    expect(translatePaintingGenerateError(error)).toBe(i18n.t(key))
  })

  it('tells a German user that DMXAPI cannot run the model', async () => {
    await i18n.changeLanguage('de-DE')
    const error = rejection(() => validateSeedreamPaintingProvider(model, { id: 'dmxapi' }))
    expect(translatePaintingGenerateError(error)).toBe(i18n.t('paintings.seedream.dmxapi_unsupported'))
  })
})

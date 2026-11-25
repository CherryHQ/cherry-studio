import { describe, expect, it } from 'vitest'

import en from '../locales/en-us.json'
import i18n, { initI18n } from '../resolver'

describe('locale loader ownership', () => {
  it('rejects an inherited object key in the registered locale loader', async () => {
    await initI18n()
    const locale = new Promise((resolve, reject) => {
      i18n.services.backendConnector.backend.read('constructor', 'translation', (error, resources) => {
        if (error) reject(error)
        else resolve(resources)
      })
    })

    await expect(locale).rejects.toThrow('No locale pack for "constructor"')
    expect(i18n.hasResourceBundle('constructor', 'translation')).toBe(false)
  })

  it('loads the English fallback pack through the registered backend', async () => {
    await initI18n()
    const locale = new Promise((resolve, reject) => {
      i18n.services.backendConnector.backend.read('en-US', 'translation', (error, resources) => {
        if (error) reject(error)
        else resolve(resources)
      })
    })

    await expect(locale).resolves.toEqual(en)
  })
})

import { describe, expect, it, vi } from 'vitest'

import i18n, { initI18n } from '../resolver'

describe('locale loader ownership', () => {
  it('reports an inherited object key as an unavailable locale and keeps the English fallback usable', async () => {
    await initI18n()
    const previousLanguage = i18n.language
    const failedLoading = vi.fn()
    i18n.on('failedLoading', failedLoading)

    try {
      await i18n.changeLanguage('constructor')

      expect(failedLoading).toHaveBeenCalledWith('constructor', 'translation', expect.any(Error))
      expect(i18n.hasResourceBundle('constructor', 'translation')).toBe(false)
      expect(i18n.resolvedLanguage).toBe('en-US')
    } finally {
      i18n.off('failedLoading', failedLoading)
      await i18n.changeLanguage(previousLanguage)
    }
  })
})

import { parseTranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateLanguage } from '@shared/data/types/translate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  translateText: vi.fn()
}))

vi.mock('@renderer/services/TranslateService', () => ({
  translateText: mocks.translateText
}))

import { translateInputText } from '../TranslateCommandService'

const TARGET_LANG_CODE = parseTranslateLangCode('en-us')
const TARGET_LANGUAGE = {
  langCode: TARGET_LANG_CODE,
  value: 'English',
  emoji: 'US',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
} as TranslateLanguage

const t = ((key: string) => key) as any

let originalModal: unknown
let originalClipboard: unknown

beforeEach(() => {
  originalModal = window.modal
  originalClipboard = navigator.clipboard
  mocks.translateText.mockResolvedValue('translated text')

  Object.defineProperty(window, 'modal', {
    configurable: true,
    value: {
      confirm: vi.fn().mockResolvedValue(true)
    }
  })

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
  })
})

afterEach(() => {
  Object.defineProperty(window, 'modal', {
    configurable: true,
    value: originalModal
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard
  })
  vi.clearAllMocks()
})

describe('translateInputText', () => {
  it('copies source text and resolves target language before translating', async () => {
    const onConfirmed = vi.fn()

    await expect(
      translateInputText({
        text: 'source text',
        targetLanguage: TARGET_LANG_CODE,
        languages: [TARGET_LANGUAGE],
        t,
        onConfirmed
      })
    ).resolves.toBe('translated text')

    expect(onConfirmed).toHaveBeenCalledOnce()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('source text')
    expect(mocks.translateText).toHaveBeenCalledWith('source text', TARGET_LANGUAGE)
    expect(window.modal.confirm).not.toHaveBeenCalled()
  })

  it('returns null without side effects when confirm is canceled', async () => {
    vi.mocked(window.modal.confirm).mockResolvedValueOnce(false)
    const onConfirmed = vi.fn()

    await expect(
      translateInputText({
        text: 'source text',
        targetLanguage: TARGET_LANG_CODE,
        showConfirm: true,
        t,
        onConfirmed
      })
    ).resolves.toBeNull()

    expect(onConfirmed).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(mocks.translateText).not.toHaveBeenCalled()
  })

  it('returns null for blank text', async () => {
    await expect(
      translateInputText({
        text: '   ',
        targetLanguage: TARGET_LANG_CODE,
        t
      })
    ).resolves.toBeNull()

    expect(window.modal.confirm).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(mocks.translateText).not.toHaveBeenCalled()
  })
})

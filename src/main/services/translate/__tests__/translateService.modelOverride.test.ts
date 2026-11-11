import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { translateLanguageService } from '@data/services/TranslateLanguageService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import type { TranslateLanguage } from '@shared/data/types/translate'

import { translateService } from '../translateService'

const target = { langCode: 'en-us', value: 'English' } as TranslateLanguage
const streamPrompt = vi.fn()

describe('translation model override', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.translate.model_id', 'test::preferred')
    MockApplicationUtils.setService('AiStreamManager', { streamPrompt })
    streamPrompt.mockReset()
    const orderKey = generateOrderKeyBetween(null, null)
    dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', orderKey, isEnabled: true }).run()
    for (const modelId of ['preferred', 'selected', 'disabled']) {
      dbh.db
        .insert(userModelTable)
        .values({
          id: `test::${modelId}`,
          providerId: 'test',
          modelId,
          name: modelId,
          capabilities: [],
          supportsStreaming: true,
          isEnabled: modelId !== 'disabled',
          isHidden: false,
          orderKey
        })
        .run()
    }
  })
  it('uses the explicit selection and preserves preference behavior when omitted', () => {
    expect(translateService.resolveTranslatePayload('hello', target, 'test::selected').uniqueModelId).toBe(
      'test::selected'
    )
    expect(translateService.resolveTranslatePayload('hello', target).uniqueModelId).toBe('test::preferred')
  })
  it('rejects invalid, missing and disabled explicit selections without fallback', () => {
    for (const id of ['test::missing', 'test::disabled', 'broken', 'test::bad?query'] as const) {
      expect(() => translateService.resolveTranslatePayload('hello', target, id as `test::${string}`)).toThrow(
        'translate.error.not_configured'
      )
    }
    dbh.db.update(userProviderTable).set({ isEnabled: false }).where(eq(userProviderTable.providerId, 'test')).run()
    expect(() => translateService.resolveTranslatePayload('hello', target, 'test::selected')).toThrow(
      'translate.error.not_configured'
    )
  })
  it('disables retries for an explicit selection', () => {
    const lookup = vi.spyOn(translateLanguageService, 'getByLangCode').mockReturnValue(target)
    try {
      translateService.open({ id: 1 } as Electron.WebContents, {
        streamId: 'translate:test',
        text: 'hello',
        targetLangCode: 'en-us',
        modelId: 'test::selected'
      })
      expect(streamPrompt).toHaveBeenCalledWith(
        expect.objectContaining({ uniqueModelId: 'test::selected', maxRetries: 0 })
      )
    } finally {
      lookup.mockRestore()
    }
  })
})

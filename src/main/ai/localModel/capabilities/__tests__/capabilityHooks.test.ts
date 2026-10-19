import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceExport, MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { LocalModelSeeder } from '@data/db/seeding/seeders/LocalModelSeeder'
import { localLlmUniqueModelId } from '@shared/data/presets/localLlm'

import { capabilityHooksFor } from '../capabilityHooks'

describe('OCR capability removal', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('clears every default processor that depends on the removed OCR model', async () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_image_to_text': 'local-paddleocr',
      'feature.file_processing.default_document_to_markdown': 'local-document'
    })

    await capabilityHooksFor('ocr', 'pp-ocrv6-medium').afterRemove?.()

    expect(MockMainPreferenceServiceExport.preferenceService.setMultiple).toHaveBeenCalledWith({
      'feature.file_processing.default_image_to_text': null,
      'feature.file_processing.default_document_to_markdown': null
    })
    expect(MockMainPreferenceServiceExport.preferenceService.set).not.toHaveBeenCalled()
    expect(
      MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.default_image_to_text')
    ).toBeNull()
    expect(
      MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.default_document_to_markdown')
    ).toBeNull()
  })
})

describe('local chat install state', () => {
  const dbh = setupTestDatabase()

  async function isListed(): Promise<boolean | undefined> {
    const [row] = await dbh.db
      .select({ isEnabled: userModelTable.isEnabled })
      .from(userModelTable)
      .where(eq(userModelTable.id, localLlmUniqueModelId('qwen3.5-4b-q4_k_m')))
    return row?.isEnabled
  }

  it('lists the seeded chat model only while it is installed', async () => {
    new LocalModelSeeder().run(dbh.db)
    const hooks = capabilityHooksFor('llm', 'qwen3.5-4b-q4_k_m')

    await hooks.syncInstallState?.(true)
    expect(await isListed()).toBe(true)

    await hooks.syncInstallState?.(false)
    expect(await isListed()).toBe(false)
  })
})

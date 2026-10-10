import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import type * as ProviderRegistryServiceModule from '@data/services/ProviderRegistryService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

const { resolveModelMock } = vi.hoisted(() => ({
  resolveModelMock:
    vi.fn<(providerContext: ProviderRegistryServiceModule.ReasoningProviderContext, modelId: string) => unknown>()
}))

const OPENAI_CHAT_REASONING_PROFILE: ProviderRegistryServiceModule.ResolvedReasoningProfile = {
  format: 'openai-chat' as const,
  wire: {
    off: { operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }] },
    auto: { operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }] },
    effort: { operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }] }
  }
}

vi.mock('@data/services/ProviderRegistryService', async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderRegistryServiceModule>()
  return {
    ...actual,
    providerRegistryService: {
      ...actual.providerRegistryService,
      resolveModel: resolveModelMock
    }
  }
})

function providerRow(providerId: string, name: string) {
  return { providerId, name, orderKey: generateOrderKeyBetween(null, null) }
}

const { resolveModelNativeImageSupport } = await import('../modelImageSupport')

describe('resolveModelNativeImageSupport — persisted modality overrides', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    resolveModelMock.mockReturnValue({
      presetModel: {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      },
      registryOverride: null,
      reasoningProfile: OPENAI_CHAT_REASONING_PROFILE
    })
  })

  it('keeps native images enabled after baseline input modalities are restored via ModelService.update', async () => {
    await dbh.db.insert(userProviderTable).values(providerRow('openai', 'OpenAI'))
    await dbh.db.insert(userModelTable).values({
      id: 'openai::gpt-4o',
      providerId: 'openai',
      modelId: 'gpt-4o',
      presetModelId: 'gpt-4o',
      name: null,
      capabilities: null,
      inputModalities: null,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false,
      isDeprecated: false,
      orderKey: generateOrderKeyBetween(null, null)
    })

    modelService.update('openai', 'gpt-4o', { inputModalities: [MODALITY.TEXT] })
    modelService.update('openai', 'gpt-4o', { inputModalities: [MODALITY.TEXT, MODALITY.IMAGE] })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row).toMatchObject({ inputModalities: null, inputModalitiesExplicit: true })
    expect(resolveModelNativeImageSupport('openai::gpt-4o')).toBe(true)
  })
})

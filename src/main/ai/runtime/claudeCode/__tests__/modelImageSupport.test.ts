import { setupTestDatabase } from '@test-helpers/db'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import type * as ProviderRegistryServiceModule from '@data/services/ProviderRegistryService'
import { generateOrderKeyBetween } from '@data/services/utils/orderKey'
import { createUniqueModelId, MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'

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

async function seedProvider(dbh: ReturnType<typeof setupTestDatabase>, providerId: string) {
  const existing = await dbh.db.select().from(userProviderTable).where(eq(userProviderTable.providerId, providerId))
  if (existing.length === 0) {
    await dbh.db.insert(userProviderTable).values(providerRow(providerId, providerId))
  }
}

async function seedPresetModel(
  dbh: ReturnType<typeof setupTestDatabase>,
  providerId: string,
  modelId: string,
  values: Partial<typeof userModelTable.$inferInsert> = {}
) {
  await seedProvider(dbh, providerId)
  await dbh.db.insert(userModelTable).values({
    id: createUniqueModelId(providerId, modelId),
    providerId,
    modelId,
    presetModelId: modelId,
    name: null,
    capabilities: null,
    inputModalities: null,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    isDeprecated: false,
    orderKey: generateOrderKeyBetween(null, null),
    ...values
  })
}

const { resolveModelNativeImageSupport } = await import('../modelImageSupport')

describe('resolveModelNativeImageSupport', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    resolveModelMock.mockReturnValue({
      presetModel: {
        id: 'claude-sonnet-5-5',
        name: 'Claude Sonnet 5.5',
        capabilities: [MODEL_CAPABILITY.IMAGE_RECOGNITION, MODEL_CAPABILITY.FUNCTION_CALL],
        inputModalities: [MODALITY.TEXT, MODALITY.IMAGE]
      },
      registryOverride: null,
      reasoningProfile: OPENAI_CHAT_REASONING_PROFILE
    })
  })

  it('returns true when the hydrated model is vision-capable', async () => {
    await seedPresetModel(dbh, 'claude-code', 'claude-sonnet-5-5')

    expect(resolveModelNativeImageSupport('claude-code::claude-sonnet-5-5')).toBe(true)
  })

  it('falls back to the registry when the stored row lacks synced vision metadata', async () => {
    await seedPresetModel(dbh, 'claude-code', 'claude-sonnet-5-5', {
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
      inputModalities: [MODALITY.TEXT]
    })

    expect(resolveModelNativeImageSupport('claude-code::claude-sonnet-5-5')).toBe(true)
    expect(resolveModelMock).toHaveBeenCalled()
  })

  it('respects an explicit user disable even when hydrated capabilities still include vision', async () => {
    await seedPresetModel(dbh, 'claude-code', 'claude-sonnet-5-5')
    modelService.update('claude-code', 'claude-sonnet-5-5', { inputModalities: [MODALITY.TEXT] })

    expect(modelService.getByKey('claude-code', 'claude-sonnet-5-5').capabilities).toContain(
      MODEL_CAPABILITY.IMAGE_RECOGNITION
    )
    expect(resolveModelNativeImageSupport('claude-code::claude-sonnet-5-5')).toBe(false)
  })

  it('does not treat baseline-restored null input modalities as an explicit image disable', async () => {
    await seedPresetModel(dbh, 'openai', 'gpt-4o', { presetModelId: 'gpt-4o' })
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

    modelService.update('openai', 'gpt-4o', { inputModalities: [MODALITY.TEXT] })
    modelService.update('openai', 'gpt-4o', { inputModalities: [MODALITY.TEXT, MODALITY.IMAGE] })

    const [row] = await dbh.db
      .select()
      .from(userModelTable)
      .where(and(eq(userModelTable.providerId, 'openai'), eq(userModelTable.modelId, 'gpt-4o')))

    expect(row).toMatchObject({ inputModalities: null, inputModalitiesExplicit: true })
    expect(resolveModelNativeImageSupport('openai::gpt-4o')).toBe(true)
  })

  it('reads modality overrides for the requested provider/model pair only', async () => {
    await seedPresetModel(dbh, 'claude-code', 'vision-model')
    await seedPresetModel(dbh, 'claude-code', 'text-only-model')
    modelService.update('claude-code', 'text-only-model', { inputModalities: [MODALITY.TEXT] })

    expect(resolveModelNativeImageSupport('claude-code::vision-model')).toBe(true)
    expect(resolveModelNativeImageSupport('claude-code::text-only-model')).toBe(false)
  })

  it('assumes vision-capable when the model row cannot be resolved', async () => {
    await seedProvider(dbh, 'claude-code')

    expect(resolveModelNativeImageSupport('claude-code::missing')).toBe(true)
  })
})

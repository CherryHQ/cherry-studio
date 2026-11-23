import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { canAttemptFunctionCallingModel, isFunctionCallingModel, isVisionModel } from '@shared/utils/model'

describe('ProviderRegistryService provider-owned model metadata', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    const getPath = vi.mocked(application.getPath).getMockImplementation()
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
      key === 'feature.provider_registry.data' && filename
        ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
        : key === 'app.root'
          ? resolve(process.cwd(), filename ?? '')
          : (getPath?.(key, filename) ?? `/mock/${key}`)
    )
    providerRegistryService.clearCache()
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'workflow-server',
        presetProviderId: 'comfyui',
        name: 'Workflows',
        orderKey: 'a0'
      })
      .run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    providerRegistryService.clearCache()
  })

  it.each(['qwen-image-edit', 'gpt-image-1', 'flux-2-pro', 'deepseek-r1', 'folder/my-workflow'])(
    'keeps workflow %s independent of global model names across resolve, create and read',
    (modelId) => {
      const providerId = 'workflow-server'
      const [resolved] = providerRegistryService.resolveModels(providerId, [modelId])
      expect(resolved).toMatchObject({
        apiModelId: modelId,
        presetModelId: null,
        capabilities: ['image-generation'],
        inputModalities: ['text'],
        outputModalities: ['image'],
        supportsStreaming: false
      })
      expect(resolved.reasoning).toBeUndefined()
      modelService.create([
        {
          dto: { providerId, modelId, name: 'My workflow' },
          registryData: providerRegistryService.lookupModel(providerId, modelId)
        }
      ])
      const [stored] = dbh.db.select().from(userModelTable).all()
      expect(stored.presetModelId).toBeNull()
      providerRegistryService.clearCache()
      const read = modelService.getByKey(providerId, modelId)
      expect(read).toMatchObject({
        name: 'My workflow',
        apiModelId: modelId,
        presetModelId: null,
        capabilities: ['image-generation'],
        supportsStreaming: false
      })
      expect(read.reasoning).toBeUndefined()
      expect(providerRegistryService.getImageGenerationSupport(providerId, modelId)).toEqual({
        modes: { generate: { supports: { seed: { type: 'text' } } } }
      })
    }
  )

  it('ignores an old catalog association while preserving saved display and user state', () => {
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'workflow-server::qwen-image-edit',
        providerId: 'workflow-server',
        modelId: 'qwen-image-edit',
        presetModelId: 'qwen-image-edit',
        name: 'My saved workflow',
        notes: 'Keep this',
        isEnabled: false,
        isHidden: true,
        orderKey: 'a0'
      })
      .run()
    expect(modelService.getByKey('workflow-server', 'qwen-image-edit')).toMatchObject({
      name: 'My saved workflow',
      notes: 'Keep this',
      isEnabled: false,
      isHidden: true,
      presetModelId: null,
      capabilities: ['image-generation'],
      inputModalities: ['text'],
      imageGeneration: { modes: { generate: { supports: { seed: { type: 'text' } } } } }
    })
  })

  it('persists imported capability uncertainty without losing vision, reasoning or user overrides', () => {
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'ace', presetProviderId: 'acedatacloud', name: 'Ace', orderKey: 'b0' })
      .run()
    const dto = {
      providerId: 'ace',
      modelId: 'claude-sonnet-5-5',
      name: 'claude-sonnet-5-5',
      capabilities: ['reasoning', 'image-recognition'] as const,
      inputModalities: ['text', 'image'] as const,
      endpointTypes: ['anthropic-messages'] as const,
      parameterSupport: { tools: { supported: null } }
    }
    modelService.create([
      {
        dto: {
          ...dto,
          capabilities: [...dto.capabilities],
          inputModalities: [...dto.inputModalities],
          endpointTypes: [...dto.endpointTypes]
        },
        registryData: providerRegistryService.lookupModel('ace', dto.modelId)
      }
    ])
    const row = dbh.db
      .select()
      .from(userModelTable)
      .all()
      .find((item) => item.providerId === 'ace')!
    expect(row.parameters?.tools).toEqual({ supported: null })
    expect(row.capabilities).toEqual(['reasoning', 'image-recognition'])
    providerRegistryService.clearCache()
    const model = modelService.getByKey('ace', dto.modelId)!
    expect(model.endpointTypes).toEqual(['anthropic-messages'])
    expect(model.capabilities).toEqual(['reasoning', 'image-recognition'])
    expect(isVisionModel(model)).toBe(true)
    expect(isFunctionCallingModel(model)).toBe(false)
    expect(canAttemptFunctionCallingModel(model)).toBe(true)
    expect(model.contextWindow).toBeUndefined()
    expect(model.pricing).toBeUndefined()
    const disabled = modelService.update('ace', dto.modelId, { capabilities: [] })
    expect(disabled.parameterSupport?.tools?.supported).toBe(false)
    expect(canAttemptFunctionCallingModel(disabled)).toBe(false)
    expect(modelService.getByKey('ace', dto.modelId)?.parameterSupport?.tools?.supported).toBe(false)
    const enabled = modelService.update('ace', dto.modelId, { capabilities: ['function-call'] })
    expect(enabled.parameterSupport?.tools?.supported).toBe(true)
    expect(canAttemptFunctionCallingModel(enabled)).toBe(true)
    modelService.create([
      {
        dto: { providerId: 'ace', modelId: 'manual-off', capabilities: [] },
        registryData: providerRegistryService.lookupModel('ace', 'manual-off')
      }
    ])
    expect(canAttemptFunctionCallingModel(modelService.getByKey('ace', 'manual-off')!)).toBe(false)
  })

  it('keeps catalog matching for ordinary providers', () => {
    const result = providerRegistryService.resolveModel({ id: 'openai', presetProviderId: 'openai' }, 'gpt-image-1')
    expect(result.presetModel?.id).toBe('gpt-image-1')
  })
})

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceExport } from '@test-mocks/main/DbService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq, inArray } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { appStateTable } from '@data/db/schemas/appState'
import { assistantTable } from '@data/db/schemas/assistant'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { assistantDataService } from '@data/services/AssistantService'
import { createUniqueModelId, type ModelCapability, MODEL_CAPABILITY } from '@shared/data/types/model'

const OFFICIAL_ASSISTANTS = [
  { id: '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1', name: 'Claude', modelId: 'claude-sonnet-4-5' },
  { id: '87bf2bd5-88c9-4ea7-984f-7c75d4e70244', name: 'ChatGPT', modelId: 'gpt-5-chat-latest' },
  { id: '984168e8-805e-4b43-9018-d4bd0f4c5515', name: 'Gemini', modelId: 'gemini-2-5-pro' },
  { id: 'a3b811bc-bd5c-4f55-9d73-18cb53ff404f', name: 'DeepSeek', modelId: 'deepseek-v3-flash' },
  { id: 'b76d4a0f-09a7-48e9-894f-681552a9bca3', name: 'Kimi', modelId: 'kimi-k2-0905-preview' },
  { id: 'c983559a-53fb-4a83-8142-d59c794681ff', name: 'Doubao', modelId: 'doubao-1-5-pro-32k' }
] as const

const OFFICIAL_ASSISTANT_IDS = OFFICIAL_ASSISTANTS.map(({ id }) => id)

describe('AssistantDataService CherryIN official assistants', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainDbServiceExport.dbService.withWriteTx.mockImplementation((fn) => dbh.db.transaction(fn))

    await dbh.db.insert(userProviderTable).values([
      {
        providerId: 'cherryin',
        presetProviderId: 'cherryin',
        name: 'CherryIN',
        isEnabled: true,
        orderKey: 'a0'
      },
      {
        providerId: 'openrouter',
        presetProviderId: 'openrouter',
        name: 'OpenRouter',
        isEnabled: true,
        orderKey: 'a1'
      }
    ])
  })

  async function seedModels(
    definitions: ReadonlyArray<{
      providerId?: string
      modelId: string
      isEnabled?: boolean
      isHidden?: boolean
      isDeprecated?: boolean
      capabilities?: ModelCapability[]
    }> = OFFICIAL_ASSISTANTS
  ) {
    await dbh.db.insert(userModelTable).values(
      definitions.map((definition, index) => {
        const providerId = definition.providerId ?? 'cherryin'
        return {
          id: createUniqueModelId(providerId, definition.modelId),
          providerId,
          modelId: definition.modelId,
          presetModelId: null,
          name: definition.modelId,
          capabilities: definition.capabilities ?? [],
          supportsStreaming: true,
          isEnabled: definition.isEnabled ?? true,
          isHidden: definition.isHidden ?? false,
          isDeprecated: definition.isDeprecated ?? false,
          orderKey: `a${index}`
        }
      })
    )
  }

  async function readOfficialRows() {
    return dbh.db
      .select()
      .from(assistantTable)
      .where(inArray(assistantTable.id, OFFICIAL_ASSISTANT_IDS))
      .orderBy(assistantTable.name)
  }

  it('maps all six brands to valid CherryIN chat models', async () => {
    await seedModels()

    const result = assistantDataService.initializeCherryInOfficialAssistants()
    const rows = await readOfficialRows()

    expect(result.createdAssistantIds).toHaveLength(6)
    expect(Object.fromEntries(rows.map((row) => [row.name, row.modelId]))).toEqual(
      Object.fromEntries(
        OFFICIAL_ASSISTANTS.map(({ name, modelId }) => [name, createUniqueModelId('cherryin', modelId)])
      )
    )
    expect(rows.every((row) => row.modelId?.startsWith('cherryin::'))).toBe(true)
    expect(rows.every((row) => row.prompt.includes('{{date}}') && row.prompt.includes('{{language}}'))).toBe(true)
  })

  it('never binds a DeepSeek assistant to an OpenRouter model, even when it is the global default', async () => {
    const openRouterModelId = createUniqueModelId('openrouter', 'deepseek-v3-flash')
    await seedModels([...OFFICIAL_ASSISTANTS, { providerId: 'openrouter', modelId: 'deepseek-v3-flash' }])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', openRouterModelId)

    assistantDataService.initializeCherryInOfficialAssistants()

    const [deepSeek] = await dbh.db
      .select({ modelId: assistantTable.modelId })
      .from(assistantTable)
      .where(eq(assistantTable.id, 'a3b811bc-bd5c-4f55-9d73-18cb53ff404f'))
    expect(deepSeek.modelId).toBe(createUniqueModelId('cherryin', 'deepseek-v3-flash'))
  })

  it('prefers a valid same-brand CherryIN global default', async () => {
    const defaultModelId = createUniqueModelId('cherryin', 'gpt-5-2-chat-latest')
    await seedModels([...OFFICIAL_ASSISTANTS, { modelId: 'gpt-5-2-chat-latest' }])
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', defaultModelId)

    assistantDataService.initializeCherryInOfficialAssistants()

    const [chatGpt] = await dbh.db
      .select({ modelId: assistantTable.modelId })
      .from(assistantTable)
      .where(eq(assistantTable.id, '87bf2bd5-88c9-4ea7-984f-7c75d4e70244'))
    expect(chatGpt.modelId).toBe(defaultModelId)
  })

  it('filters disabled, hidden, deprecated, and non-chat models', async () => {
    await seedModels([
      { modelId: 'claude-sonnet-disabled', isEnabled: false },
      { modelId: 'gpt-5-chat-latest', isHidden: true },
      { modelId: 'gemini-2-5-pro', isDeprecated: true },
      { modelId: 'deepseek-v3-flash', capabilities: [MODEL_CAPABILITY.EMBEDDING] },
      { modelId: 'kimi-k2-0905-preview' },
      { modelId: 'doubao-1-5-pro-32k' }
    ])

    assistantDataService.initializeCherryInOfficialAssistants()

    expect((await readOfficialRows()).map(({ name }) => name).sort()).toEqual(['Doubao', 'Kimi'])
  })

  it('is idempotent and does not overwrite user edits', async () => {
    await seedModels()
    assistantDataService.initializeCherryInOfficialAssistants()
    await dbh.db
      .update(assistantTable)
      .set({ name: 'My Claude', prompt: 'My custom prompt' })
      .where(eq(assistantTable.id, '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1'))

    const result = assistantDataService.initializeCherryInOfficialAssistants()
    const rows = await readOfficialRows()
    const claude = rows.find(({ id }) => id === '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1')

    expect(result.createdAssistantIds).toEqual([])
    expect(rows).toHaveLength(6)
    expect(claude).toMatchObject({ name: 'My Claude', prompt: 'My custom prompt' })
  })

  it('does not restore a soft-deleted assistant', async () => {
    await seedModels()
    assistantDataService.initializeCherryInOfficialAssistants()
    const deletedAt = Date.now()
    await dbh.db
      .update(assistantTable)
      .set({ deletedAt })
      .where(eq(assistantTable.id, '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1'))

    assistantDataService.initializeCherryInOfficialAssistants()

    const [claude] = await dbh.db
      .select()
      .from(assistantTable)
      .where(eq(assistantTable.id, '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1'))
    expect(claude.deletedAt).toBe(deletedAt)
    expect(await readOfficialRows()).toHaveLength(6)
  })

  it('does not recreate an assistant after permanent deletion', async () => {
    await seedModels()
    assistantDataService.initializeCherryInOfficialAssistants()
    await dbh.db.delete(assistantTable).where(eq(assistantTable.id, '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1'))

    assistantDataService.initializeCherryInOfficialAssistants()

    expect(await readOfficialRows()).toHaveLength(5)
    const [marker] = await dbh.db
      .select({ value: appStateTable.value })
      .from(appStateTable)
      .where(eq(appStateTable.key, 'assistantService:cherryInOfficialAssistants'))
    expect(marker.value).toMatchObject({ createdIds: expect.arrayContaining(OFFICIAL_ASSISTANT_IDS) })
  })

  it('skips only the brand whose CherryIN model is unavailable and fills it on a later successful setup', async () => {
    const withoutKimi = OFFICIAL_ASSISTANTS.filter(({ name }) => name !== 'Kimi')
    await seedModels(withoutKimi)

    assistantDataService.initializeCherryInOfficialAssistants()
    expect((await readOfficialRows()).map(({ name }) => name)).not.toContain('Kimi')

    await seedModels([{ modelId: 'kimi-k2-0905-preview' }])
    const result = assistantDataService.initializeCherryInOfficialAssistants()

    expect(result.createdAssistantIds).toEqual(['b76d4a0f-09a7-48e9-894f-681552a9bca3'])
    expect(await readOfficialRows()).toHaveLength(6)
  })

  it('rolls back every assistant when writing the completion marker fails', async () => {
    await seedModels()
    MockMainDbServiceExport.dbService.withWriteTx.mockImplementationOnce((fn) =>
      dbh.db.transaction((tx) => {
        const guardedTx = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === 'insert') {
              return (table: unknown) => {
                if (table === appStateTable) throw new Error('marker write failed')
                return target.insert(table as never)
              }
            }
            return Reflect.get(target, property, receiver)
          }
        })
        return fn(guardedTx)
      })
    )

    expect(() => assistantDataService.initializeCherryInOfficialAssistants()).toThrow('marker write failed')
    expect(await readOfficialRows()).toEqual([])
  })
})

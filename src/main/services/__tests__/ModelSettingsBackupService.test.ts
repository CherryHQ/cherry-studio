import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type * as ProviderRegistryServiceModule from '@data/services/ProviderRegistryService'
import {
  MODEL_SETTINGS_FORMAT,
  MODEL_SETTINGS_VERSION,
  type ModelSettingsDocument,
  ModelSettingsDocumentSchema
} from '@shared/types/modelSettingsBackup'

import { modelSettingsBackupService } from '../ModelSettingsBackupService'

const { dialogMock } = vi.hoisted(() => ({
  dialogMock: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() }
}))
vi.mock('electron', () => ({ dialog: dialogMock }))
vi.mock('@main/i18n', () => ({ t: (key: string) => key }))
// The preset registry is loaded from disk; these tests cover custom models, so a registry miss is returned.
vi.mock('@data/services/ProviderRegistryService', async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderRegistryServiceModule>()
  return {
    ...actual,
    providerRegistryService: { ...actual.providerRegistryService, lookupModel: vi.fn(() => undefined) }
  }
})

const relayProvider = (name: string) => ({
  providerId: 'relay',
  name,
  isEnabled: true,
  apiKeys: [{ id: 'key-1', key: 'sk-relay', isEnabled: true }]
})

const relayModel = (values: Record<string, unknown> = {}) => ({
  providerId: 'relay',
  modelId: 'gpt',
  name: 'GPT',
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  ...values
})

const document = (
  providers: ModelSettingsDocument['providers'],
  models: ModelSettingsDocument['models'] = []
): ModelSettingsDocument => ({
  format: MODEL_SETTINGS_FORMAT,
  version: MODEL_SETTINGS_VERSION,
  exportedAt: 0,
  providers,
  models
})

describe('ModelSettingsBackupService', () => {
  const dbh = setupTestDatabase()
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'model-settings-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  const seedRelay = () => {
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'relay',
        name: 'Relay',
        isEnabled: true,
        apiKeys: [{ id: 'key-1', key: 'sk-relay', isEnabled: true }],
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'relay::gpt',
        providerId: 'relay',
        modelId: 'gpt',
        name: 'GPT',
        capabilities: [],
        supportsStreaming: true,
        isHidden: true,
        orderKey: 'a0'
      })
      .run()
  }

  it('exports user providers and their models, never Cherry-managed providers', async () => {
    seedRelay()
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'cherryai', name: 'CherryAI', isEnabled: true, orderKey: 'a1' })
      .run()
    const filePath = path.join(workDir, 'export.json')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })

    await modelSettingsBackupService.exportToFile()

    const exported = ModelSettingsDocumentSchema.parse(JSON.parse(readFileSync(filePath, 'utf-8')))
    expect(exported.providers.map((provider) => provider.providerId)).toEqual(['relay'])
    expect(exported.models.map((model) => `${model.providerId}::${model.modelId}`)).toEqual(['relay::gpt'])
    expect(exported.providers[0].apiKeys).toEqual([{ id: 'key-1', key: 'sk-relay', isEnabled: true }])
  })

  it('restores providers, API keys, and hidden model state into an empty database', async () => {
    seedRelay()
    const filePath = path.join(workDir, 'export.json')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    await modelSettingsBackupService.exportToFile()
    const exported = JSON.parse(readFileSync(filePath, 'utf-8')) as ModelSettingsDocument
    dbh.db.delete(userModelTable).run()
    dbh.db.delete(userProviderTable).run()

    const result = modelSettingsBackupService.applyImport(exported, {})

    expect(result).toEqual({ created: 2, replaced: 0, skipped: 0, failed: [] })
    const [provider] = dbh.db.select().from(userProviderTable).all()
    expect(provider.apiKeys).toEqual([{ id: 'key-1', key: 'sk-relay', isEnabled: true }])
    const [model] = dbh.db.select().from(userModelTable).all()
    expect(model).toMatchObject({ id: 'relay::gpt', isHidden: true })
  })

  it('reports conflicts at preview and leaves rows unchanged unless replaced', async () => {
    seedRelay()
    const filePath = path.join(workDir, 'import.json')
    writeFileSync(filePath, JSON.stringify(document([relayProvider('Remote')], [relayModel()])))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })

    const preview = await modelSettingsBackupService.pickImportFile()
    expect(preview?.conflicts.map((conflict) => conflict.key)).toEqual(['provider:relay', 'model:relay::gpt'])

    const skipped = modelSettingsBackupService.applyImport(preview!.document, {})
    expect(skipped).toMatchObject({ created: 0, replaced: 0, skipped: 2 })
    expect(dbh.db.select().from(userProviderTable).all()[0].name).toBe('Relay')

    const replaced = modelSettingsBackupService.applyImport(preview!.document, {
      'provider:relay': 'replace',
      'model:relay::gpt': 'replace'
    })
    expect(replaced).toMatchObject({ created: 0, replaced: 2, skipped: 0 })
    expect(dbh.db.select().from(userProviderTable).all()[0].name).toBe('Remote')
  })

  it('clears a nullable model limit that the replacing file omits', () => {
    seedRelay()
    dbh.db.update(userModelTable).set({ contextWindow: 8000 }).run()

    const result = modelSettingsBackupService.applyImport(document([relayProvider('Relay')], [relayModel()]), {
      'provider:relay': 'skip',
      'model:relay::gpt': 'replace'
    })

    expect(result.replaced).toBe(1)
    expect(dbh.db.select().from(userModelTable).all()[0].contextWindow).toBeNull()
  })

  it('keeps importing other items when one provider fails, and blocks only that provider’s models', () => {
    const result = modelSettingsBackupService.applyImport(
      document(
        [{ providerId: 'cherryai', name: 'CherryAI', isEnabled: false }, relayProvider('Relay')],
        [{ providerId: 'cherryai', modelId: 'qwen', isEnabled: true, isHidden: false }, relayModel()]
      ),
      {}
    )

    expect(result.created).toBe(2)
    expect(result.failed.map((failure) => [failure.kind, failure.id, failure.reason])).toEqual([
      ['provider', 'cherryai', expect.any(String)],
      ['model', 'cherryai::qwen', 'provider_not_imported']
    ])
    expect(
      dbh.db
        .select()
        .from(userProviderTable)
        .all()
        .map((row) => row.providerId)
    ).toEqual(['relay'])
  })
})

describe('ModelSettingsDocumentSchema', () => {
  it('rejects a file from another format or an unsupported version', () => {
    expect(ModelSettingsDocumentSchema.safeParse({ ...document([]), format: 'other' }).success).toBe(false)
    expect(ModelSettingsDocumentSchema.safeParse({ ...document([]), version: 2 }).success).toBe(false)
  })

  it('rejects unknown fields on a model item rather than dropping them silently', () => {
    const parsed = ModelSettingsDocumentSchema.safeParse(
      document([], [{ providerId: 'relay', modelId: 'gpt', chatHistory: [] } as never])
    )
    expect(parsed.success).toBe(false)
  })
})

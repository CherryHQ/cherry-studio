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

    const preview = await modelSettingsBackupService.pickImportFile('test-sender')
    expect(preview?.conflicts.map((conflict) => conflict.key)).toEqual(['provider:relay', 'model:relay::gpt'])

    const skipped = modelSettingsBackupService.applyPreview(preview!.handle, {}, 'test-sender')
    expect(skipped).toMatchObject({ created: 0, replaced: 0, skipped: 2 })
    expect(dbh.db.select().from(userProviderTable).all()[0].name).toBe('Relay')

    const nextPreview = await modelSettingsBackupService.pickImportFile('test-sender')
    const replaced = modelSettingsBackupService.applyPreview(
      nextPreview!.handle,
      {
        'provider:relay': 'replace',
        'model:relay::gpt': 'replace'
      },
      'test-sender'
    )
    expect(replaced).toMatchObject({ created: 0, replaced: 2, skipped: 0 })
    expect(dbh.db.select().from(userProviderTable).all()[0].name).toBe('Remote')
  })

  it.each(['newapi', 'gateway'] as const)('restores a migrated custom %s relay routing hint', async (adapterFamily) => {
    seedRelay()
    dbh.db
      .update(userProviderTable)
      .set({ endpointConfigs: { 'openai-chat-completions': { adapterFamily, baseUrl: 'https://relay.test/v1' } } })
      .run()
    const filePath = path.join(workDir, 'relay.json')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    await modelSettingsBackupService.exportToFile()
    const exported = ModelSettingsDocumentSchema.parse(JSON.parse(readFileSync(filePath, 'utf-8')))
    dbh.db.delete(userModelTable).run()
    dbh.db.delete(userProviderTable).run()
    expect(modelSettingsBackupService.applyImport(exported, {}).failed).toEqual([])
    const { providerService } = await import('@data/services/ProviderService')
    expect(providerService.getByProviderId('relay').endpointConfigs?.['openai-chat-completions']?.adapterFamily).toBe(
      adapterFamily
    )
  })

  it('keeps credentials in Main and binds single-use handles to the requesting sender', async () => {
    const filePath = path.join(workDir, 'private.json')
    writeFileSync(filePath, JSON.stringify(document([relayProvider('Remote')])))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    const preview = await modelSettingsBackupService.pickImportFile('owner')
    expect(preview).not.toHaveProperty('document')
    expect(JSON.stringify(preview)).not.toContain('sk-relay')
    expect(() => modelSettingsBackupService.applyPreview(preview!.handle, {}, 'other')).toThrow()
    expect(modelSettingsBackupService.applyPreview(preview!.handle, {}, 'owner').created).toBe(1)
    expect(() => modelSettingsBackupService.applyPreview(preview!.handle, {}, 'owner')).toThrow()
  })

  it('expires retained previews', async () => {
    const filePath = path.join(workDir, 'expired.json')
    writeFileSync(filePath, JSON.stringify(document([])))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    const preview = await modelSettingsBackupService.pickImportFile('owner')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    try {
      expect(() => modelSettingsBackupService.applyPreview(preview!.handle, {}, 'owner')).toThrow()
    } finally {
      clock.mockRestore()
    }
  })

  it('never exports notes, and Replace preserves local notes even if the file supplies them', async () => {
    seedRelay()
    dbh.db
      .update(userProviderTable)
      .set({ providerSettings: { notes: 'private local note' } })
      .run()
    const filePath = path.join(workDir, 'notes.json')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    await modelSettingsBackupService.exportToFile()
    expect(readFileSync(filePath, 'utf-8')).not.toContain('private local note')
    modelSettingsBackupService.applyImport(
      document([{ ...relayProvider('Remote'), providerSettings: { notes: 'incoming note' } }]),
      { 'provider:relay': 'replace' }
    )
    expect(dbh.db.select().from(userProviderTable).all()[0].providerSettings?.notes).toBe('private local note')
  })

  it.each([false, true])('round-trips the explicit-empty input modality distinction: %s', async (explicit) => {
    seedRelay()
    dbh.db.update(userModelTable).set({ inputModalities: [], inputModalitiesExplicit: explicit }).run()
    const filePath = path.join(workDir, 'modalities.json')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    await modelSettingsBackupService.exportToFile()
    const exported = ModelSettingsDocumentSchema.parse(JSON.parse(readFileSync(filePath, 'utf-8')))
    expect(exported.models[0].inputModalities).toEqual(explicit ? [] : null)
    dbh.db
      .update(userModelTable)
      .set({ inputModalities: ['text'], inputModalitiesExplicit: true })
      .run()
    modelSettingsBackupService.applyImport(exported, { 'model:relay::gpt': 'replace' })
    const row = dbh.db.select().from(userModelTable).all()[0]
    expect(row.inputModalitiesExplicit).toBe(explicit)
    expect(row.inputModalities).toEqual(explicit ? [] : null)
  })

  it('preserves an existing modality override when an older backup omits it', () => {
    seedRelay()
    dbh.db
      .update(userModelTable)
      .set({ inputModalities: ['image'], inputModalitiesExplicit: true })
      .run()
    modelSettingsBackupService.applyImport(document([], [relayModel()]), { 'model:relay::gpt': 'replace' })
    expect(dbh.db.select().from(userModelTable).all()[0]).toMatchObject({
      inputModalities: ['image'],
      inputModalitiesExplicit: true
    })
  })

  it('exports a historical preset explicit-empty override even when the migration flag is false', async () => {
    seedRelay()
    dbh.db
      .update(userModelTable)
      .set({ presetModelId: 'catalog-model', inputModalities: [], inputModalitiesExplicit: false })
      .run()
    const filePath = path.join(workDir, 'preset.json')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    await modelSettingsBackupService.exportToFile()
    expect(JSON.parse(readFileSync(filePath, 'utf-8')).models[0].inputModalities).toEqual([])
  })

  it('restores a standalone provider whose ID contains the composite separator', async () => {
    const filePath = path.join(workDir, 'standalone.json')
    writeFileSync(filePath, JSON.stringify(document([{ providerId: 'team::relay', name: 'Team Relay' }])))
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    const preview = await modelSettingsBackupService.pickImportFile('owner')
    expect(modelSettingsBackupService.applyPreview(preview!.handle, {}, 'owner').created).toBe(1)
    expect(dbh.db.select().from(userProviderTable).all()[0].providerId).toBe('team::relay')
  })

  it('drops unknown adapter hints with an item warning and imports unrelated settings', () => {
    const parsed = ModelSettingsDocumentSchema.parse(
      document(
        [
          {
            ...relayProvider('Relay'),
            endpointConfigs: {
              'openai-chat-completions': { adapterFamily: 'future-adapter', baseUrl: 'https://relay.test' }
            }
          }
        ],
        [relayModel()]
      )
    )
    const result = modelSettingsBackupService.applyImport(parsed, {})
    expect(result.created).toBe(2)
    expect(result.failed).toEqual([])
    expect(result.warnings).toEqual([{ kind: 'provider', id: 'relay', reason: 'adapter_family_dropped' }])
    expect(
      dbh.db.select().from(userProviderTable).all()[0].endpointConfigs?.['openai-chat-completions']?.adapterFamily
    ).toBeUndefined()
  })

  it('rejects every invalid ID before any provider write', () => {
    expect(() =>
      modelSettingsBackupService.applyImport(
        document([relayProvider('Remote')], [relayModel({ modelId: 'bad?route' })]),
        {}
      )
    ).toThrow()
    expect(dbh.db.select().from(userProviderTable).all()).toEqual([])
  })

  it('does not echo credential bytes from malformed JSON', async () => {
    const filePath = path.join(workDir, 'malformed.json')
    writeFileSync(filePath, '{"apiKeys": "sensitive-credential", broken')
    dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
    await expect(modelSettingsBackupService.pickImportFile('owner')).rejects.toThrow('Invalid model settings JSON')
  })

  it('rejects oversized exports before touching the destination', async () => {
    seedRelay()
    dbh.db
      .update(userProviderTable)
      .set({ name: 'x'.repeat(10 * 1024 * 1024) })
      .run()
    const filePath = path.join(workDir, 'too-large.json')
    writeFileSync(filePath, 'original')
    dialogMock.showSaveDialog.mockResolvedValue({ canceled: false, filePath })
    await expect(modelSettingsBackupService.exportToFile()).rejects.toThrow('10 MiB')
    expect(readFileSync(filePath, 'utf-8')).toBe('original')
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

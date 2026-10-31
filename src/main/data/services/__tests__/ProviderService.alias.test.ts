import '@data/services/ProviderRegistryService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { providerService } from '@data/services/ProviderService'
import { getProviderExportPayload } from '@main/features/apiGateway/providerExport'
import { ErrorCode } from '@shared/data/api/errors'

describe('provider aliases', () => {
  const dbh = setupTestDatabase()

  it('persists and clears an alias without changing model identity or display-name independence', () => {
    providerService.create({ providerId: 'custom-id', name: 'Company', alias: ' company-ai ' })
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'custom-id::model',
        providerId: 'custom-id',
        modelId: 'model',
        orderKey: 'a0',
        name: 'Model',
        supportsStreaming: true,
        capabilities: [],
        inputModalities: ['text'],
        outputModalities: ['text'],
        endpointTypes: ['openai-chat-completions']
      })
      .run()
    expect(providerService.getByProviderId('custom-id').alias).toBe('company-ai')
    providerService.update('custom-id', { name: 'Renamed' })
    expect(providerService.getByProviderId('custom-id')).toMatchObject({ name: 'Renamed', alias: 'company-ai' })
    providerService.update('custom-id', { alias: 'new-company' })
    expect(providerService.getByIdentifier('new-company').id).toBe('custom-id')
    expect(providerService.getByIdentifier('custom-id').id).toBe('custom-id')
    expect(() => providerService.getByIdentifier('company-ai')).toThrow()
    providerService.update('custom-id', { alias: '  ' })
    expect(providerService.getByProviderId('custom-id').alias).toBeUndefined()
    expect(dbh.db.select().from(userProviderTable).get()?.alias).toBeNull()
    expect(dbh.db.select().from(userModelTable).get()).toMatchObject({
      id: 'custom-id::model',
      providerId: 'custom-id'
    })
  })

  it('rejects duplicate aliases even for disabled providers and rolls back the entire patch', () => {
    providerService.create({ providerId: 'first', name: 'First', alias: 'company' })
    providerService.create({ providerId: 'second', name: 'Second', alias: 'other' })
    expect(() => providerService.update('second', { name: 'Not saved', alias: 'company' })).toThrowError(
      expect.objectContaining({ code: ErrorCode.CONFLICT })
    )
    expect(providerService.getByProviderId('second')).toMatchObject({ name: 'Second', alias: 'other' })
    expect(() => providerService.create({ providerId: 'third', name: 'Third', alias: 'company' })).toThrowError(
      expect.objectContaining({ code: ErrorCode.CONFLICT })
    )
    expect(dbh.db.select().from(userProviderTable).all()).toHaveLength(2)
  })

  it('rejects collisions between aliases and internal IDs in both directions', () => {
    providerService.create({ providerId: 'first', name: 'First', alias: 'company' })
    expect(() => providerService.create({ providerId: 'company', name: 'Second' })).toThrowError(
      expect.objectContaining({ code: ErrorCode.CONFLICT })
    )
    expect(() => providerService.create({ providerId: 'second', name: 'Second', alias: 'first' })).toThrowError(
      expect.objectContaining({ code: ErrorCode.CONFLICT })
    )
    expect(providerService.update('first', { alias: 'first' }).alias).toBe('first')
  })

  it('rejects batch identifier collisions atomically and preserves existing aliases on reseeding', () => {
    providerService.create({ providerId: 'first', name: 'First', alias: 'company' })
    expect(() =>
      providerService.batchUpsert([
        { providerId: 'second', name: 'Second' },
        { providerId: 'company', name: 'Collision' }
      ])
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CONFLICT }))
    expect(dbh.db.select().from(userProviderTable).all()).toHaveLength(1)
    expect(() =>
      providerService.batchUpsert([
        { providerId: 'second', name: 'Second', alias: 'third' },
        { providerId: 'third', name: 'Third' }
      ])
    ).toThrowError(expect.objectContaining({ code: ErrorCode.CONFLICT }))
    providerService.batchUpsert([{ providerId: 'first', name: 'Reseeded' }])
    expect(providerService.getByProviderId('first').alias).toBe('company')
  })

  it('exports aliases as metadata while keeping provider and model identity fields', () => {
    providerService.create({ providerId: 'custom-id', name: 'Company', alias: 'company-ai' })
    providerService.update('custom-id', { isEnabled: true })
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'custom-id::model',
        providerId: 'custom-id',
        modelId: 'model',
        name: 'Model',
        orderKey: 'a0',
        supportsStreaming: true,
        capabilities: [],
        inputModalities: ['text'],
        outputModalities: ['text'],
        endpointTypes: ['openai-chat-completions'],
        isEnabled: true
      })
      .run()
    expect(getProviderExportPayload().providers).toEqual([
      expect.objectContaining({
        id: 'custom-id',
        alias: 'company-ai',
        models: [expect.objectContaining({ id: 'custom-id::model', providerId: 'custom-id' })]
      })
    ])
  })

  it.each(['Company', 'company:ai', 'company/ai', 'a b', '公司', 'a?b', 'a#b'])(
    'rejects invalid alias %s in the service as well as the API',
    (alias) => {
      expect(() => providerService.create({ providerId: 'custom', name: 'Custom', alias })).toThrowError(
        expect.objectContaining({ code: ErrorCode.VALIDATION_ERROR })
      )
      expect(dbh.db.select().from(userProviderTable).all()).toHaveLength(0)
    }
  )

  it('keeps unset aliases nullable and enforces database uniqueness', () => {
    providerService.create({ providerId: 'first', name: 'First' })
    providerService.create({ providerId: 'second', name: 'Second', alias: null })
    providerService.update('first', { alias: 'company' })
    expect(() =>
      dbh.db.update(userProviderTable).set({ alias: 'company' }).where(eq(userProviderTable.providerId, 'second')).run()
    ).toThrow()
    expect(providerService.getByProviderId('second').alias).toBeUndefined()
  })
})

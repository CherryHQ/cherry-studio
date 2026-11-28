import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import type { FileProcessorOverrides } from '@shared/data/preference/preferenceTypes'

vi.unmock('@main/data/PreferenceService')
const key = 'feature.file_processing.overrides' as const

describe('atomic file processor option reset', () => {
  const dbh = setupTestDatabase()
  beforeEach(() => {
    BaseService.resetInstances()
    dbh.db.insert(preferenceTable).values({ scope: 'default', key, value: {} }).run()
  })

  it('keeps a newer credential save when reset starts before it finishes notifying', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    await service.set(key, {
      doc2x: { apiKeys: ['old'], capabilities: { document_to_markdown: { modelId: 'custom' } } }
    })
    const reset = service.resetFileProcessorOptions('doc2x')
    const saved: FileProcessorOverrides = {
      doc2x: { apiKeys: ['new'], capabilities: { document_to_markdown: { apiHost: 'https://new.example' } } },
      mistral: { apiKeys: ['other-new'] }
    }
    await service.set(key, saved)
    await reset
    expect(service.get(key)).toEqual(saved)
    expect(dbh.db.select().from(preferenceTable).where(eq(preferenceTable.key, key)).get()?.value).toEqual(saved)
  })

  it('retains keyed destinations including disabled hosts, but removes keyless options and hosts', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    await service.set(key, {
      doc2x: { apiKeys: ['saved'], capabilities: { document_to_markdown: { apiHost: '', modelId: 'custom' } } },
      'open-mineru': { capabilities: { document_to_markdown: { apiHost: 'https://keyless.example' } } }
    })
    await service.resetFileProcessorOptions('doc2x')
    await service.resetFileProcessorOptions('open-mineru')
    expect(service.get(key)).toEqual({
      doc2x: { apiKeys: ['saved'], capabilities: { document_to_markdown: { apiHost: '' } } }
    })
    await expect(service.resetFileProcessorOptions('unknown' as never)).rejects.toThrow()
  })

  it('applies a single-field edit to the current value, so a stale renderer map cannot revive reset options', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    await service.set(key, {
      doc2x: { apiKeys: ['saved'], capabilities: { document_to_markdown: { modelId: 'custom' } } }
    })
    await service.resetFileProcessorOptions('doc2x')
    await service.editFileProcessorOption('doc2x', {
      type: 'capability',
      feature: 'document_to_markdown',
      field: 'apiHost',
      value: 'https://edited.example'
    })
    await service.editFileProcessorOption('mistral', { type: 'apiKeys', apiKeys: ['m'] })
    await service.editFileProcessorOption('tesseract', { type: 'langs', langs: ['eng'] })
    expect(service.get(key)).toEqual({
      doc2x: { apiKeys: ['saved'], capabilities: { document_to_markdown: { apiHost: 'https://edited.example' } } },
      mistral: { apiKeys: ['m'] },
      tesseract: { options: { langs: ['eng'] } }
    })
    await expect(
      service.editFileProcessorOption('unknown' as never, { type: 'apiKeys', apiKeys: [] })
    ).rejects.toThrow()
  })
})

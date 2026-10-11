import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import { ListAssistantsQuerySchema } from '@shared/data/api/schemas/assistants'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'

describe('assistant post-commit read-model notifications', () => {
  const dbh = setupTestDatabase()
  let effects: DataApiDataChangeEffect[]
  let observedNames: string[]

  beforeEach(() => {
    effects = []
    observedNames = []
    vi.mocked(application.get('WindowManager').broadcast).mockImplementation((channel, payload) => {
      if (channel !== IpcChannel.DataApi_DataChanged) return
      expect(dbh.sqlite.inTransaction).toBe(false)
      effects.push(...(payload as DataApiDataChangeEffect[]))
      observedNames = assistantDataService.list(ListAssistantsQuerySchema.parse({})).items.map((item) => item.name)
    })
  })

  function assertPublished(id: string, kind: 'membership' | 'projection') {
    expect(effects).toContainEqual({ endpoint: '/assistants', kind, entityIds: [id] })
    expect(effects).toContainEqual({ endpoint: '/assistants/:id', entityIds: [id] })
  }

  it.each(['create', 'duplicate', 'import'] as const)('publishes committed membership after %s', (operation) => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    effects = []
    const created =
      operation === 'create'
        ? assistantDataService.create({ name: 'Added', modelId: null })
        : operation === 'duplicate'
          ? assistantDataService.duplicate(source.id, { name: 'Added' })
          : assistantDataService.createFromImport({
              name: 'Added',
              regularPhrases: [{ title: 'Phrase', content: 'Text' }]
            })
    assertPublished(created.id, 'membership')
    expect(observedNames).toContain('Added')
  })

  it('publishes committed projection after editing', () => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    effects = []
    assistantDataService.update(source.id, { name: 'Renamed', settings: { temperature: 0.3 } })
    assertPublished(source.id, 'projection')
    expect(observedNames).toContain('Renamed')
    expect(assistantDataService.getById(source.id).settings.temperature).toBe(0.3)
  })

  it.each(['single', 'batch'] as const)('publishes committed order after %s reorder', (operation) => {
    const first = assistantDataService.create({ name: 'First', modelId: null })
    const second = assistantDataService.create({ name: 'Second', modelId: null })
    effects = []
    if (operation === 'single') assistantDataService.reorder(second.id, { position: 'first' })
    else assistantDataService.reorderBatch([{ id: second.id, anchor: { before: first.id } }])
    assertPublished(second.id, 'projection')
    expect(observedNames).toEqual(['Second', 'First'])
  })

  it('does not publish unsuccessful or empty writes', () => {
    const source = assistantDataService.create({ name: 'Source', modelId: null })
    effects = []
    assistantDataService.update(source.id, {})
    assistantDataService.reorderBatch([])
    expect(() => assistantDataService.update(source.id, { name: 'Wrong', mcpServerIds: ['missing'] })).toThrow()
    expect(() => assistantDataService.create({ name: 'Wrong', mcpServerIds: ['missing'] })).toThrow()
    expect(() => assistantDataService.reorderBatch([{ id: source.id, anchor: { before: 'missing' } }])).toThrow()
    expect(effects).toEqual([])
    expect(assistantDataService.list(ListAssistantsQuerySchema.parse({})).items.map((item) => item.name)).toEqual([
      'Source'
    ])
  })
})

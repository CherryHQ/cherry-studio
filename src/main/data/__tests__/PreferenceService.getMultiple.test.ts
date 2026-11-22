import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'

vi.unmock('@main/data/PreferenceService')

describe('PreferenceService.getMultiple', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    BaseService.resetInstances()
    dbh.db
      .insert(preferenceTable)
      .values([
        { scope: 'default', key: 'app.language', value: 'zh-CN' },
        { scope: 'default', key: 'data.export.markdown.path', value: '/exports' },
        { scope: 'default', key: 'chat.default_model_id', value: 'openai::gpt-4' }
      ])
      .run()
  })

  it('retains reserved aliases as own properties without changing the alias map', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    const aliases = Object.freeze({
      ['__proto__']: 'app.language',
      constructor: 'data.export.markdown.path',
      toString: 'chat.default_model_id'
    } as const)

    try {
      const values = service.getMultiple(aliases)

      expect(values).toEqual({
        ['__proto__']: 'zh-CN',
        constructor: '/exports',
        toString: 'openai::gpt-4'
      })
      expect(Object.getOwnPropertyDescriptor(values, '__proto__')?.value).toBe('zh-CN')
      expect(Object.getPrototypeOf(values)).toBe(Object.prototype)
      expect(Object.getPrototypeOf(aliases)).toBe(Object.prototype)
    } finally {
      await service._doDestroy()
    }
  })
})

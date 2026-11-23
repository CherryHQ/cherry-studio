import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import { DefaultPreferences } from '@shared/data/preference/preferenceSchemas'

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

  it('uses only captured own aliases and reads alias getters once', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const service = new PreferenceService()
    await service._doInit()
    let reads = 0
    const aliases = Object.create(
      { inherited: 'ui.theme_mode' },
      {
        language: {
          enumerable: true,
          get: () => (++reads === 1 ? 'app.language' : 'ui.theme_mode')
        }
      }
    )

    try {
      expect(service.getMultiple(aliases)).toEqual({ language: 'zh-CN' })
      expect(reads).toBe(1)
    } finally {
      await service._doDestroy()
    }
  })

  it('ignores unregistered database keys and keeps generated defaults independent from cached values', async () => {
    const { PreferenceService } = await import('../PreferenceService')
    const defaultLanguage = DefaultPreferences.default['app.language']
    const invalidKeys = ['__proto__', 'constructor', 'toString', 'app.not_registered']
    dbh.db
      .insert(preferenceTable)
      .values(
        invalidKeys.map((key) => ({
          scope: 'default',
          key,
          value: { injected: true }
        }))
      )
      .run()
    const service = new PreferenceService()
    await service._doInit()

    try {
      expect(service.get('app.language')).toBe('zh-CN')
      await service.set('app.language', 'fr-FR')
      expect(service.get('app.language')).toBe('fr-FR')
      expect(DefaultPreferences.default['app.language']).toBe(defaultLanguage)
      const all = service.getAll()
      for (const key of invalidKeys) expect(Object.hasOwn(all, key)).toBe(false)
      expect(Object.getPrototypeOf(all)).toBe(Object.prototype)
    } finally {
      await service._doDestroy()
    }
  })
})

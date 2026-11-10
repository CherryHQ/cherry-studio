import fs from 'node:fs'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceTable } from '@data/db/schemas/preference'
import { BaseService } from '@main/core/lifecycle'
import { BOOT_CONFIG_PATH } from '@main/core/paths/constants'
import { BootConfigService, bootConfigService } from '@main/data/bootConfig'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'

import { PreferenceService } from '../PreferenceService'

vi.unmock('@main/data/PreferenceService')

vi.mock(import('@main/core/paths/constants'), async (importOriginal) => {
  const actual = await importOriginal()
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  return { ...actual, BOOT_CONFIG_PATH: join(mkdtempSync(join(tmpdir(), 'cs-preference-boot-')), 'boot-config.json') }
})

const CDP_KEY = 'BootConfig.app.remote_debugging.enabled' as const
const PORT_KEY = 'BootConfig.app.remote_debugging.port' as const
const DEVELOPER_KEY = 'app.developer_mode.enabled' as const
const TEMP_PATH = `${BOOT_CONFIG_PATH}.tmp`

describe('PreferenceService BootConfig persistence', () => {
  const dbh = setupTestDatabase()
  let service: PreferenceService

  beforeEach(async () => {
    BaseService.resetInstances()
    bootConfigService.reset()
    bootConfigService.set('app.remote_debugging.enabled', true)
    bootConfigService.set('app.remote_debugging.port', 9333)
    bootConfigService.persist()
    dbh.db.insert(preferenceTable).values({ scope: 'default', key: DEVELOPER_KEY, value: true }).run()
    service = new PreferenceService()
    await service._doInit()
  })

  afterEach(async () => {
    fs.rmSync(TEMP_PATH, { recursive: true, force: true })
    bootConfigService.persist()
    await service._doDestroy()
  })

  afterAll(() => {
    fs.rmSync(path.dirname(BOOT_CONFIG_PATH), { recursive: true, force: true })
  })

  function savedDeveloperMode() {
    return dbh.db
      .select()
      .from(preferenceTable)
      .all()
      .find((row) => row.key === DEVELOPER_KEY)?.value
  }

  it.each(['set', 'setMultiple'] as const)('%s saves before notifying and acknowledging success', async (method) => {
    const observed: Array<{ value: boolean; saved: boolean }> = []
    service.subscribeChange(CDP_KEY, (value) => {
      observed.push({ value, saved: new BootConfigService().get('app.remote_debugging.enabled') })
    })

    if (method === 'set') await service.set(CDP_KEY, false)
    else await service.setMultiple({ [CDP_KEY]: false, [PORT_KEY]: 9444 })

    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(false)
    expect(observed).toEqual([{ value: false, saved: false }])
    if (method === 'setMultiple') expect(new BootConfigService().get('app.remote_debugging.port')).toBe(9444)
  })

  it.each(['set', 'setMultiple'] as const)('%s rolls back failed writes and allows retry', async (method) => {
    const changes: boolean[] = []
    service.subscribeChange(CDP_KEY, (value) => changes.push(value))
    // A directory at the temporary file path causes a real filesystem write failure.
    fs.mkdirSync(TEMP_PATH)
    const disableDeveloperMode = async () => {
      if (method === 'set') {
        await service.set(CDP_KEY, false)
        await service.set(DEVELOPER_KEY, false)
      } else {
        await service.setMultiple({ [CDP_KEY]: false, [PORT_KEY]: 9444, [DEVELOPER_KEY]: false })
      }
    }

    await expect(disableDeveloperMode()).rejects.toThrow()
    expect(service.get(CDP_KEY)).toBe(true)
    expect(service.get(PORT_KEY)).toBe(9333)
    expect(service.get(DEVELOPER_KEY)).toBe(true)
    expect(savedDeveloperMode()).toBe(true)
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(true)
    expect(changes).toEqual([])

    fs.rmdirSync(TEMP_PATH)
    bootConfigService.flush()
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(true)
    await disableDeveloperMode()
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(false)
    expect(savedDeveloperMode()).toBe(false)
    expect(changes).toEqual([false])
  })

  it.each(['set', 'setMultiple'] as const)('%s persists an unchanged value that is still dirty', async (method) => {
    bootConfigService.set('app.remote_debugging.enabled', false)
    fs.mkdirSync(TEMP_PATH)
    const save = () => (method === 'set' ? service.set(CDP_KEY, false) : service.setMultiple({ [CDP_KEY]: false }))

    await expect(save()).rejects.toThrow()
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(true)
    fs.rmdirSync(TEMP_PATH)
    await save()
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(false)
  })

  it('rolls back earlier BootConfig changes when a later batch value is invalid', async () => {
    await expect(service.setMultiple({ [CDP_KEY]: false, [PORT_KEY]: 0, [DEVELOPER_KEY]: false })).rejects.toThrow(
      /Invalid boot config value/
    )
    expect(service.get(CDP_KEY)).toBe(true)
    expect(service.get(PORT_KEY)).toBe(9333)
    expect(savedDeveloperMode()).toBe(true)
    bootConfigService.flush()
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(true)
  })

  it('persists default values by removing the obsolete configuration file', async () => {
    bootConfigService.reset()
    bootConfigService.set('app.remote_debugging.enabled', true)
    bootConfigService.persist()

    await service.set(CDP_KEY, false)

    expect(fs.existsSync(BOOT_CONFIG_PATH)).toBe(false)
    expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(false)
  })

  it('merges public BootConfig values with SQLite preferences in reads', () => {
    expect(service.getAll()).toMatchObject({ [CDP_KEY]: true, [PORT_KEY]: 9333, [DEVELOPER_KEY]: true })
    expect(service.getMultipleRaw([CDP_KEY, DEVELOPER_KEY])).toEqual({ [CDP_KEY]: true, [DEVELOPER_KEY]: true })
    expect(service.getAll()).not.toHaveProperty('BootConfig.temp.user_data_relocation')
  })

  it.each(['BootConfig.temp.user_data_relocation', 'BootConfig.foo.does_not_exist'])(
    'rejects inaccessible key %s before any read, write or subscription',
    async (key) => {
      const invalidKey = key as UnifiedPreferenceKeyType
      expect(() => service.get(invalidKey)).toThrow(/not accessible/)
      expect(() => service.getMultipleRaw([CDP_KEY, invalidKey])).toThrow(/not accessible/)
      expect(() => service.subscribeForWindow(1, [CDP_KEY, key])).toThrow(/not accessible/)
      expect(service.getSubscriptions().size).toBe(0)
      await expect(service.set(invalidKey, false)).rejects.toThrow(/not accessible/)
      await expect(
        service.setMultiple({
          [CDP_KEY]: false,
          [key]: false,
          [DEVELOPER_KEY]: false
        })
      ).rejects.toThrow(/not accessible/)
      expect(service.get(CDP_KEY)).toBe(true)
      expect(savedDeveloperMode()).toBe(true)
      expect(new BootConfigService().get('app.remote_debugging.enabled')).toBe(true)
    }
  )
})

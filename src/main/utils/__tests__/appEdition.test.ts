import type * as NodeFs from 'node:fs'
import path from 'node:path'

import { APP_EDITIONS } from '@shared/types/appEdition'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import createChinaEditionConfig from '../../../../electron-builder.cn.config.cjs'

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  readFileSync: readFileSyncMock
}))

const setPackaged = (value: boolean) => {
  ;(app as { isPackaged: boolean }).isPackaged = value
}

const loadGetAppEdition = async () => (await import('../appEdition')).getAppEdition
const loadGetApplicationId = async () => (await import('../appEdition')).getApplicationId

describe('getAppEdition', () => {
  beforeEach(() => {
    vi.resetModules()
    readFileSyncMock.mockReset()
    setPackaged(false)
    vi.stubEnv('CHERRY_EDITION', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each([
    ['legacy package metadata', {}, 'global'],
    ['global package metadata', { cherryEdition: 'global' }, 'global'],
    ['China package metadata', { cherryEdition: 'cn' }, 'cn']
  ])('reads %s', async (_label, packageMetadata, expected) => {
    readFileSyncMock.mockReturnValue(JSON.stringify(packageMetadata))

    const getAppEdition = await loadGetAppEdition()
    expect(getAppEdition()).toBe(expected)
  })

  it('uses the development edition override', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'global' }))
    vi.stubEnv('CHERRY_EDITION', 'cn')

    const getAppEdition = await loadGetAppEdition()
    expect(getAppEdition()).toBe('cn')
  })

  it('ignores the development override in packaged builds', async () => {
    setPackaged(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'global' }))
    vi.stubEnv('CHERRY_EDITION', 'cn')

    const getAppEdition = await loadGetAppEdition()
    expect(getAppEdition()).toBe('global')
  })

  it('rejects an unsupported development edition', async () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'global' }))
    vi.stubEnv('CHERRY_EDITION', 'enterprise')

    const getAppEdition = await loadGetAppEdition()
    expect(() => getAppEdition()).toThrow('Unsupported application edition: enterprise')
  })

  it('rejects an unsupported package edition', async () => {
    setPackaged(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'enterprise' }))

    const getAppEdition = await loadGetAppEdition()
    expect(() => getAppEdition()).toThrow('Unsupported application edition: enterprise')
  })

  it('keeps runtime application IDs aligned with both packaging configurations', async () => {
    const actualFs = await vi.importActual<typeof NodeFs>('node:fs')
    const projectRoot = path.resolve(import.meta.dirname, '../../../..')
    const globalConfig = parse(actualFs.readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      appId: string
    }
    const chinaConfig = await createChinaEditionConfig({
      packageMetadata: { value: Promise.resolve({ version: '2.1.0' }) }
    })
    const applicationIds = {
      global: globalConfig.appId,
      cn: chinaConfig.appId
    }

    for (const edition of APP_EDITIONS) {
      vi.resetModules()
      setPackaged(true)
      readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: edition }))
      const getApplicationId = await loadGetApplicationId()

      expect(getApplicationId()).toBe(applicationIds[edition])
    }
  })
})

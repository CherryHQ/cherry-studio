import type * as NodeFs from 'node:fs'

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn()
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeFs>()),
  readFileSync: readFileSyncMock
}))

import { getAppEdition } from '../appEdition'

const setPackaged = (value: boolean) => {
  ;(app as { isPackaged: boolean }).isPackaged = value
}

describe('getAppEdition', () => {
  beforeEach(() => {
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
  ])('reads %s', (_label, packageMetadata, expected) => {
    readFileSyncMock.mockReturnValue(JSON.stringify(packageMetadata))

    expect(getAppEdition()).toBe(expected)
  })

  it('uses the development edition override', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'global' }))
    vi.stubEnv('CHERRY_EDITION', 'cn')

    expect(getAppEdition()).toBe('cn')
  })

  it('ignores the development override in packaged builds', () => {
    setPackaged(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'global' }))
    vi.stubEnv('CHERRY_EDITION', 'cn')

    expect(getAppEdition()).toBe('global')
  })

  it('rejects an unsupported development edition', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'global' }))
    vi.stubEnv('CHERRY_EDITION', 'enterprise')

    expect(() => getAppEdition()).toThrow('Unsupported application edition: enterprise')
  })

  it('rejects an unsupported package edition', () => {
    setPackaged(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ cherryEdition: 'enterprise' }))

    expect(() => getAppEdition()).toThrow('Unsupported application edition: enterprise')
  })
})

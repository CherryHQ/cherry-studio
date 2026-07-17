import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for src/main/core/preboot/factoryResetGate.ts
 *
 * Mocking strategy (mirrors userDataLocation.test.ts):
 *   - `vi.doMock` + `vi.resetModules()` + dynamic import of the module under
 *     test in each scenario.
 *   - The global `electron` mock from tests/main.setup.ts lacks the userData
 *     path we need; shadowed per test.
 *   - `node:fs` is shadowed with readdirSync/rmSync stubs backed by a fake
 *     directory listing.
 *   - `@main/core/paths/constants` is shadowed so CHERRY_HOME is a known fake
 *     path without evaluating the real module (which touches electron paths).
 *   - `@main/data/bootConfig` is mocked with a mutable store so set() affects
 *     subsequent get() calls.
 */

const USER_DATA = '/mock/userData'
const CHERRY_HOME = '/mock/cherry-home'

const rmSyncMock = vi.fn()
const readdirSyncMock = vi.fn()
const bootConfigGetMock = vi.fn()
const bootConfigSetMock = vi.fn()
const bootConfigFlushMock = vi.fn()

type FactoryResetMarker = { status: 'pending'; userDataPath: string; requestedAt: string } | null

function stubElectron() {
  vi.doMock('electron', () => ({
    __esModule: true,
    app: {
      getPath: vi.fn((key: string) => (key === 'userData' ? USER_DATA : '/mock/unknown'))
    }
  }))
}

function stubConstants() {
  vi.doMock('@main/core/paths/constants', () => ({
    CHERRY_HOME,
    CHERRY_HOME_DIRNAME: '.cherrystudio',
    BOOT_CONFIG_PATH: `${CHERRY_HOME}/boot-config.json`,
    LOGS_DIR: `${USER_DATA}/logs`
  }))
}

function stubBootConfig(marker: FactoryResetMarker) {
  const store: Record<string, unknown> = {
    'app.disable_hardware_acceleration': true,
    'app.user_data_path': { '/mock/exe': USER_DATA },
    'temp.factory_reset': marker,
    'temp.user_data_relocation': null
  }
  bootConfigGetMock.mockImplementation((key: string) => store[key])
  bootConfigSetMock.mockImplementation((key: string, value: unknown) => {
    store[key] = value
  })
  bootConfigFlushMock.mockImplementation(() => undefined)
  vi.doMock('@main/data/bootConfig', () => ({
    bootConfigService: {
      get: bootConfigGetMock,
      set: bootConfigSetMock,
      flush: bootConfigFlushMock
    }
  }))
  return store
}

function stubFs(listings: Record<string, string[] | Error>) {
  readdirSyncMock.mockImplementation((dir: string) => {
    const listing = listings[dir]
    if (listing === undefined) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${dir}'`) as NodeJS.ErrnoException
      error.code = 'ENOENT'
      throw error
    }
    if (listing instanceof Error) throw listing
    return [...listing]
  })
  rmSyncMock.mockImplementation(() => undefined)
  vi.doMock('node:fs', () => {
    const fsMock = { readdirSync: readdirSyncMock, rmSync: rmSyncMock }
    return { __esModule: true, default: fsMock, ...fsMock }
  })
}

async function importGate() {
  const module = await import('../factoryResetGate')
  return module.runFactoryResetGate
}

function rmTargets(): string[] {
  return rmSyncMock.mock.calls.map(([target]) => target as string)
}

describe('runFactoryResetGate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    stubElectron()
    stubConstants()
  })

  it('is a no-op when no marker is pending', async () => {
    stubBootConfig(null)
    stubFs({})

    const run = await importGate()
    run()

    expect(readdirSyncMock).not.toHaveBeenCalled()
    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(bootConfigSetMock).not.toHaveBeenCalled()
  })

  it('clears the marker without wiping when it belongs to another userData directory', async () => {
    const store = stubBootConfig({
      status: 'pending',
      userDataPath: '/other/instance/userData',
      requestedAt: '2026-07-17T00:00:00.000Z'
    })
    stubFs({ [USER_DATA]: ['cherrystudio.sqlite'] })

    const run = await importGate()
    run()

    expect(rmSyncMock).not.toHaveBeenCalled()
    expect(store['temp.factory_reset']).toBeNull()
    // Only the marker is touched — the other instance's settings stay.
    expect(store['app.disable_hardware_acceleration']).toBe(true)
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })

  it('wipes userData (except logs/) and CHERRY_HOME user state, then resets BootConfig keeping app.user_data_path', async () => {
    const store = stubBootConfig({
      status: 'pending',
      userDataPath: USER_DATA,
      requestedAt: '2026-07-17T00:00:00.000Z'
    })
    stubFs({
      [USER_DATA]: ['cherrystudio.sqlite', 'cherrystudio.sqlite-wal', 'Data', 'cache.json', 'Local Storage', 'logs'],
      [CHERRY_HOME]: ['bin', 'binary-manager', 'config', 'mcp', 'trace', 'boot-config.json']
    })

    const run = await importGate()
    run()

    const targets = rmTargets()
    expect(targets).toContain(`${USER_DATA}/cherrystudio.sqlite`)
    expect(targets).toContain(`${USER_DATA}/cherrystudio.sqlite-wal`)
    expect(targets).toContain(`${USER_DATA}/Data`)
    expect(targets).toContain(`${USER_DATA}/cache.json`)
    expect(targets).toContain(`${USER_DATA}/Local Storage`)
    expect(targets).not.toContain(`${USER_DATA}/logs`)

    expect(targets).toContain(`${CHERRY_HOME}/config`)
    expect(targets).toContain(`${CHERRY_HOME}/mcp`)
    expect(targets).toContain(`${CHERRY_HOME}/trace`)
    expect(targets).not.toContain(`${CHERRY_HOME}/bin`)
    expect(targets).not.toContain(`${CHERRY_HOME}/binary-manager`)
    expect(targets).not.toContain(`${CHERRY_HOME}/boot-config.json`)

    expect(store['temp.factory_reset']).toBeNull()
    expect(store['app.disable_hardware_acceleration']).toBe(false)
    expect(store['app.user_data_path']).toEqual({ '/mock/exe': USER_DATA })
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })

  it('continues the pass and still clears the marker when one entry fails to delete', async () => {
    const store = stubBootConfig({
      status: 'pending',
      userDataPath: USER_DATA,
      requestedAt: '2026-07-17T00:00:00.000Z'
    })
    stubFs({
      [USER_DATA]: ['Crashpad', 'cherrystudio.sqlite'],
      [CHERRY_HOME]: ['config']
    })
    rmSyncMock.mockImplementation((target: string) => {
      if (target === `${USER_DATA}/Crashpad`) throw new Error('EBUSY: resource busy or locked')
    })

    const run = await importGate()
    run()

    expect(rmTargets()).toContain(`${USER_DATA}/cherrystudio.sqlite`)
    expect(rmTargets()).toContain(`${CHERRY_HOME}/config`)
    expect(store['temp.factory_reset']).toBeNull()
  })

  it('still resets BootConfig when CHERRY_HOME does not exist', async () => {
    const store = stubBootConfig({
      status: 'pending',
      userDataPath: USER_DATA,
      requestedAt: '2026-07-17T00:00:00.000Z'
    })
    // CHERRY_HOME missing from listings → readdirSync throws ENOENT.
    stubFs({ [USER_DATA]: ['cherrystudio.sqlite'] })

    const run = await importGate()
    run()

    expect(rmTargets()).toContain(`${USER_DATA}/cherrystudio.sqlite`)
    expect(store['temp.factory_reset']).toBeNull()
    expect(bootConfigFlushMock).toHaveBeenCalled()
  })
})

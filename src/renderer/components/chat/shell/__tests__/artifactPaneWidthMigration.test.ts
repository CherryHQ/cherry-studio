import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARTIFACT_PANE_WIDTH_CURRENT_VERSION,
  migrateArtifactPaneWidthDefault,
  migrateLoadedArtifactPaneWidth
} from '../artifactPaneWidthMigration'

vi.unmock('@data/CacheService')

const STORAGE_PERSIST_KEY = 'cs_cache_persist'
const WIDTH_KEY = 'ui.chat.artifact_pane.width'
const VERSION_KEY = 'ui.chat.artifact_pane.width_version'

function createPaneWidthCache(width: number, version: number) {
  const store: Record<string, number> = {
    [WIDTH_KEY]: width,
    [VERSION_KEY]: version
  }
  return {
    store,
    getPersist: (key: typeof WIDTH_KEY | typeof VERSION_KEY) => store[key],
    setPersist: (key: typeof WIDTH_KEY | typeof VERSION_KEY, value: number) => {
      store[key] = value
    }
  }
}

describe('migrateArtifactPaneWidthDefault', () => {
  it('moves an unmarked historical 460 px default to 280 px and stamps the version', () => {
    const stored = { [WIDTH_KEY]: 460 }

    expect(migrateArtifactPaneWidthDefault(stored)).toBe(true)
    expect(stored[WIDTH_KEY]).toBe(280)
    expect(stored[VERSION_KEY]).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })

  it('moves a CacheService-seeded unmigrated 460 px width to 280 px', () => {
    const stored = { [WIDTH_KEY]: 460, [VERSION_KEY]: 0 }

    expect(migrateArtifactPaneWidthDefault(stored)).toBe(true)
    expect(stored[WIDTH_KEY]).toBe(280)
    expect(stored[VERSION_KEY]).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })

  it('stamps the version without replacing a distinct saved width', () => {
    const stored = { [WIDTH_KEY]: 500 }

    expect(migrateArtifactPaneWidthDefault(stored)).toBe(true)
    expect(stored[WIDTH_KEY]).toBe(500)
    expect(stored[VERSION_KEY]).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })

  it('leaves an already-stamped 460 px width in place', () => {
    const stored = {
      [WIDTH_KEY]: 460,
      [VERSION_KEY]: ARTIFACT_PANE_WIDTH_CURRENT_VERSION
    }

    expect(migrateArtifactPaneWidthDefault(stored)).toBe(false)
    expect(stored[WIDTH_KEY]).toBe(460)
    expect(stored[VERSION_KEY]).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })
})

describe('migrateLoadedArtifactPaneWidth', () => {
  it('rewrites an unmigrated 460 px persist value before the pane snapshot', () => {
    const cache = createPaneWidthCache(460, 0)

    migrateLoadedArtifactPaneWidth(cache)

    expect(cache.store[WIDTH_KEY]).toBe(280)
    expect(cache.store[VERSION_KEY]).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })

  it('is a no-op for an already-stamped 460 px persist value', () => {
    const cache = createPaneWidthCache(460, ARTIFACT_PANE_WIDTH_CURRENT_VERSION)

    migrateLoadedArtifactPaneWidth(cache)

    expect(cache.store[WIDTH_KEY]).toBe(460)
    expect(cache.store[VERSION_KEY]).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })
})

describe('artifact pane width default transition through CacheService', () => {
  const broadcastSync = vi.fn()
  const onSync = vi.fn()
  const getAllShared = vi.fn(async () => ({}))
  const createdServices: Array<{ cleanup: () => void }> = []

  beforeEach(() => {
    localStorage.clear()
    broadcastSync.mockClear()
    onSync.mockClear()
    getAllShared.mockClear()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        cache: {
          broadcastSync,
          onSync,
          getAllShared
        }
      }
    })
  })

  afterEach(() => {
    createdServices.forEach((service) => service.cleanup())
    createdServices.length = 0
    localStorage.clear()
    vi.restoreAllMocks()
  })

  async function createServiceWithPersistedCache(data: Record<string, unknown>) {
    const { CacheService } = await import('@data/CacheService')
    localStorage.setItem(STORAGE_PERSIST_KEY, JSON.stringify(data))
    const service = new CacheService()
    createdServices.push(service)
    return service
  }

  it('migrates unmarked 460 px after persist load without changing CacheService', async () => {
    const service = await createServiceWithPersistedCache({ [WIDTH_KEY]: 460 })
    expect(service.getPersist(WIDTH_KEY)).toBe(460)

    migrateLoadedArtifactPaneWidth(service)

    expect(service.getPersist(WIDTH_KEY)).toBe(280)
    expect(service.getPersist(VERSION_KEY)).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })

  it('records the transition without replacing a distinct saved width', async () => {
    const service = await createServiceWithPersistedCache({ [WIDTH_KEY]: 500 })

    migrateLoadedArtifactPaneWidth(service)

    expect(service.getPersist(WIDTH_KEY)).toBe(500)
    expect(service.getPersist(VERSION_KEY)).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })

  it('preserves an explicit 460 px resize after the transition has run', async () => {
    const migratedService = await createServiceWithPersistedCache({ [WIDTH_KEY]: 460 })
    migrateLoadedArtifactPaneWidth(migratedService)
    migratedService.setPersist(WIDTH_KEY, 460)
    migratedService.cleanup()

    const { CacheService } = await import('@data/CacheService')
    const restartedService = new CacheService()
    createdServices.push(restartedService)
    migrateLoadedArtifactPaneWidth(restartedService)

    expect(restartedService.getPersist(WIDTH_KEY)).toBe(460)
    expect(restartedService.getPersist(VERSION_KEY)).toBe(ARTIFACT_PANE_WIDTH_CURRENT_VERSION)
  })
})

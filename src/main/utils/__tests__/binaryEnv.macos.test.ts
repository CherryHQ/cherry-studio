import type * as NodePath from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { getBinaryExecutionEnv, getBinaryIsolatedHomeEnv, mergeBinaryExecutionEnv } from '../binaryEnv'

vi.mock('path', async () => {
  const actual = await vi.importActual<typeof NodePath>('node:path')
  return { ...actual.posix, default: actual.posix }
})

vi.mock('@main/core/platform', () => ({ isWin: false, isLinux: false, isMac: true, isDev: false, isPortable: false }))

describe('isolated uv cache (macOS)', () => {
  const spacedHome = {
    HOME: '/Users/test/Library/Application Support/CherryStudio/Toolchain/mise/home',
    XDG_CONFIG_HOME: '/Users/test/Library/Application Support/CherryStudio/Toolchain/mise/xdg/config',
    XDG_CACHE_HOME: '/Users/test/Library/Application Support/CherryStudio/Toolchain/mise/xdg/cache',
    XDG_STATE_HOME: '/Users/test/Library/Application Support/CherryStudio/Toolchain/mise/xdg/state'
  }
  let dataDir: string
  let uvCacheDir: string
  const getPath = vi.mocked(application.getPath).getMockImplementation()!

  beforeEach(() => {
    dataDir = '/Users/test/Library/Application Support/CherryStudio/Toolchain/mise'
    uvCacheDir = '/Users/test/.cherrystudio/cache/uv/profile-digest'
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      if (key === 'feature.binary.data') return dataDir
      if (key === 'feature.binary.data.uv_cache') return uvCacheDir
      return getPath(key, filename)
    })
  })

  afterEach(() => {
    vi.mocked(application.getPath).mockImplementation(getPath)
  })

  it('selects the registered space-free cache for Application Support without changing HOME/XDG', () => {
    expect(getBinaryIsolatedHomeEnv()).toEqual({ ...spacedHome, UV_CACHE_DIR: uvCacheDir })
  })

  it.each(['/Users/test/.cherrystudio/cache/uv/profile-digest', '/Users/Dev Oslo/.cherrystudio/cache/uv/digest'])(
    'keeps the space-free source environment byte-identical with candidate %s',
    (candidate) => {
      dataDir = '/profiles/cherry/Toolchain/mise'
      uvCacheDir = candidate

      expect(getBinaryIsolatedHomeEnv()).toEqual({
        HOME: '/profiles/cherry/Toolchain/mise/home',
        XDG_CONFIG_HOME: '/profiles/cherry/Toolchain/mise/xdg/config',
        XDG_CACHE_HOME: '/profiles/cherry/Toolchain/mise/xdg/cache',
        XDG_STATE_HOME: '/profiles/cherry/Toolchain/mise/xdg/state'
      })
      expect(getBinaryIsolatedHomeEnv()).not.toHaveProperty('UV_CACHE_DIR')
    }
  )

  it.each([' ', '\t', '\u00a0'])(
    'keeps HOME/XDG unchanged without throwing when the candidate contains %j',
    (space) => {
      uvCacheDir = `/profiles/Dev${space}Oslo/.cherrystudio/cache/uv/digest`

      expect(getBinaryIsolatedHomeEnv()).toEqual(spacedHome)
      expect(getBinaryIsolatedHomeEnv()).not.toHaveProperty('UV_CACHE_DIR')
    }
  )

  it('does not inject the cache into installed-tool execution under the spaced macOS profile', () => {
    expect(getBinaryExecutionEnv()).not.toHaveProperty('UV_CACHE_DIR')
    expect(mergeBinaryExecutionEnv({ PATH: '/usr/bin' })).not.toHaveProperty('UV_CACHE_DIR')
  })

  it('preserves the caller cache when merging an execution environment under the spaced macOS profile', () => {
    const env = mergeBinaryExecutionEnv({ PATH: '/usr/bin', UV_CACHE_DIR: '/caller/cache with spaces' })

    expect(env.UV_CACHE_DIR).toBe('/caller/cache with spaces')
  })
})

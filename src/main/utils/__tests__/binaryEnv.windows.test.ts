import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pin the Windows code path so we exercise mergeBinaryExecutionEnv's
// case-insensitive PATH dedup (the `.toLowerCase()` branch), which the
// host-platform run in binaryEnv.test.ts (isWin=false) cannot reach.
vi.mock('@main/core/platform', () => ({
  isWin: true,
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false
}))

vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => {
      if (key === 'feature.binary.data') return 'C:\\data\\binary-manager'
      if (key === 'cherry.bin') return 'C:\\data\\bin'
      return `/mock/${key}`
    }
  }
}))

vi.mock('path')

import { mergeBinaryExecutionEnv } from '../binaryEnv'

describe('mergeBinaryExecutionEnv (Windows)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(path.join).mockImplementation((...args) => args.join('\\'))
    vi.mocked(path.normalize).mockImplementation((p) => p)
  })

  it('dedups PATH segments case-insensitively and keeps the prepended shims dir first', () => {
    // Windows paths are case-insensitive, so a differently-cased duplicate of the
    // shims dir (and of any system dir) must collapse to one — first occurrence wins.
    const shims = 'C:\\data\\binary-manager\\shims'
    const { Path } = mergeBinaryExecutionEnv({
      Path: 'c:\\data\\binary-manager\\SHIMS;C:\\Windows;c:\\windows'
    })

    const segments = Path.split(';')
    expect(segments[0]).toBe(shims) // prepended copy wins, later cased duplicate dropped
    expect(segments.filter((s) => s.toLowerCase() === shims.toLowerCase())).toHaveLength(1)
    expect(segments.filter((s) => s.toLowerCase() === 'c:\\windows')).toHaveLength(1)
  })
})

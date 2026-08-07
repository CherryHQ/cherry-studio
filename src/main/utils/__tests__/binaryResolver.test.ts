import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBinaryName, getBinaryPath } from '../binaryResolver'

vi.mock('fs')
vi.mock('path')

describe('getBinaryPath', () => {
  // The global '@application' mock resolves 'cherry.bin' to '/mock/cherry.bin'
  // and 'feature.binary.data' to '/mock/feature.binary.data'. getBinaryPath
  // searches mise shims first, then the bundled cherry.bin fallback.
  const binDir = '/mock/cherry.bin'
  const shimsDir = '/mock/feature.binary.data/shims'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'))
  })

  it('returns the cherry bin directory when no name is given', async () => {
    const result = await getBinaryPath()
    expect(result).toBe(binDir)
  })

  it('returns the mise shim path when that binary exists, preferring it over cherry.bin', async () => {
    const binaryName = getBinaryName('bun')
    vi.mocked(fs.existsSync).mockReturnValue(true)

    const result = await getBinaryPath('bun')

    // Shims are searched first, so a user-installed copy wins over the bundled one.
    expect(result).toBe(`${shimsDir}/${binaryName}`)
    expect(fs.existsSync).toHaveBeenCalledWith(`${shimsDir}/${binaryName}`)
  })

  it('falls back to the cherry.bin path when the binary exists only there', async () => {
    const binaryName = getBinaryName('bun')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === `${binDir}/${binaryName}`)

    const result = await getBinaryPath('bun')

    expect(result).toBe(`${binDir}/${binaryName}`)
  })

  it('falls back to the bare name (resolved via system PATH) when the binary is absent', async () => {
    const binaryName = getBinaryName('bun')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = await getBinaryPath('bun')

    expect(result).toBe(binaryName)
  })
})

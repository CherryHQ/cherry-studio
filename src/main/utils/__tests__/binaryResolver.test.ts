import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBinaryName, getBinaryPath } from '../binaryResolver'

vi.mock('fs')

describe('getBinaryPath', () => {
  const binDir = path.resolve('/mock/cherry.bin')
  const shimsDir = path.resolve('/mock/feature.binary.data/shims')

  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(result).toBe(path.join(shimsDir, binaryName))
  })

  it('falls back to the cherry.bin path when the binary exists only there', async () => {
    const binaryName = getBinaryName('bun')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === path.join(binDir, binaryName))

    const result = await getBinaryPath('bun')

    expect(result).toBe(path.join(binDir, binaryName))
  })

  it('falls back to the bare name (resolved via system PATH) when the binary is absent', async () => {
    const binaryName = getBinaryName('bun')
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = await getBinaryPath('bun')

    expect(result).toBe(binaryName)
  })
})

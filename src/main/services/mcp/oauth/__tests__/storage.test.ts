import { safeStorage } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { JsonFileStorage } from '../storage'

vi.mock('fs/promises', () => {
  const api = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn()
  }
  return { default: api, ...api }
})

describe('MCP OAuth JsonFileStorage', () => {
  const configDir = '/mock/config'
  const serverUrlHash = 'serverHash'
  const filePath = path.join(configDir, `${serverUrlHash}_oauth.json`)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
  })

  it('migrates legacy plaintext JSON to encrypted storage when available', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from(JSON.stringify({ lastUpdated: 1 }), 'utf-8'))
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    vi.mocked(fs.chmod).mockResolvedValue(undefined)

    const ciphertext = Buffer.from('ciphertext', 'utf-8')
    vi.mocked(safeStorage.encryptString).mockReturnValue(ciphertext)
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('Unable to decrypt')
    })

    const storage = new JsonFileStorage(serverUrlHash, configDir)
    await storage.getTokens()

    expect(fs.writeFile).toHaveBeenCalledWith(`${filePath}.tmp`, ciphertext)
    expect(fs.rename).toHaveBeenCalledWith(`${filePath}.tmp`, filePath)
    expect(fs.chmod).toHaveBeenCalledWith(filePath, 0o600)
  })

  it('quarantines unreadable storage and resets to an empty state', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('not-json', 'utf-8'))
    vi.mocked(fs.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rename).mockResolvedValue(undefined)
    vi.mocked(fs.chmod).mockResolvedValue(undefined)
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('Key unavailable')
    })

    const storage = new JsonFileStorage(serverUrlHash, configDir)
    await expect(storage.getTokens()).resolves.toBeUndefined()

    expect(fs.rename).toHaveBeenCalledWith(filePath, expect.stringContaining(`${filePath}.unreadable.`))
    expect(fs.writeFile).toHaveBeenCalled()
  })
})

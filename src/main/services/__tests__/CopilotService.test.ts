import { net, safeStorage } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => false),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    chmod: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn()
  }
}))

vi.mock('fs', () => ({ default: fsMock, ...fsMock }))

import copilotService from '../CopilotService'

describe('CopilotService token storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    vi.mocked(fsMock.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(fsMock.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(fsMock.promises.chmod).mockResolvedValue(undefined)
    vi.mocked(fsMock.promises.unlink).mockResolvedValue(undefined)
    vi.mocked(net.fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ token: 'copilot-token' })
    } as any)
  })

  it('saves Copilot token encrypted when safeStorage is available', async () => {
    const ciphertext = Buffer.from('ciphertext', 'utf-8')
    vi.mocked(safeStorage.encryptString).mockReturnValue(ciphertext)

    await copilotService.saveCopilotToken({} as any, 'ghp_abcdefghijklmnopqrstuvwxyz1234567890')

    expect(fsMock.promises.writeFile).toHaveBeenCalledWith(expect.stringContaining('.copilot_token'), ciphertext)
    expect(fsMock.promises.chmod).toHaveBeenCalledWith(expect.stringContaining('.copilot_token'), 0o600)
  })

  it('reads encrypted Copilot token and uses it for authorization', async () => {
    vi.mocked(fsMock.promises.readFile).mockResolvedValue(Buffer.from('encrypted:anything', 'utf-8'))
    vi.mocked(safeStorage.decryptString).mockReturnValue('ghp_abcdefghijklmnopqrstuvwxyz1234567890')

    await copilotService.getToken({} as any)

    expect(net.fetch).toHaveBeenCalledWith(
      expect.stringContaining('copilot_internal'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'token ghp_abcdefghijklmnopqrstuvwxyz1234567890'
        })
      })
    )
  })

  it('falls back to legacy plaintext token and migrates it to encrypted storage', async () => {
    const legacyToken = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'
    vi.mocked(fsMock.promises.readFile).mockResolvedValue(Buffer.from(legacyToken, 'utf-8'))
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('Unable to decrypt')
    })

    const ciphertext = Buffer.from('ciphertext', 'utf-8')
    vi.mocked(safeStorage.encryptString).mockReturnValue(ciphertext)

    await copilotService.getToken({} as any)

    expect(fsMock.promises.writeFile).toHaveBeenCalledWith(expect.stringContaining('.copilot_token'), ciphertext)
  })

  it('clears unreadable token files when decryption fails and plaintext fallback is invalid', async () => {
    vi.mocked(fsMock.promises.readFile).mockResolvedValue(Buffer.from('not a token', 'utf-8'))
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('Key unavailable')
    })

    await expect(copilotService.getToken({} as any)).rejects.toThrow('无法获取Copilot令牌')
    expect(fsMock.promises.unlink).toHaveBeenCalledWith(expect.stringContaining('.copilot_token'))
  })
})

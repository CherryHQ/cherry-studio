import type { AbsoluteFilePath } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  getFileIcon: vi.fn()
}))

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:util', () => ({ promisify: () => mocks.execFileAsync }))

vi.mock('@main/core/platform', () => ({ isLinux: false, isMac: false, isWin: true }))

vi.mock('electron', () => ({
  app: { getFileIcon: mocks.getFileIcon }
}))

describe('resolveDefaultApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFileIcon.mockResolvedValue({ isEmpty: () => true })
  })

  it('preserves localized application names across the PowerShell output boundary', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: `${Buffer.from('写字板', 'utf8').toString('base64')}\n` })
    const { resolveDefaultApplication } = await import('../defaultApplication')

    await expect(resolveDefaultApplication('C:\\Users\\Cherry\\报告.docx' as AbsoluteFilePath)).resolves.toEqual({
      name: '写字板'
    })
  })

  it('does not expose replacement characters for invalid UTF-8 application names', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: Buffer.from([0xff]).toString('base64') })
    const { resolveDefaultApplication } = await import('../defaultApplication')

    await expect(resolveDefaultApplication('C:\\Users\\Cherry\\report.docx' as AbsoluteFilePath)).resolves.toBeNull()
  })
})

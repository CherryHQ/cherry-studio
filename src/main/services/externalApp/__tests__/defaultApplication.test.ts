import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  getFileIcon: vi.fn(),
  platform: { isLinux: false, isMac: false, isWin: true }
}))

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:util', () => ({ promisify: () => mocks.execFileAsync }))

vi.mock('@main/core/platform', () => mocks.platform)

vi.mock('electron', () => ({
  app: { getFileIcon: mocks.getFileIcon }
}))

describe('resolveDefaultApplication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.platform, { isLinux: false, isMac: false, isWin: true })
    mocks.getFileIcon.mockResolvedValue({ isEmpty: () => true })
  })

  it('preserves localized application names across the PowerShell output boundary', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: `${Buffer.from('写字板', 'utf8').toString('base64')}\n` })
    const { resolveDefaultApplication } = await import('../defaultApplication')

    await expect(resolveDefaultApplication('C:\\Users\\Cherry\\报告.docx' as AbsoluteFilePath)).resolves.toEqual({
      name: '写字板'
    })
  })

  it('decodes a Base64 application name from NUL-interleaved PowerShell output', async () => {
    const encodedName = Buffer.from('写字板', 'utf8').toString('base64')
    mocks.execFileAsync.mockResolvedValue({ stdout: Buffer.from(`${encodedName}\r\n`, 'utf16le').toString('utf8') })
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

  describe('macOS metadata and icons', () => {
    const targetPath = '/tmp/报告.md' as AbsoluteFilePath
    const applicationPath = '/Applications/代码编辑器.app'
    const metadata = { name: '代码编辑器.app', path: applicationPath }
    const image = { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,app' }

    beforeEach(() => {
      Object.assign(mocks.platform, { isLinux: false, isMac: true, isWin: false })
      mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify(metadata) })
    })

    it('preserves localized names and bundle paths from JXA JSON and requests the application icon', async () => {
      mocks.getFileIcon.mockResolvedValue(image)
      const { resolveDefaultApplication } = await import('../defaultApplication')

      await expect(resolveDefaultApplication(targetPath)).resolves.toEqual({
        ...metadata,
        iconDataUrl: 'data:image/png;base64,app'
      })
      expect(mocks.getFileIcon.mock.calls).toEqual([[applicationPath, { size: 'normal' }]])
      expect(mocks.execFileAsync).toHaveBeenCalledWith(
        '/usr/bin/osascript',
        ['-l', 'JavaScript', '-e', expect.stringContaining('JSON.stringify'), targetPath],
        { encoding: 'utf8', timeout: 3000, windowsHide: true }
      )
    })

    it.each(['', 'not JSON', '{', 'null', '[]', '{}', '{"name":""}', '{"name":42}', '{"name":null}'])(
      'returns no metadata for unusable JXA output %j',
      async (stdout) => {
        mocks.execFileAsync.mockResolvedValue({ stdout })
        const { resolveDefaultApplication } = await import('../defaultApplication')

        await expect(resolveDefaultApplication(targetPath)).resolves.toBeNull()
        expect(mocks.getFileIcon).not.toHaveBeenCalled()
      }
    )

    it('returns no metadata when the native lookup command fails', async () => {
      mocks.execFileAsync.mockRejectedValue(new Error('timeout'))
      const { resolveDefaultApplication } = await import('../defaultApplication')

      await expect(resolveDefaultApplication(targetPath)).resolves.toBeNull()
    })

    it.each([
      undefined,
      '',
      'relative/Code.app',
      '~/Code.app',
      'file:///Applications/Code.app',
      'https://example.com/Code.app',
      42,
      null,
      '/Applications/Code\0.app',
      '"/Applications/Code.app"'
    ])('keeps the name and document icon when the application path is unusable: %j', async (applicationPath) => {
      mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ name: metadata.name, path: applicationPath }) })
      mocks.getFileIcon.mockResolvedValue(image)
      const { resolveDefaultApplication } = await import('../defaultApplication')

      await expect(resolveDefaultApplication(targetPath)).resolves.toEqual({
        name: metadata.name,
        iconDataUrl: 'data:image/png;base64,app'
      })
      expect(mocks.getFileIcon.mock.calls).toEqual([[targetPath, { size: 'normal' }]])
    })

    it('does not rewrite meaningful spaces, percent escapes, or bundle suffixes in a valid path', async () => {
      const applicationPath = '/Applications/ 开发 %20.app '
      mocks.execFileAsync.mockResolvedValue({ stdout: JSON.stringify({ name: metadata.name, path: applicationPath }) })
      const { resolveDefaultApplication } = await import('../defaultApplication')

      await expect(resolveDefaultApplication(targetPath)).resolves.toEqual({
        name: metadata.name,
        path: applicationPath
      })
      expect(mocks.getFileIcon).toHaveBeenNthCalledWith(1, applicationPath, { size: 'normal' })
    })

    it.each(['throws', 'empty'])('falls back to the document icon when the application icon %s', async (failure) => {
      if (failure === 'throws') mocks.getFileIcon.mockRejectedValueOnce(new Error('unavailable'))
      else mocks.getFileIcon.mockResolvedValueOnce({ isEmpty: () => true })
      mocks.getFileIcon.mockResolvedValueOnce(image)
      const { resolveDefaultApplication } = await import('../defaultApplication')

      await expect(resolveDefaultApplication(targetPath)).resolves.toEqual({
        ...metadata,
        iconDataUrl: 'data:image/png;base64,app'
      })
      expect(mocks.getFileIcon.mock.calls).toEqual([
        [applicationPath, { size: 'normal' }],
        [targetPath, { size: 'normal' }]
      ])
    })

    it.each(['throws', 'empty'])('preserves resolved identity when both icon lookups fail: %s', async (failure) => {
      if (failure === 'throws') mocks.getFileIcon.mockRejectedValue(new Error('unavailable'))
      else mocks.getFileIcon.mockResolvedValue({ isEmpty: () => true })
      const { resolveDefaultApplication } = await import('../defaultApplication')

      await expect(resolveDefaultApplication(targetPath)).resolves.toEqual(metadata)
      expect(mocks.getFileIcon.mock.calls).toEqual([
        [applicationPath, { size: 'normal' }],
        [targetPath, { size: 'normal' }]
      ])
    })
  })
})

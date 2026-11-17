import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

const { write } = vi.hoisted(() => ({ write: vi.fn() }))
vi.mock('electron', () => ({
  clipboard: { write },
  ClipboardItem: class {
    constructor(readonly data: Record<string, string>) {}
  }
}))

import { writeFileToClipboard } from '../clipboard'

describe('writeFileToClipboard', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each([
    ['/tmp/plain.txt', 'file:///tmp/plain.txt'],
    ['/tmp/a # % 你好.txt', 'file:///tmp/a%20%23%20%25%20%E4%BD%A0%E5%A5%BD.txt'],
    ['/tmp/line\nbreak.txt', 'file:///tmp/line%0Abreak.txt'],
    ['/tmp/folder', 'file:///tmp/folder']
  ])('writes a single URI for %s', async (path, expected) => {
    await writeFileToClipboard(path as AbsoluteFilePath)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toHaveLength(1)
    expect(write.mock.calls[0][0][0].data).toEqual({ 'text/uri-list': expected })
  })
  it('propagates clipboard failures', async () => {
    write.mockRejectedValueOnce(new Error('clipboard failed'))
    await expect(writeFileToClipboard('/tmp/a' as AbsoluteFilePath)).rejects.toThrow('clipboard failed')
  })
})

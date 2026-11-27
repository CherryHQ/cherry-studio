import { describe, expect, it, vi } from 'vitest'

import { AbsoluteFilePathSchema } from '@shared/types/file'

import { createElectronPreviewSource } from '../electronPreviewSource'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

const path = AbsoluteFilePathSchema.parse('/tmp/report.docx')
const metadata = { size: 2, modifiedAt: 7 }

describe('Electron preview source', () => {
  it.each([
    { size: 3, mtime: 7 },
    { size: 2, mtime: 8 }
  ])('rejects the first read if the preflight version changed: %s', async (version) => {
    mocks.request.mockResolvedValueOnce({ content: new Uint8Array([1]), version })
    const document = await createElectronPreviewSource(path, 'report.docx', metadata).open()
    await expect(document.readRange(0, 1)).rejects.toMatchObject({ code: 'source_changed' })
  })

  it('refuses to combine ranges from different file versions', async () => {
    mocks.request.mockResolvedValueOnce({ content: new Uint8Array([1]), version: { size: 2, mtime: 7 } })
    mocks.request.mockResolvedValueOnce({ content: new Uint8Array([2]), version: { size: 2, mtime: 8 } })
    const document = await createElectronPreviewSource(path, 'report.docx', metadata).open()
    await expect(document.readRange(0, 1)).resolves.toEqual(new Uint8Array([1]))
    await expect(document.readRange(1, 1)).rejects.toMatchObject({ code: 'source_changed' })
  })

  it('rejects short reads and reads after an idempotent close', async () => {
    mocks.request.mockResolvedValueOnce({ content: new Uint8Array(0), version: { size: 2, mtime: 7 } })
    const document = await createElectronPreviewSource(path, 'report.docx', metadata).open()
    await expect(document.readRange(0, 1)).rejects.toMatchObject({ code: 'short_read' })
    await document.close()
    await document.close()
    await expect(document.readRange(0, 1)).rejects.toMatchObject({ code: 'closed' })
  })

  it('serves a whole-file read with one full read, still checked against the preflight version', async () => {
    mocks.request.mockResolvedValueOnce({ content: new Uint8Array([1, 2]), version: { size: 2, mtime: 7 } })
    mocks.request.mockResolvedValueOnce({ content: new Uint8Array([1, 2]), version: { size: 2, mtime: 8 } })
    const document = await createElectronPreviewSource(path, 'report.docx', metadata).open()
    await expect(document.readRange(0, 2)).resolves.toEqual(new Uint8Array([1, 2]))
    expect(mocks.request).toHaveBeenLastCalledWith('file.read', {
      handle: expect.anything(),
      options: { mode: 'full', encoding: 'binary' }
    })
    await expect(document.readRange(0, 2)).rejects.toMatchObject({ code: 'source_changed' })
  })
})

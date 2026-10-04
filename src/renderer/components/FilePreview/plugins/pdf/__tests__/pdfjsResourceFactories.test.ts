import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PdfjsBundledCMapReaderFactory, PdfjsBundledStandardFontDataFactory } from '../pdfjsResourceFactories'

const { ipcApiRequest } = vi.hoisted(() => ({ ipcApiRequest: vi.fn() }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcApiRequest } }))

describe('PdfjsBundledCMapReaderFactory', () => {
  beforeEach(() => {
    ipcApiRequest.mockReset()
  })

  it('fetches the CMap over IPC and reports it as packed binary', async () => {
    const content = new Uint8Array([1, 2, 3])
    ipcApiRequest.mockResolvedValue({ content })

    const factory = new PdfjsBundledCMapReaderFactory()
    await expect(factory.fetch({ name: 'UniGB-UCS2-H' })).resolves.toEqual({ cMapData: content, isCompressed: true })
    expect(ipcApiRequest).toHaveBeenCalledWith('pdfjs.resource.read', { kind: 'cmap', name: 'UniGB-UCS2-H' })
  })

  it('rejects an empty name without touching IPC', async () => {
    const factory = new PdfjsBundledCMapReaderFactory()
    await expect(factory.fetch({ name: '' })).rejects.toThrow('CMap name must be specified.')
    expect(ipcApiRequest).not.toHaveBeenCalled()
  })
})

describe('PdfjsBundledStandardFontDataFactory', () => {
  beforeEach(() => {
    ipcApiRequest.mockReset()
  })

  it('fetches the standard font bytes over IPC', async () => {
    const content = new Uint8Array([4, 5, 6])
    ipcApiRequest.mockResolvedValue({ content })

    const factory = new PdfjsBundledStandardFontDataFactory()
    await expect(factory.fetch({ filename: 'LiberationSans-Regular.ttf' })).resolves.toBe(content)
    expect(ipcApiRequest).toHaveBeenCalledWith('pdfjs.resource.read', {
      kind: 'standard_font',
      name: 'LiberationSans-Regular.ttf'
    })
  })

  it('rejects an empty filename without touching IPC', async () => {
    const factory = new PdfjsBundledStandardFontDataFactory()
    await expect(factory.fetch({ filename: '' })).rejects.toThrow('Font filename must be specified.')
    expect(ipcApiRequest).not.toHaveBeenCalled()
  })
})

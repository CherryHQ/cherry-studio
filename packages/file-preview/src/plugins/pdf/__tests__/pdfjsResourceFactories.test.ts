import { describe, expect, it, vi } from 'vitest'

import { createPdfResourceFactories } from '../pdfjsResourceFactories'

describe('PDF resource factories', () => {
  it('reads packed CMaps and font bytes through the host resource reader', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const read = vi.fn().mockResolvedValue(bytes)
    const { CMapReaderFactory, StandardFontDataFactory } = createPdfResourceFactories(read)
    await expect(new CMapReaderFactory().fetch({ name: 'UniGB-UCS2-H' })).resolves.toEqual({
      cMapData: bytes,
      isCompressed: true
    })
    await expect(new StandardFontDataFactory().fetch({ filename: 'LiberationSans-Regular.ttf' })).resolves.toBe(bytes)
    expect(read.mock.calls).toEqual([
      ['cmap', 'UniGB-UCS2-H'],
      ['standard_font', 'LiberationSans-Regular.ttf']
    ])
  })

  it('rejects missing resource names before requesting host bytes', async () => {
    const read = vi.fn()
    const { CMapReaderFactory, StandardFontDataFactory } = createPdfResourceFactories(read)
    await expect(new CMapReaderFactory().fetch({ name: '' })).rejects.toThrow('CMap name must be specified.')
    await expect(new StandardFontDataFactory().fetch({ filename: '' })).rejects.toThrow(
      'Font filename must be specified.'
    )
    expect(read).not.toHaveBeenCalled()
  })
})

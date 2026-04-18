import { beforeEach, describe, expect, it, vi } from 'vitest'

import { persistGeneratedImages } from './persistGeneratedImages'

describe('persistGeneratedImages', () => {
  const saveBase64Image = vi.fn()
  const warning = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: {
        ...globalThis.window?.api,
        file: {
          saveBase64Image
        }
      },
      toast: {
        warning
      }
    })
  })

  it('persists base64 images', async () => {
    saveBase64Image.mockResolvedValue({ id: 'file-1', name: 'file1.png' })

    const result = await persistGeneratedImages([{ kind: 'base64', data: 'data:image/png;base64,abc' }])

    expect(saveBase64Image).toHaveBeenCalledWith('data:image/png;base64,abc')
    expect(result).toEqual([{ id: 'file-1', name: 'file1.png' }])
  })

  it('filters failed images and warns on empty payloads', async () => {
    saveBase64Image.mockRejectedValueOnce(new Error('save failed'))

    const result = await persistGeneratedImages([
      { kind: 'base64', data: 'data:image/png;base64,abc' },
      { kind: 'base64', data: '' }
    ])

    expect(result).toEqual([])
    expect(warning).toHaveBeenCalled()
  })
})

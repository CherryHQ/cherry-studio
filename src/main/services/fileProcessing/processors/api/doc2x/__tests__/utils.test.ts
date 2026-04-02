import fs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { uploadFile } from '../utils'

describe('doc2x utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects files that are 1GB or larger before uploading', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 * 1024 * 1024 } as never)

    await expect(uploadFile('/tmp/large.pdf', 'https://upload.example.com')).rejects.toThrow(
      'Doc2x file is too large (must be smaller than 1GB)'
    )
  })
})

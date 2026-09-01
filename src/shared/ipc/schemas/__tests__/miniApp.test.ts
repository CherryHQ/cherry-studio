import { describe, expect, it } from 'vitest'

import { miniAppRequestSchemas } from '../miniApp'

describe('mini app install IPC schemas', () => {
  const previewFile = miniAppRequestSchemas['mini_app.install.preview_file'].input

  it('accepts only an absolute .miniapp package path for a dropped install', () => {
    expect(previewFile.safeParse({ filePath: '/tmp/example.miniapp' }).success).toBe(true)
    expect(previewFile.safeParse({ filePath: 'C:\\Temp\\Example.MINIAPP' }).success).toBe(true)
    expect(previewFile.safeParse({ filePath: '/tmp/example.zip' }).success).toBe(false)
    expect(previewFile.safeParse({ filePath: 'example.miniapp' }).success).toBe(false)
  })
})

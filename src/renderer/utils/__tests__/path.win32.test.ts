import type { AbsoluteFilePath } from '@shared/types/file'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/utils/platform', () => ({ isWin: true }))

const { isFilesystemRoot } = await import('../path')

const p = (value: string) => value as AbsoluteFilePath

describe('isFilesystemRoot on Windows', () => {
  it.each(['//server/share', '//server/share/', '//server/share/project/..'])(
    'identifies a forward-slash UNC root: %s',
    (value) => {
      expect(isFilesystemRoot(p(value))).toBe(true)
    }
  )

  it('allows a nested forward-slash UNC directory', () => {
    expect(isFilesystemRoot(p('//server/share/project'))).toBe(false)
  })
})

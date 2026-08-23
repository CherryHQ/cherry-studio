import { describe, expect, it } from 'vitest'

import { findDshRuntimeVariants } from '../after-pack'

describe('after-pack DSH archive inspection', () => {
  it('normalizes Windows asar entry separators', () => {
    expect(
      findDshRuntimeVariants([
        '\\node_modules\\@cherrystudio\\dsh-bridge\\dist\\runtime\\win32-x64\\dsh-runtime.tar.zst'
      ])
    ).toEqual(new Set(['win32-x64']))
  })

  it('ignores unrelated entries', () => {
    expect(findDshRuntimeVariants(['node_modules/@cherrystudio/dsh-bridge/dist/index.cjs'])).toEqual(new Set())
  })
})

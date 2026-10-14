import { describe, expect, it } from 'vitest'

import { getFileIconName } from '../fileIconName'

describe('getFileIconName', () => {
  it('resolves simple extensions case-insensitively', () => {
    expect(getFileIconName('app.ts')).toBe('typescript')
    expect(getFileIconName('App.TS')).toBe('typescript')
    expect(getFileIconName('index.tsx')).toBe('react-ts')
  })

  it('matches the compound .d.ts extension regardless of case', () => {
    // The simple-extension path already lowercases, so a `.d.ts` file whose
    // extension carries any uppercase still has to land on `typescript-def`
    // (the declaration-file icon) rather than the plain `typescript` icon.
    expect(getFileIconName('globals.d.ts')).toBe('typescript-def')
    expect(getFileIconName('globals.D.ts')).toBe('typescript-def')
    expect(getFileIconName('globals.d.TS')).toBe('typescript-def')
    expect(getFileIconName('Globals.D.TS')).toBe('typescript-def')
  })

  it('strips the directory part before looking at the name', () => {
    expect(getFileIconName('src/types/globals.D.ts')).toBe('typescript-def')
    expect(getFileIconName('packages/core/src/index.ts')).toBe('typescript')
  })

  it('strips the directory part of Windows paths too', () => {
    // Artifact cards render tool-provided absolute paths, which are backslash
    // separated on Windows. Splitting on `/` only left the whole path in place,
    // so even a name-only match like `Dockerfile` degraded to the generic icon.
    expect(getFileIconName('C:\\proj\\Dockerfile')).toBe('docker')
    expect(getFileIconName('C:\\proj\\.gitignore')).toBe('git')
    expect(getFileIconName('C:\\proj\\package.json')).toBe('nodejs')
    expect(getFileIconName('C:\\proj\\README.md')).toBe('readme')
  })

  it('still resolves extensions inside Windows paths', () => {
    expect(getFileIconName('C:\\proj\\app.ts')).toBe('typescript')
    expect(getFileIconName('C:\\proj\\globals.d.ts')).toBe('typescript-def')
  })

  it('falls back to the document icon for unknown or empty names', () => {
    expect(getFileIconName('notes.unknownext')).toBe('document')
    expect(getFileIconName('')).toBe('document')
  })
})

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import materialIconTheme from '@iconify-json/material-icon-theme/icons.json'
import { describe, expect, it } from 'vitest'

import { getFileIconName } from '../fileIconName'

describe('getFileIconName', () => {
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

  it('only references icon names that exist in material-icon-theme', () => {
    // Every name is handed to `material-icon-theme:<name>`; a name the collection does not have
    // resolves to nothing at runtime, so the file silently loses its icon (this is how `shell`,
    // `windows`, `visualbasic`, `wasm` and `csv` had already gone missing).
    const source = readFileSync(join(process.cwd(), 'src/renderer/utils/fileIconName.ts'), 'utf8')
    const referenced = new Set(
      [...source.matchAll(/:\s*'([a-z0-9-]+)'/g)].map((match) => match[1]).filter((name) => name !== 's')
    )

    expect(referenced.size).toBeGreaterThan(0)
    expect([...referenced].filter((name) => !(name in materialIconTheme.icons)).sort()).toEqual([])
  })
})

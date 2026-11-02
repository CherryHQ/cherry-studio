import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import materialIconTheme from '@iconify-json/material-icon-theme/icons.json'
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

  it('uses the Claude icon for CLAUDE.md instead of the generic Markdown icon', () => {
    expect(getFileIconName('packages/ui/CLAUDE.md')).toBe('claude')
  })

  it('uses the Mermaid icon for both Mermaid file extensions', () => {
    expect(getFileIconName('docs/flow.mmd')).toBe('mermaid')
    expect(getFileIconName('docs/Flow.MERMAID')).toBe('mermaid')
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

  it('maps office documents onto the collection glyphs that exist', () => {
    expect(getFileIconName('report.docx')).toBe('word')
    expect(getFileIconName('budget.xlsx')).toBe('table')
    expect(getFileIconName('sheet.csv')).toBe('table')
    expect(getFileIconName('deck.pptx')).toBe('powerpoint')
  })

  it('only references icon names that exist in material-icon-theme', () => {
    // Every name is handed to `material-icon-theme:<name>`; a name the collection does not have
    // resolves to nothing at runtime, so the file silently loses its icon (this is how `shell`,
    // `windows`, `visualbasic`, `wasm` and `csv` had already gone missing).
    const source = readFileSync(join(process.cwd(), 'src/renderer/utils/fileIconName.ts'), 'utf8')
    const referenced = new Set(
      [...source.matchAll(/:\s*'([a-z0-9-]+)'/g)].map((match) => match[1]).filter((name) => name !== 's')
    )

    expect(referenced.size).toBeGreaterThan(50)
    expect([...referenced].filter((name) => !(name in materialIconTheme.icons)).sort()).toEqual([])
  })
})

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { checkStructure } from '../verify-doc-structure'

const tempDirs: string[] = []
const makeReferences = (layout: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-structure-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('checkStructure', () => {
  it('accepts a tree of listed domains each owning a README', () => {
    const dir = makeReferences({ 'ai/README.md': '# AI', 'data/README.md': '# Data' })
    expect(checkStructure(dir, ['ai', 'data'])).toEqual([])
  })

  it('rejects a loose file at the references root', () => {
    const dir = makeReferences({ 'ai/README.md': '# AI', 'stray.md': '# Stray' })
    expect(checkStructure(dir, ['ai'])).toEqual([expect.stringContaining('stray.md')])
  })

  it('rejects a domain directory absent from the closed set', () => {
    const dir = makeReferences({ 'ai/README.md': '# AI', 'rogue/README.md': '# Rogue' })
    expect(checkStructure(dir, ['ai'])).toEqual([expect.stringContaining('rogue/')])
  })

  it('rejects a domain without a README home and a listed domain missing on disk', () => {
    const dir = makeReferences({ 'ai/usage.md': '# Usage' })
    const failures = checkStructure(dir, ['ai', 'data'])
    expect(failures).toEqual([expect.stringContaining('ai/: missing README.md'), expect.stringContaining('data/')])
  })
})

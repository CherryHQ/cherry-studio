import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkFile } from '../verify-doc-frontmatter'

const tempDirs: string[] = []
const makeRepo = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-frontmatter-'))
  tempDirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  return root
}

afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

const doc = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Doc\n`

describe('checkFile', () => {
  it('accepts a description plus sources that exist', () => {
    const root = makeRepo({
      'src/main/thing.ts': 'export {}',
      'docs/references/x/doc.md': doc('description: What the thing does\nsources:\n  - src/main/thing.ts')
    })
    expect(checkFile(root, path.join(root, 'docs/references/x/doc.md'), { requireSources: true })).toEqual([])
  })

  it('rejects a doc whose source path no longer exists — the rot signal', () => {
    const root = makeRepo({
      'docs/references/x/doc.md': doc('description: Describes deleted code\nsources:\n  - src/main/gone.ts')
    })
    expect(checkFile(root, path.join(root, 'docs/references/x/doc.md'), { requireSources: true })).toEqual([
      expect.stringContaining('src/main/gone.ts')
    ])
  })

  it('rejects a source that escapes the repo even when the target exists', () => {
    const root = makeRepo({
      'outside-the-repo.ts': 'export {}',
      'repo/docs/references/x/doc.md': doc('description: Escapes upward\nsources:\n  - ../outside-the-repo.ts')
    })
    expect(
      checkFile(path.join(root, 'repo'), path.join(root, 'repo/docs/references/x/doc.md'), { requireSources: true })
    ).toEqual([expect.stringContaining('not repo-relative')])
  })

  it('rejects an absolute source path', () => {
    const root = makeRepo({ 'docs/references/x/doc.md': doc('description: Absolute\nsources:\n  - /etc/hosts') })
    expect(checkFile(root, path.join(root, 'docs/references/x/doc.md'), { requireSources: true })).toEqual([
      expect.stringContaining('not repo-relative')
    ])
  })

  it('rejects an empty source path', () => {
    const root = makeRepo({ 'docs/references/x/doc.md': doc('description: Empty\nsources:\n  - ""') })
    expect(checkFile(root, path.join(root, 'docs/references/x/doc.md'), { requireSources: true })).toEqual([
      expect.stringContaining('not repo-relative')
    ])
  })

  it('rejects missing description and missing sources under the reference rule', () => {
    const root = makeRepo({ 'docs/references/x/doc.md': '# Doc without frontmatter\n' })
    const failures = checkFile(root, path.join(root, 'docs/references/x/doc.md'), { requireSources: true })
    expect(failures).toEqual([expect.stringContaining('description'), expect.stringContaining('sources')])
  })

  it('lets a contrib doc omit sources but still validates one it declares', () => {
    const root = makeRepo({
      'docs/contrib/process.md': doc('description: A process doc'),
      'docs/contrib/tool.md': doc('description: A tool doc\nsources:\n  - scripts/gone.ts')
    })
    expect(checkFile(root, path.join(root, 'docs/contrib/process.md'), { requireSources: false })).toEqual([])
    expect(checkFile(root, path.join(root, 'docs/contrib/tool.md'), { requireSources: false })).toEqual([
      expect.stringContaining('scripts/gone.ts')
    ])
  })
})

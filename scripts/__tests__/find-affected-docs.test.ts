import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []
const script = path.resolve(__dirname, '../find-affected-docs.mjs')
const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('docs:affected', () => {
  it('matches exact source prefixes without matching sibling names', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-affected-docs-'))
    tempDirs.push(root)
    git(root, 'init', '--quiet')
    git(root, 'config', 'user.email', 'docs@example.test')
    git(root, 'config', 'user.name', 'Docs Test')
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src/main/foo'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'docs/sources-index.json'),
      JSON.stringify({ version: 1, documents: [{ path: 'docs/references/foo.md', sources: ['src/main/foo'] }] })
    )
    fs.writeFileSync(path.join(root, 'src/main/foo/a.ts'), 'a\n')
    fs.writeFileSync(path.join(root, 'src/main/foobar.ts'), 'x\n')
    git(root, 'add', '.')
    git(root, 'commit', '--quiet', '-m', 'base')
    const base = git(root, 'rev-parse', 'HEAD')
    fs.writeFileSync(path.join(root, 'src/main/foo/a.ts'), 'changed\n')
    fs.writeFileSync(path.join(root, 'src/main/foobar.ts'), 'changed\n')
    git(root, 'add', '.')
    git(root, 'commit', '--quiet', '-m', 'change')

    const output = JSON.parse(
      execFileSync(process.execPath, [script, '--base', base, '--json'], { cwd: root, encoding: 'utf8' })
    )
    expect(output.documents).toEqual([
      { document: 'docs/references/foo.md', sources: ['src/main/foo'], matchedPaths: ['src/main/foo/a.ts'] }
    ])
  })
})

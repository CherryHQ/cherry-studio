import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []
const script = path.resolve(__dirname, '../change-scope.mjs')

const git = (root: string, ...args: string[]): string =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

const makeRepo = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-change-scope-'))
  tempDirs.push(root)
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.email', 'scope@example.test')
  git(root, 'config', 'user.name', 'Scope Test')
  fs.writeFileSync(path.join(root, 'base.txt'), 'base\n')
  git(root, 'add', 'base.txt')
  git(root, 'commit', '--quiet', '-m', 'base')
  return root
}

afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('change:scope', () => {
  it('separates committed, staged, unstaged, and untracked paths', () => {
    const root = makeRepo()
    const base = git(root, 'rev-parse', 'HEAD')
    fs.writeFileSync(path.join(root, 'committed.txt'), 'committed\n')
    git(root, 'add', 'committed.txt')
    git(root, 'commit', '--quiet', '-m', 'committed')
    fs.writeFileSync(path.join(root, 'staged.txt'), 'staged\n')
    git(root, 'add', 'staged.txt')
    fs.writeFileSync(path.join(root, 'base.txt'), 'unstaged\n')
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n')

    const report = JSON.parse(execFileSync(process.execPath, [script, '--base', base], { cwd: root, encoding: 'utf8' }))
    expect(report.resolved.baseSha).toBe(base)
    expect(report.paths).toEqual({
      committed: ['committed.txt'],
      staged: ['staged.txt'],
      unstaged: ['base.txt'],
      untracked: ['untracked.txt']
    })
  })

  it('requires an explicit base', () => {
    const root = makeRepo()
    expect(() => execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' })).toThrow()
  })
})

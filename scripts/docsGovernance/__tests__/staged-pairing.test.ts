import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { stagedPairAnchors } from '../verify-translation-pairing'

const directories: string[] = []

const createRepository = (): { cwd: string; git: (...args: string[]) => string } => {
  const cwd = mkdtempSync(join(tmpdir(), 'cherry-staged-pairing-'))
  directories.push(cwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  for (const file of ['CONTRIBUTING.md', 'CONTRIBUTING.zh.md', 'CONTRIBUTING.i18n.yaml']) {
    writeFileSync(join(cwd, file), `${file}\n`)
  }
  git('add', '.')
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')
  return { cwd, git }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('staged pairing discovery', () => {
  it('discovers deletion-only pair anchors', () => {
    const { cwd, git } = createRepository()
    rmSync(join(cwd, 'CONTRIBUTING.md'))
    git('add', '-u')

    expect(stagedPairAnchors(cwd)).toEqual(['CONTRIBUTING.md'])
  })

  it('discovers both sides of a complete triplet rename', () => {
    const { cwd, git } = createRepository()
    mkdirSync(join(cwd, 'docs'))
    for (const suffix of ['.md', '.zh.md', '.i18n.yaml']) {
      renameSync(join(cwd, `CONTRIBUTING${suffix}`), join(cwd, `docs/guide${suffix}`))
    }
    git('add', '-A')

    expect(stagedPairAnchors(cwd)).toEqual(['CONTRIBUTING.md', 'docs/guide.md'])
  })
})

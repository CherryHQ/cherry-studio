import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { prepareBackport } from '../release/backport-patch'
import {
  extractHotfixReleaseNote,
  readBuilderReleaseNotes,
  updateHotfixReleaseMetadata
} from '../release/hotfix-release-notes'
import { validatePreparedRelease } from '../release/validate-prepared-release'

interface GitFixture {
  patchFile: string
  repo: string
  root: string
}

let roots: string[] = []
const inheritedGitEnvironment = Object.entries(process.env).filter(
  (entry): entry is [string, string] => entry[0].startsWith('GIT_') && entry[1] !== undefined
)

function clearGitEnvironment(): void {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GIT_')) delete process.env[key]
  }
}

beforeAll(() => {
  clearGitEnvironment()
  process.env.GIT_CONFIG_GLOBAL = os.devNull
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})

afterAll(() => {
  clearGitEnvironment()
  for (const [key, value] of inheritedGitEnvironment) process.env[key] = value
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(cwd: string, filePath: string, contents: string): void {
  const absolutePath = path.join(cwd, filePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, contents)
}

function commit(cwd: string, message: string): string {
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

function createGitFixture(baseContents = 'base\n'): GitFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-workflow-'))
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  roots.push(root)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Release Test')
  git(repo, 'config', 'user.email', 'release-test@example.com')
  write(repo, 'app.txt', baseContents)
  commit(repo, 'base')
  return { patchFile: path.join(root, 'hotfix.patch'), repo, root }
}

function markOriginMain(repo: string, sha: string): void {
  git(repo, 'update-ref', 'refs/remotes/origin/main', sha)
}

function runBackport(
  fixture: GitFixture,
  mergeSha: string,
  prCommitCount: number,
  associated: Set<string> = new Set()
) {
  return prepareBackport({
    cwd: fixture.repo,
    mergeSha,
    prCommitCount,
    prNumber: 42,
    patchFile: fixture.patchFile,
    getAssociatedPullRequests: (sha: string) => (associated.has(sha) ? [42] : [])
  })
}

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('backport patch preparation', () => {
  it('applies the complete result of a squash merge without unrelated main changes', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    git(fixture.repo, 'checkout', '-b', 'feature')
    write(fixture.repo, 'app.txt', 'first\n')
    commit(fixture.repo, 'first fix')
    write(fixture.repo, 'second.txt', 'second\n')
    commit(fixture.repo, 'second fix')
    git(fixture.repo, 'checkout', 'main')
    git(fixture.repo, 'merge', '--squash', 'feature')
    const mergeSha = commit(fixture.repo, 'squashed hotfix')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(runBackport(fixture, mergeSha, 2)).toMatchObject({ hasChanges: true, patchBase: base })
    expect(fs.readFileSync(path.join(fixture.repo, 'app.txt'), 'utf8')).toBe('first\n')
    expect(fs.readFileSync(path.join(fixture.repo, 'second.txt'), 'utf8')).toBe('second\n')
  })

  it('uses a merge commit first parent so main-only work is not backported', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    git(fixture.repo, 'checkout', '-b', 'feature')
    write(fixture.repo, 'app.txt', 'hotfix\n')
    commit(fixture.repo, 'hotfix')
    git(fixture.repo, 'checkout', 'main')
    write(fixture.repo, 'main-only.txt', 'not part of the fix\n')
    const firstParent = commit(fixture.repo, 'main work')
    git(fixture.repo, 'merge', '--no-ff', 'feature', '-m', 'merge hotfix')
    const mergeSha = git(fixture.repo, 'rev-parse', 'HEAD')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(runBackport(fixture, mergeSha, 1)).toMatchObject({ hasChanges: true, patchBase: firstParent })
    expect(fs.readFileSync(path.join(fixture.repo, 'app.txt'), 'utf8')).toBe('hotfix\n')
    expect(fs.existsSync(path.join(fixture.repo, 'main-only.txt'))).toBe(false)
  })

  it('walks all associated commits from a rebase merge', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    write(fixture.repo, 'app.txt', 'first\n')
    const firstCommit = commit(fixture.repo, 'first rebased fix')
    write(fixture.repo, 'second.txt', 'second\n')
    const mergeSha = commit(fixture.repo, 'second rebased fix')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(runBackport(fixture, mergeSha, 2, new Set([firstCommit]))).toMatchObject({
      hasChanges: true,
      patchBase: base
    })
    expect(fs.readFileSync(path.join(fixture.repo, 'second.txt'), 'utf8')).toBe('second\n')
  })

  it('reports a patch already present without staging a duplicate', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    write(fixture.repo, 'app.txt', 'hotfix\n')
    const mergeSha = commit(fixture.repo, 'hotfix')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', mergeSha)

    expect(runBackport(fixture, mergeSha, 1)).toMatchObject({ hasChanges: false, patchBase: base })
    expect(git(fixture.repo, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('resets a conflicted three-way application to the release head', () => {
    const fixture = createGitFixture('setting=base\n')
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    write(fixture.repo, 'app.txt', 'setting=hotfix\n')
    const mergeSha = commit(fixture.repo, 'hotfix')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)
    write(fixture.repo, 'app.txt', 'setting=release\n')
    commit(fixture.repo, 'release change')

    expect(() => runBackport(fixture, mergeSha, 1)).toThrow(
      /conflicts with the active release branch[\s\S]*Unmerged paths:\napp\.txt/
    )
    expect(fs.readFileSync(path.join(fixture.repo, 'app.txt'), 'utf8')).toBe('setting=release\n')
    expect(git(fixture.repo, 'status', '--porcelain')).toBe('')
  })
})

function hotfixBody(english: string, chinese: string): string {
  return `\`\`\`release-note
<!--LANG:en-->
${english}
<!--LANG:zh-CN-->
${chinese}
<!--LANG:END-->
\`\`\``
}

const HOTFIX_BODY = hotfixBody('[Chat] Fix messages disappearing after restart.', '[聊天] 修复重启后消息消失的问题。')

function releaseNotes(version: string, item: string): string {
  return `<!--LANG:en-->
Cherry Studio ${version} - Test Release

🐛 Bug Fixes
- [Chat] ${item}

<!--LANG:zh-CN-->
Cherry Studio ${version} - 测试版本

🐛 问题修复
- [聊天] ${item}
<!--LANG:END-->`
}

function builderYaml(notes: string, extra = ''): string {
  const indented = notes
    .split('\n')
    .map((line) => (line ? `    ${line}` : ''))
    .join('\n')
  return `appId: example.app\n${extra}releaseInfo:\n  releaseNotes: |\n${indented}\n`
}

describe('hotfix release notes', () => {
  it('requires one bilingual line for an automatically backported hotfix', () => {
    expect(extractHotfixReleaseNote(HOTFIX_BODY)).toEqual({
      english: '[Chat] Fix messages disappearing after restart.',
      chinese: '[聊天] 修复重启后消息消失的问题。'
    })
    expect(() => extractHotfixReleaseNote('```release-note\nNONE\n```')).toThrow('language markers')
  })

  it.each([
    ['a missing component', 'Fix messages disappearing after restart.', '[聊天] 修复重启后消息消失的问题。'],
    [
      'multiple English lines',
      '[Chat] Fix messages disappearing after restart.\n[Chat] Fix another issue.',
      '[聊天] 修复重启后消息消失的问题。'
    ],
    ['a Markdown bullet prefix', '- [Chat] Fix messages disappearing.', '[聊天] 修复消息消失的问题。'],
    ['an empty component', '[] Fix messages disappearing.', '[聊天] 修复消息消失的问题。']
  ])('rejects hotfix notes with %s', (_case, english, chinese) => {
    expect(() => extractHotfixReleaseNote(hotfixBody(english, chinese))).toThrow('one [Component] release-note line')
  })

  it('adds the hotfix to installer notes and stable release history exactly once', () => {
    const fixture = createGitFixture()
    const notes = releaseNotes('1.0.0', 'Existing fix.')
    const builderPath = path.join(fixture.repo, 'electron-builder.yml')
    const historyPath = path.join(fixture.repo, 'release-history.json')
    write(fixture.repo, 'electron-builder.yml', builderYaml(notes))
    write(
      fixture.repo,
      'release-history.json',
      `${JSON.stringify([{ version: '1.0.0', releaseNotes: notes }], null, 2)}\n`
    )

    updateHotfixReleaseMetadata({ builderPath, historyPath, prBody: HOTFIX_BODY, version: '1.0.0' })
    updateHotfixReleaseMetadata({ builderPath, historyPath, prBody: HOTFIX_BODY, version: '1.0.0' })

    const updatedNotes = readBuilderReleaseNotes(fs.readFileSync(builderPath, 'utf8')).releaseNotes
    expect(updatedNotes.match(/Fix messages disappearing/g)).toHaveLength(1)
    expect(updatedNotes.match(/修复重启后消息消失/g)).toHaveLength(1)
    expect(JSON.parse(fs.readFileSync(historyPath, 'utf8'))[0].releaseNotes).toBe(updatedNotes)
  })
})

function createPreparedReleaseFixture(targetVersion = '1.1.0'): GitFixture {
  const fixture = createGitFixture()
  const oldNotes = releaseNotes('1.0.0', 'Old fix.')
  write(fixture.repo, 'package.json', `${JSON.stringify({ name: 'release-test', version: '1.0.0' }, null, 2)}\n`)
  write(fixture.repo, 'electron-builder.yml', builderYaml(oldNotes))
  write(
    fixture.repo,
    'resources/cherry-studio/release-history.json',
    `${JSON.stringify([{ version: '1.0.0', releaseNotes: oldNotes }], null, 2)}\n`
  )
  commit(fixture.repo, 'release metadata baseline')

  const newNotes = releaseNotes(targetVersion, 'New fix.')
  write(fixture.repo, 'package.json', `${JSON.stringify({ name: 'release-test', version: targetVersion }, null, 2)}\n`)
  write(fixture.repo, 'electron-builder.yml', builderYaml(newNotes))
  if (!targetVersion.includes('-')) {
    write(
      fixture.repo,
      'resources/cherry-studio/release-history.json',
      `${JSON.stringify(
        [
          { version: targetVersion, releaseNotes: newNotes },
          { version: '1.0.0', releaseNotes: oldNotes }
        ],
        null,
        2
      )}\n`
    )
  }
  return fixture
}

describe('prepared release validation', () => {
  it('accepts only a version bump, bilingual notes, and the matching stable history entry', () => {
    const fixture = createPreparedReleaseFixture()
    expect(() => validatePreparedRelease({ cwd: fixture.repo, targetVersion: '1.1.0' })).not.toThrow()
  })

  it('rejects unrelated package and electron-builder changes inside the allowed paths', () => {
    const fixture = createPreparedReleaseFixture()
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.repo, 'package.json'), 'utf8'))
    manifest.name = 'altered'
    write(fixture.repo, 'package.json', `${JSON.stringify(manifest, null, 2)}\n`)
    expect(() => validatePreparedRelease({ cwd: fixture.repo, targetVersion: '1.1.0' })).toThrow(
      'package.json may change only the version field'
    )

    const secondFixture = createPreparedReleaseFixture()
    const builderPath = path.join(secondFixture.repo, 'electron-builder.yml')
    fs.writeFileSync(
      builderPath,
      fs.readFileSync(builderPath, 'utf8').replace('appId: example.app', 'appId: changed.app')
    )
    expect(() => validatePreparedRelease({ cwd: secondFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'electron-builder.yml may change only releaseInfo.releaseNotes'
    )
  })

  it('rejects invalid, non-incrementing, and mismatched package versions', () => {
    const invalidFixture = createPreparedReleaseFixture()
    expect(() => validatePreparedRelease({ cwd: invalidFixture.repo, targetVersion: 'invalid' })).toThrow(
      'Invalid target version'
    )

    const downgradeFixture = createPreparedReleaseFixture()
    expect(() => validatePreparedRelease({ cwd: downgradeFixture.repo, targetVersion: '1.0.0' })).toThrow(
      'must be greater than 1.0.0'
    )

    const mismatchFixture = createPreparedReleaseFixture()
    const packagePath = path.join(mismatchFixture.repo, 'package.json')
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
    manifest.version = '1.2.0'
    write(mismatchFixture.repo, 'package.json', `${JSON.stringify(manifest, null, 2)}\n`)
    expect(() => validatePreparedRelease({ cwd: mismatchFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'does not match 1.1.0'
    )
  })

  it('rejects missing language markers and mismatched release-note headings', () => {
    const missingMarkerFixture = createPreparedReleaseFixture()
    const missingMarkerBuilder = path.join(missingMarkerFixture.repo, 'electron-builder.yml')
    fs.writeFileSync(
      missingMarkerBuilder,
      fs.readFileSync(missingMarkerBuilder, 'utf8').replace('<!--LANG:zh-CN-->', '<!--LANG:missing-->')
    )
    expect(() => validatePreparedRelease({ cwd: missingMarkerFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'one ordered English and Chinese marker set'
    )

    const wrongHeadingFixture = createPreparedReleaseFixture()
    const wrongHeadingBuilder = path.join(wrongHeadingFixture.repo, 'electron-builder.yml')
    fs.writeFileSync(
      wrongHeadingBuilder,
      fs
        .readFileSync(wrongHeadingBuilder, 'utf8')
        .replace('Cherry Studio 1.1.0 - 测试版本', 'Cherry Studio 1.0.0 - 测试版本')
    )
    expect(() => validatePreparedRelease({ cwd: wrongHeadingFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'Chinese release notes do not identify Cherry Studio 1.1.0'
    )
  })

  it('rejects mismatched or discarded stable release history', () => {
    const mismatchedNotesFixture = createPreparedReleaseFixture()
    const mismatchedHistoryPath = path.join(mismatchedNotesFixture.repo, 'resources/cherry-studio/release-history.json')
    const mismatchedHistory = JSON.parse(fs.readFileSync(mismatchedHistoryPath, 'utf8'))
    mismatchedHistory[0].releaseNotes = 'different notes'
    fs.writeFileSync(mismatchedHistoryPath, `${JSON.stringify(mismatchedHistory, null, 2)}\n`)
    expect(() => validatePreparedRelease({ cwd: mismatchedNotesFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'must exactly match electron-builder.yml'
    )

    const discardedHistoryFixture = createPreparedReleaseFixture()
    const discardedHistoryPath = path.join(discardedHistoryFixture.repo, 'resources/cherry-studio/release-history.json')
    const discardedHistory = JSON.parse(fs.readFileSync(discardedHistoryPath, 'utf8'))
    fs.writeFileSync(discardedHistoryPath, `${JSON.stringify([discardedHistory[0]], null, 2)}\n`)
    expect(() => validatePreparedRelease({ cwd: discardedHistoryFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'must preserve existing release history entries'
    )
  })

  it('rejects release-history changes for prereleases', () => {
    const fixture = createPreparedReleaseFixture('1.1.0-rc.1')
    const historyPath = path.join(fixture.repo, 'resources/cherry-studio/release-history.json')
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    history.unshift({ version: '1.1.0-rc.1', releaseNotes: 'unexpected' })
    write(fixture.repo, 'resources/cherry-studio/release-history.json', `${JSON.stringify(history, null, 2)}\n`)

    expect(() => validatePreparedRelease({ cwd: fixture.repo, targetVersion: '1.1.0-rc.1' })).toThrow(
      'unexpected set of source files'
    )
  })
})

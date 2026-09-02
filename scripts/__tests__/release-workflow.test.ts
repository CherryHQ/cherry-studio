import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { prepareBackport } from '../release/backport-patch'
import { composeReleaseBody } from '../release/compose-release-body'
import {
  extractHotfixReleaseNote,
  readBuilderReleaseNotes,
  updateHotfixReleaseMetadata
} from '../release/hotfix-release-notes'
import { validatePreparedRelease } from '../release/validate-prepared-release'
import {
  validateBuildCompletion,
  validateBuildStart,
  validatePreparationState,
  validatePublishState
} from '../release/validate-release-state'

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
  it('applies the complete squash result without backporting unrelated main changes', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    git(fixture.repo, 'checkout', '-b', 'feature')
    write(fixture.repo, 'app.txt', 'first\n')
    commit(fixture.repo, 'first fix')
    write(fixture.repo, 'second.txt', 'second\n')
    commit(fixture.repo, 'second fix')
    git(fixture.repo, 'checkout', 'main')
    write(fixture.repo, 'main-only.txt', 'not part of the fix\n')
    const mainOnlySha = commit(fixture.repo, 'unrelated main work')
    git(fixture.repo, 'merge', '--squash', 'feature')
    const mergeSha = commit(fixture.repo, 'squashed hotfix')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(runBackport(fixture, mergeSha, 2)).toMatchObject({ hasChanges: true, patchBase: mainOnlySha })
    expect(fs.readFileSync(path.join(fixture.repo, 'app.txt'), 'utf8')).toBe('first\n')
    expect(fs.readFileSync(path.join(fixture.repo, 'second.txt'), 'utf8')).toBe('second\n')
    expect(fs.existsSync(path.join(fixture.repo, 'main-only.txt'))).toBe(false)
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
    expect(fs.readFileSync(path.join(fixture.repo, 'app.txt'), 'utf8')).toBe('first\n')
    expect(fs.readFileSync(path.join(fixture.repo, 'second.txt'), 'utf8')).toBe('second\n')
  })

  it('rejects a partial rebase range when an intermediate commit is not associated with the source PR', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    write(fixture.repo, 'first.txt', 'first\n')
    commit(fixture.repo, 'first rebased fix')
    write(fixture.repo, 'second.txt', 'second\n')
    const secondCommit = commit(fixture.repo, 'second rebased fix')
    write(fixture.repo, 'third.txt', 'third\n')
    const mergeSha = commit(fixture.repo, 'third rebased fix')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(() => runBackport(fixture, mergeSha, 3, new Set([secondCommit]))).toThrow(
      'Cannot identify the complete 3-commit rebase result'
    )
    expect(git(fixture.repo, 'status', '--porcelain')).toBe('')
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
    expect(git(fixture.repo, 'diff', '--name-only')).toBe('')
    expect(git(fixture.repo, 'status', '--porcelain')).toBe('')
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

  it('rejects a symbolic link before release metadata can be updated', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    fs.symlinkSync('app.txt', path.join(fixture.repo, 'linked.txt'))
    const mergeSha = commit(fixture.repo, 'add linked file')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(() => runBackport(fixture, mergeSha, 1)).toThrow('Cannot backport a symbolic link or gitlink')
    expect(fs.existsSync(path.join(fixture.repo, 'linked.txt'))).toBe(false)
    expect(git(fixture.repo, 'status', '--porcelain')).toBe('')
  })

  it('rejects an executable mode before release metadata can be updated', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    write(fixture.repo, 'script.sh', '#!/bin/sh\n')
    fs.chmodSync(path.join(fixture.repo, 'script.sh'), 0o755)
    const mergeSha = commit(fixture.repo, 'add executable')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(() => runBackport(fixture, mergeSha, 1)).toThrow('Cannot backport a file mode change')
    expect(fs.existsSync(path.join(fixture.repo, 'script.sh'))).toBe(false)
    expect(git(fixture.repo, 'status', '--porcelain')).toBe('')
  })

  it('rejects a gitlink before release metadata can be updated', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    git(fixture.repo, 'update-index', '--add', '--cacheinfo', `160000,${base},vendor`)
    git(fixture.repo, 'commit', '-m', 'add gitlink')
    const mergeSha = git(fixture.repo, 'rev-parse', 'HEAD')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(() => runBackport(fixture, mergeSha, 1)).toThrow('Cannot backport a symbolic link or gitlink')
    expect(git(fixture.repo, 'status', '--porcelain')).toBe('')
  })

  it('rejects an existing-file mode change before release metadata can be updated', () => {
    const fixture = createGitFixture()
    const base = git(fixture.repo, 'rev-parse', 'HEAD')
    git(fixture.repo, 'config', 'core.filemode', 'true')
    fs.chmodSync(path.join(fixture.repo, 'app.txt'), 0o755)
    git(fixture.repo, 'update-index', '--chmod=+x', 'app.txt')
    git(fixture.repo, 'commit', '-m', 'make app executable')
    const mergeSha = git(fixture.repo, 'rev-parse', 'HEAD')
    markOriginMain(fixture.repo, mergeSha)
    git(fixture.repo, 'checkout', '-b', 'release', base)

    expect(() => runBackport(fixture, mergeSha, 1)).toThrow('Cannot backport a file mode change')
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
  it('accepts an optional bilingual note for an automatically backported hotfix', () => {
    expect(extractHotfixReleaseNote(HOTFIX_BODY)).toEqual({
      english: '[Chat] Fix messages disappearing after restart.',
      chinese: '[聊天] 修复重启后消息消失的问题。'
    })
    expect(extractHotfixReleaseNote('```release-note\nNONE\n```')).toBeNull()
    expect(extractHotfixReleaseNote('No release note for this internal fix.')).toBeNull()
    expect(() => extractHotfixReleaseNote(`${HOTFIX_BODY}\n\n${HOTFIX_BODY}`)).toThrow('at most one release-note block')
  })

  it('requires Chinese content in a provided Chinese description', () => {
    expect(() => extractHotfixReleaseNote(hotfixBody('[Chat] Fix the issue.', '[Chat] Fix the issue.'))).toThrow(
      'must contain Chinese content'
    )
  })

  it.each([
    HOTFIX_BODY.replace('<!--LANG:en-->', 'Unexpected preface\n<!--LANG:en-->'),
    HOTFIX_BODY.replace('<!--LANG:END-->', '<!--LANG:END-->\nUnexpected suffix')
  ])('rejects text outside the hotfix language-marker span', (body) => {
    expect(() => extractHotfixReleaseNote(body)).toThrow('exact English and Chinese language markers')
  })

  it.each([
    ['a missing component', 'Fix messages disappearing after restart.', '[聊天] 修复重启后消息消失的问题。'],
    [
      'multiple English lines',
      '[Chat] Fix messages disappearing after restart.\n[Chat] Fix another issue.',
      '[聊天] 修复重启后消息消失的问题。'
    ],
    ['a Markdown bullet prefix', '- [Chat] Fix messages disappearing.', '[聊天] 修复消息消失的问题。'],
    ['an empty component', '[] Fix messages disappearing.', '[聊天] 修复消息消失的问题。'],
    ['a missing Chinese component', '[Chat] Fix messages disappearing.', '修复消息消失的问题。'],
    [
      'multiple Chinese lines',
      '[Chat] Fix messages disappearing.',
      '[聊天] 修复消息消失的问题。\n[聊天] 修复另一个问题。'
    ],
    ['a Chinese Markdown bullet prefix', '[Chat] Fix messages disappearing.', '- [聊天] 修复消息消失的问题。'],
    ['an empty Chinese component', '[Chat] Fix messages disappearing.', '[] 修复消息消失的问题。']
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

  it.each(['```release-note\nNONE\n```', 'No release note block.'])(
    'leaves release metadata unchanged when no hotfix note is provided',
    (prBody) => {
      const fixture = createGitFixture()
      const notes = releaseNotes('1.0.0', 'Existing fix.')
      const builderPath = path.join(fixture.repo, 'electron-builder.yml')
      const historyPath = path.join(fixture.repo, 'release-history.json')
      const builder = builderYaml(notes)
      const history = `${JSON.stringify([{ version: '1.0.0', releaseNotes: notes }], null, 2)}\n`
      write(fixture.repo, 'electron-builder.yml', builder)
      write(fixture.repo, 'release-history.json', history)

      expect(updateHotfixReleaseMetadata({ builderPath, historyPath, prBody, version: '1.0.0' })).toBeNull()
      expect(fs.readFileSync(builderPath, 'utf8')).toBe(builder)
      expect(fs.readFileSync(historyPath, 'utf8')).toBe(history)
    }
  )

  it('inserts a missing bug-fix category before later release-note categories', () => {
    const fixture = createGitFixture()
    const notes = releaseNotes('1.0.0', 'Existing fix.')
      .replace('🐛 Bug Fixes\n- [Chat] Existing fix.', '💄 Improvements\n- [Chat] Existing improvement.')
      .replace('🐛 问题修复\n- [聊天] Existing fix.', '💄 改进\n- [聊天] 现有改进。')
    const builderPath = path.join(fixture.repo, 'electron-builder.yml')
    const historyPath = path.join(fixture.repo, 'release-history.json')
    write(fixture.repo, 'electron-builder.yml', builderYaml(notes))
    write(
      fixture.repo,
      'release-history.json',
      `${JSON.stringify([{ version: '1.0.0', releaseNotes: notes }], null, 2)}\n`
    )

    updateHotfixReleaseMetadata({ builderPath, historyPath, prBody: HOTFIX_BODY, version: '1.0.0' })

    const updatedNotes = readBuilderReleaseNotes(fs.readFileSync(builderPath, 'utf8')).releaseNotes
    expect(updatedNotes.indexOf('🐛 Bug Fixes')).toBeLessThan(updatedNotes.indexOf('💄 Improvements'))
    expect(updatedNotes.indexOf('🐛 问题修复')).toBeLessThan(updatedNotes.indexOf('💄 改进'))
  })
})

function createPreparedReleaseFixture(targetVersion = '1.1.0', baseVersion = '1.0.0'): GitFixture {
  const fixture = createGitFixture()
  const oldNotes = releaseNotes(baseVersion, 'Old fix.')
  write(fixture.repo, 'package.json', `${JSON.stringify({ name: 'release-test', version: baseVersion }, null, 2)}\n`)
  write(fixture.repo, 'electron-builder.yml', builderYaml(oldNotes))
  write(
    fixture.repo,
    'resources/cherry-studio/release-history.json',
    `${JSON.stringify([{ version: baseVersion, releaseNotes: oldNotes }], null, 2)}\n`
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
          { version: baseVersion, releaseNotes: oldNotes }
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

  it('uses semantic rather than lexical version ordering', () => {
    const upgradeFixture = createPreparedReleaseFixture('1.10.0', '1.9.0')
    expect(() => validatePreparedRelease({ cwd: upgradeFixture.repo, targetVersion: '1.10.0' })).not.toThrow()

    const downgradeFixture = createPreparedReleaseFixture('1.9.0', '1.10.0')
    expect(() => validatePreparedRelease({ cwd: downgradeFixture.repo, targetVersion: '1.9.0' })).toThrow(
      'must be greater than 1.10.0'
    )
  })

  it('rejects missing or duplicate language markers', () => {
    const missingMarkerFixture = createPreparedReleaseFixture()
    const missingMarkerBuilder = path.join(missingMarkerFixture.repo, 'electron-builder.yml')
    fs.writeFileSync(
      missingMarkerBuilder,
      fs.readFileSync(missingMarkerBuilder, 'utf8').replace('<!--LANG:zh-CN-->', '<!--LANG:missing-->')
    )
    expect(() => validatePreparedRelease({ cwd: missingMarkerFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'one ordered set of bilingual markers'
    )

    const duplicateMarkerFixture = createPreparedReleaseFixture()
    const duplicateMarkerBuilder = path.join(duplicateMarkerFixture.repo, 'electron-builder.yml')
    fs.writeFileSync(
      duplicateMarkerBuilder,
      fs
        .readFileSync(duplicateMarkerBuilder, 'utf8')
        .replace('<!--LANG:zh-CN-->', '<!--LANG:en-->\n    <!--LANG:zh-CN-->')
    )
    expect(() => validatePreparedRelease({ cwd: duplicateMarkerFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'one ordered set of bilingual markers'
    )
  })

  it('accepts release-note presentation variations while requiring both language sections', () => {
    const flexibleFixture = createPreparedReleaseFixture()
    const flexibleNotes = `Release announcement\n${releaseNotes('1.0.0', 'New fix.')}\nRead more on the website.`
    write(flexibleFixture.repo, 'electron-builder.yml', builderYaml(flexibleNotes))
    const historyPath = path.join(flexibleFixture.repo, 'resources/cherry-studio/release-history.json')
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    history[0].releaseNotes = flexibleNotes
    write(flexibleFixture.repo, 'resources/cherry-studio/release-history.json', `${JSON.stringify(history, null, 2)}\n`)

    expect(() => validatePreparedRelease({ cwd: flexibleFixture.repo, targetVersion: '1.1.0' })).not.toThrow()

    const emptySectionFixture = createPreparedReleaseFixture()
    write(
      emptySectionFixture.repo,
      'electron-builder.yml',
      builderYaml('<!--LANG:en-->\n\n<!--LANG:zh-CN-->\n中文说明\n<!--LANG:END-->')
    )
    expect(() => validatePreparedRelease({ cwd: emptySectionFixture.repo, targetVersion: '1.1.0' })).toThrow(
      'non-empty English and Chinese sections'
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

  it('accepts prerelease preparation when release history stays unchanged', () => {
    const fixture = createPreparedReleaseFixture('1.1.0-rc.1')
    expect(() => validatePreparedRelease({ cwd: fixture.repo, targetVersion: '1.1.0-rc.1' })).not.toThrow()
  })

  it('revalidates prepared metadata after the trusted product manifest is generated', () => {
    const fixture = createPreparedReleaseFixture()
    write(fixture.repo, 'resources/builtin-agents/cherry-assistant/product-manifest.json', '{"version":"1.1.0"}\n')

    expect(() =>
      validatePreparedRelease({ cwd: fixture.repo, includeGeneratedManifest: true, targetVersion: '1.1.0' })
    ).not.toThrow()
  })
})

describe('release preparation state', () => {
  it('rejects an existing target release without blocking unrelated drafts', () => {
    const unrelatedDraft = { draft: true, tag_name: 'v1.1.0' }

    expect(() => validatePreparationState({ releasePages: [[unrelatedDraft]], tag: 'v1.2.0' })).not.toThrow()
    expect(() =>
      validatePreparationState({ releasePages: [[unrelatedDraft, { draft: true, tag_name: 'v1.2.0' }]], tag: 'v1.2.0' })
    ).toThrow('Release v1.2.0 already exists')
  })

  it('reads the release list from stdin instead of the process environment', () => {
    const validatorPath = path.resolve(import.meta.dirname, '../release/validate-release-state.js')
    const result = spawnSync(process.execPath, [validatorPath, 'prepare'], {
      encoding: 'utf8',
      env: { ...process.env, RELEASE_PAGES_JSON: '', TAG: 'v1.2.0' },
      input: JSON.stringify([[{ draft: true, tag_name: 'v1.1.0' }]])
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
  })
})

describe('release publication state', () => {
  const workflowSha = 'a'.repeat(40)
  const expectedBuildTitle = `Release build all release/v1.2.0 @ ${workflowSha}`
  const successfulBuild = {
    conclusion: 'success',
    display_title: expectedBuildTitle,
    event: 'workflow_dispatch',
    head_sha: workflowSha,
    status: 'completed'
  }
  const draftRelease = {
    assets: [{ id: 1 }],
    body: 'Release notes',
    draft: true,
    tag_name: 'v1.2.0',
    target_commitish: workflowSha
  }

  it('combines curated bilingual notes with GitHub generated changes', () => {
    const builderContent = [
      'releaseInfo:',
      '  releaseNotes: |',
      '    <!--LANG:en-->',
      '    English notes',
      '    <!--LANG:zh-CN-->',
      '    中文说明',
      '    <!--LANG:END-->',
      ''
    ].join('\n')

    expect(composeReleaseBody({ builderContent, generatedNotes: "## What's Changed\n- Fix one\n" })).toBe(
      [
        '<!--LANG:en-->',
        'English notes',
        '<!--LANG:zh-CN-->',
        '中文说明',
        '<!--LANG:END-->',
        '',
        '---',
        '',
        "## What's Changed",
        '- Fix one',
        ''
      ].join('\n')
    )
    expect(composeReleaseBody({ builderContent, generatedNotes: '' })).toBe(
      '<!--LANG:en-->\nEnglish notes\n<!--LANG:zh-CN-->\n中文说明\n<!--LANG:END-->\n'
    )
  })

  it('accepts only an exact-head all-platform build with artifacts and no open release pull request', () => {
    expect(() =>
      validatePublishState({
        branchSha: workflowSha,
        buildRun: successfulBuild,
        expectedBuildTitle,
        openReleasePullRequests: '',
        pendingHotfixes: '',
        release: draftRelease,
        tag: 'v1.2.0',
        tagSha: workflowSha,
        workflowSha
      })
    ).not.toThrow()
  })

  it.each([
    ['a missing release', null, workflowSha, workflowSha, '', '', successfulBuild, 'must exist and still be a draft'],
    [
      'a published release',
      { ...draftRelease, draft: false },
      workflowSha,
      workflowSha,
      '',
      '',
      successfulBuild,
      'must exist and still be a draft'
    ],
    [
      'a mismatched tag',
      draftRelease,
      'b'.repeat(40),
      workflowSha,
      '',
      '',
      successfulBuild,
      'Tag, release branch, and selected workflow commit must be identical'
    ],
    [
      'a mismatched release target',
      { ...draftRelease, target_commitish: 'b'.repeat(40) },
      workflowSha,
      workflowSha,
      '',
      '',
      successfulBuild,
      'does not target'
    ],
    [
      'a mismatched branch',
      draftRelease,
      workflowSha,
      'b'.repeat(40),
      '',
      '',
      successfulBuild,
      'Tag, release branch, and selected workflow commit must be identical'
    ],
    [
      'an open release pull request',
      draftRelease,
      workflowSha,
      workflowSha,
      'https://example.test/pr',
      '',
      successfulBuild,
      'Release branch still has open pull requests'
    ],
    [
      'a pending merged hotfix',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      'https://example.test/hotfix',
      successfulBuild,
      'Merged hotfix pull requests are still waiting for this release'
    ],
    [
      'a missing build',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      '',
      null,
      'No successful all-platform Release build exists'
    ],
    [
      'a wrong build title',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      '',
      { ...successfulBuild, display_title: 'wrong' },
      'No successful all-platform Release build exists'
    ],
    [
      'a stale build',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      '',
      { ...successfulBuild, head_sha: 'b'.repeat(40) },
      'No successful all-platform Release build exists'
    ],
    [
      'a non-dispatch build',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      '',
      { ...successfulBuild, event: 'push' },
      'No successful all-platform Release build exists'
    ],
    [
      'an incomplete build',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      '',
      { ...successfulBuild, status: 'in_progress' },
      'No successful all-platform Release build exists'
    ],
    [
      'a failed build',
      draftRelease,
      workflowSha,
      workflowSha,
      '',
      '',
      { ...successfulBuild, conclusion: 'failure' },
      'No successful all-platform Release build exists'
    ],
    [
      'a draft without artifacts',
      { ...draftRelease, assets: [] },
      workflowSha,
      workflowSha,
      '',
      '',
      successfulBuild,
      'has no artifacts'
    ],
    [
      'a draft without release notes',
      { ...draftRelease, body: '' },
      workflowSha,
      workflowSha,
      '',
      '',
      successfulBuild,
      'has no release notes'
    ]
  ])(
    'rejects publication with %s',
    (_case, release, tagSha, branchSha, openReleasePullRequests, pendingHotfixes, buildRun, expectedError) => {
      expect(() =>
        validatePublishState({
          branchSha,
          buildRun,
          expectedBuildTitle,
          openReleasePullRequests,
          pendingHotfixes,
          release,
          tag: 'v1.2.0',
          tagSha,
          workflowSha
        })
      ).toThrow(expectedError)
    }
  )

  it('allows all-platform draft movement but restricts single-platform retries to the existing tag', () => {
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'all',
        release: null,
        remoteTagSha: '',
        tag: 'v1.2.0',
        workflowSha
      })
    ).not.toThrow()
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'all',
        release: draftRelease,
        remoteTagSha: 'b'.repeat(40),
        tag: 'v1.2.0',
        workflowSha
      })
    ).not.toThrow()
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'mac',
        release: draftRelease,
        remoteTagSha: workflowSha,
        tag: 'v1.2.0',
        workflowSha
      })
    ).not.toThrow()
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'all',
        release: null,
        remoteTagSha: 'b'.repeat(40),
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('exists without a draft release')
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'all',
        release: { ...draftRelease, draft: false },
        remoteTagSha: workflowSha,
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('already published')
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'linux',
        release: draftRelease,
        remoteTagSha: 'b'.repeat(40),
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('requires an existing draft whose tag already points')
    expect(() =>
      validateBuildStart({
        branchSha: workflowSha,
        platform: 'windows',
        release: null,
        remoteTagSha: workflowSha,
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('requires an existing draft whose tag already points')
    expect(() =>
      validateBuildStart({
        branchSha: 'b'.repeat(40),
        platform: 'all',
        release: draftRelease,
        remoteTagSha: workflowSha,
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('Release branch moved away from selected workflow commit')
    expect(() =>
      validateBuildCompletion({
        branchSha: workflowSha,
        release: { draft: false },
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('refusing any post-publication tag mutation')
    expect(() =>
      validateBuildCompletion({
        branchSha: 'b'.repeat(40),
        release: draftRelease,
        tag: 'v1.2.0',
        workflowSha
      })
    ).toThrow('Release branch moved away from selected workflow commit')
  })
})

describe('release workflow gates', () => {
  const repoRoot = path.resolve(import.meta.dirname, '../..')
  const workflowRoot = path.resolve(import.meta.dirname, '../..', '.github/workflows')

  it('revalidates the selected release branch head before draft mutation and tag movement', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'release.yml'), 'utf8'))
    const finalizeSteps = workflow.jobs['finalize-build'].steps
    const headStep = finalizeSteps.find((step: { name?: string }) => step.name === 'Revalidate current release head')
    const releaseIndex = finalizeSteps.findIndex(
      (step: { name?: string }) => step.name === 'Create or update draft release'
    )
    const uploadedStep = finalizeSteps.find((step: { name?: string }) => step.name === 'Validate uploaded draft')
    const tagStep = finalizeSteps.find(
      (step: { name?: string }) => step.name === 'Move draft tag with lease after artifact upload'
    )
    const draftStep = finalizeSteps.find((step: { name?: string }) => step.name === 'Create or update draft release')

    expect(finalizeSteps.indexOf(headStep)).toBeLessThan(releaseIndex)
    expect(headStep.run).toContain('BRANCH_SHA="$BRANCH_SHA"')
    expect(draftStep.id).toBe('draft-release')
    expect(uploadedStep.run).toContain('BRANCH_SHA="$BRANCH_SHA"')
    expect(uploadedStep.run).toContain('releases/$RELEASE_ID')
    expect(uploadedStep.run).not.toContain('releases/tags/')
    expect(tagStep.run).toContain('BRANCH_SHA="$BRANCH_SHA"')
    expect(tagStep.run).toContain('node scripts/release/validate-release-state.js build-completion')
    expect(tagStep.run).toContain('gh api --method POST "repos/$REPO/git/refs"')
    expect(tagStep.run).toContain('beforeOid: $beforeOid')
  })

  it('requires environment approval before validating and publishing the exact build', () => {
    const releaseWorkflow = parse(fs.readFileSync(path.join(workflowRoot, 'release.yml'), 'utf8'))
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'publish-release.yml'), 'utf8'))
    const publishSteps = workflow.jobs.publish.steps
    const publishStep = publishSteps.find(
      (step: { name?: string }) => step.name === 'Validate and publish current draft'
    )

    expect(releaseWorkflow.on.workflow_dispatch.inputs).not.toHaveProperty('operation')
    expect(releaseWorkflow.jobs).not.toHaveProperty('publish-release')
    expect(workflow.jobs.preflight.steps[0].run).toContain('APPROVER_TEAM_ID')
    expect(workflow.jobs.preflight.steps[0].run).toContain('.prevent_self_review == true')
    expect(workflow.jobs.preflight.steps[0].run).toContain('(.reviewers | length) == 1')
    expect(workflow.jobs.preflight.steps[0].run).toContain('.name == "main"')
    expect(workflow.jobs.approve.needs).toBe('preflight')
    expect(workflow.jobs.approve.environment).toBe('release')
    expect(workflow.jobs.publish.needs).toBe('approve')
    expect(workflow.jobs.publish.concurrency.group).toBe('release-state')
    expect(workflow.jobs.approve).not.toHaveProperty('concurrency')
    expect(workflow.jobs.publish.steps[0].with.ref).toBe('${{ github.workflow_sha }}')
    expect(publishStep.run.match(/validate-release-state\.js publish/g)).toHaveLength(1)
    expect(publishStep.run.indexOf('HOTFIX_CUTOFF_SHA=')).toBeLessThan(
      publishStep.run.indexOf('validate-release-state.js publish')
    )
    expect(publishStep.run.indexOf('validate-release-state.js publish')).toBeLessThan(
      publishStep.run.indexOf('gh api --method PATCH')
    )
    expect(publishStep.run).toContain('repos/$REPO/actions/runs/$BUILD_RUN_ID')
    expect(publishStep.run).toContain('releases?per_page=100')
    expect(publishStep.run).not.toContain('releases/tags/')
  })

  it('dispatches one all-platform build only for the current successful release head', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'auto-release-build.yml'), 'utf8'))
    const dispatchStep = workflow.jobs.dispatch.steps.find(
      (step: { name?: string }) => step.name === 'Revalidate and dispatch release build'
    )
    const releaseWorkflow = parse(fs.readFileSync(path.join(workflowRoot, 'release.yml'), 'utf8'))
    const expectedShaStep = releaseWorkflow.jobs.prepare.steps.find(
      (step: { name?: string }) => step.name === 'Verify automatically selected release commit'
    )

    expect(workflow.on.workflow_run.workflows).toEqual(['CI'])
    expect(workflow.jobs.dispatch.if).toContain("github.event.workflow_run.event == 'push'")
    expect(workflow.jobs.dispatch.if).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository'
    )
    expect(dispatchStep.run).toContain('if [ "$BRANCH_SHA" != "$CI_SHA" ]')
    expect(dispatchStep.run).toContain('Release build all $BRANCH @ $CI_SHA')
    expect(dispatchStep.run).toContain('gh workflow run release.yml')
    expect(dispatchStep.run).toContain('-f platform=all')
    expect(dispatchStep.run).toContain('-f expected_sha="$CI_SHA"')
    expect(releaseWorkflow.on.workflow_dispatch.inputs.expected_sha.required).toBe(false)
    expect(expectedShaStep.if).toBe("inputs.expected_sha != ''")
    expect(expectedShaStep.run).toContain('if [ "$GITHUB_SHA" != "$EXPECTED_SHA" ]')
    expect(releaseWorkflow.jobs.prepare.steps.indexOf(expectedShaStep)).toBe(0)
  })

  it('reports a merged hotfix contract failure before release resolution', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'backport-release-fixes.yml'), 'utf8'))
    const backportSteps = workflow.jobs.backport.steps
    const contractStep = backportSteps.find((step: { id?: string }) => step.id === 'hotfix-contract')
    const contractIndex = backportSteps.indexOf(contractStep)
    const releaseRefIndex = backportSteps.findIndex((step: { id?: string }) => step.id === 'release-ref')
    const failureStep = backportSteps.find(
      (step: { name?: string }) => step.name === 'Synchronize failed backport state'
    )

    expect(contractStep.run).toContain('$RUNNER_TEMP/backport-failure-message')
    expect(contractStep.run).toContain('node scripts/release/hotfix-release-notes.js --check')
    expect(contractIndex).toBeLessThan(releaseRefIndex)
    expect(failureStep.if).toBe('always() && failure()')
    expect(failureStep.env.CONTRACT_OUTCOME).toBe('${{ steps.hotfix-contract.outcome }}')
    expect(failureStep.run).toContain('if [ "$CONTRACT_OUTCOME" = "failure" ]; then')
    expect(failureStep.run).toContain('gh pr comment')
  })

  it('classifies hotfix labels from the title before validating an optional release note', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'backport-release-fixes.yml'), 'utf8'))
    const classifyStep = workflow.jobs.classify.steps.find(
      (step: { name?: string }) => step.name === 'Synchronize hotfix label'
    )
    const addLabelIndex = classifyStep.run.indexOf('--add-label "hotfix"')
    const noteCheckIndex = classifyStep.run.indexOf('hotfix-release-notes.js --check')

    expect(addLabelIndex).toBeGreaterThan(-1)
    expect(addLabelIndex).toBeLessThan(noteCheckIndex)
  })

  it('builds preview source commits without repository or service credentials', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'preview-release.yml'), 'utf8'))
    const sourceStep = workflow.jobs.resolve.steps.find(
      (step: { name?: string }) => step.name === 'Resolve source branch'
    )
    const checkoutStep = workflow.jobs.build.steps.find(
      (step: { name?: string }) => step.name === 'Check out preview commit'
    )
    const sourceSteps = workflow.jobs.build.steps.filter((step: { name?: string }) => step.name?.startsWith('Build '))

    expect(checkoutStep.with['persist-credentials']).toBe(false)
    expect(sourceStep.run).toContain('BRANCH_SLUG="sha-${SOURCE_SHA:0:12}"')
    for (const step of sourceSteps) {
      expect(Object.keys(step.env ?? {})).not.toContain('GH_TOKEN')
      expect(Object.keys(step.env ?? {}).every((key) => !key.includes('SECRET') && !key.startsWith('APPLE_'))).toBe(
        true
      )
    }
  })

  it('signs preview macOS apps only in the protected trusted workflow', () => {
    const previewWorkflow = parse(fs.readFileSync(path.join(workflowRoot, 'preview-release.yml'), 'utf8'))
    const signingWorkflow = parse(fs.readFileSync(path.join(workflowRoot, 'sign-preview-macos.yml'), 'utf8'))
    const macBuildStep = previewWorkflow.jobs.build.steps.find((step: { name?: string }) => step.name === 'Build Mac')
    const checkoutStep = signingWorkflow.jobs.sign.steps.find(
      (step: { name?: string }) => step.name === 'Check out trusted signing code'
    )
    const signingStep = signingWorkflow.jobs.sign.steps.find(
      (step: { name?: string }) => step.name === 'Sign, notarize, and package macOS applications'
    )

    expect(macBuildStep.env).not.toHaveProperty('CSC_LINK')
    expect(macBuildStep.env).not.toHaveProperty('APPLE_ID')
    expect(signingWorkflow.on.workflow_run.workflows).toEqual(['Preview Release'])
    expect(signingWorkflow.jobs.sign.environment).toBe('release')
    expect(checkoutStep.with.ref).toBe('${{ github.workflow_sha }}')
    expect(checkoutStep.with['persist-credentials']).toBe(false)
    expect(signingStep.env).toHaveProperty('APPLE_ID')

    const signingScript = fs.readFileSync(path.join(repoRoot, 'scripts/release/sign-preview-macos.js'), 'utf8')
    expect(signingScript).toContain("['--verify', '--deep', '--strict', '--verbose=2', appPath]")
    expect(signingScript).toContain("['--assess', '--type', 'execute', '--verbose=4', appPath]")
    expect(signingScript).toContain("['stapler', 'validate', appPath]")
  })

  it('syncs post-release metadata from the published tag without depending on the release branch head', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'post-release.yml'), 'utf8'))
    const metadataStep = workflow.jobs['sync-release-metadata'].steps.find(
      (step: { name?: string }) => step.name === 'Prepare published metadata changes'
    )
    const payloadStep = workflow.jobs['sync-release-metadata'].steps.find(
      (step: { name?: string }) => step.name === 'Create signed metadata commit payload'
    )

    expect(metadataStep.run).toContain('refs/tags/$TAG:refs/tags/$TAG')
    expect(metadataStep.run).not.toContain('refs/heads/$RELEASE_BRANCH')
    expect(metadataStep.run).not.toContain('BRANCH_SHA')
    expect(payloadStep.run).not.toContain('Unexpected release metadata change')
    expect(payloadStep.run).not.toContain('must not change file mode')
  })

  it('copies only known preparation files and revalidates them before creating the release branch', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'prepare-release.yml'), 'utf8'))
    const validationStep = workflow.jobs.publish.steps.find(
      (step: { name?: string }) => step.name === 'Validate prepared release artifact'
    )

    expect(validationStep.run.indexOf('fs.copyFileSync')).toBeLessThan(
      validationStep.run.indexOf('validate-prepared-release.js')
    )
    expect(validationStep.run).toContain('--include-generated-manifest')
    expect(validationStep.run).not.toContain('function walk')
    expect(validationStep.run).not.toContain('unexpected file set')
    expect(validationStep.run).not.toContain('git status')
  })

  it('restores the frozen release head and keeps only prepared metadata changes', () => {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, 'prepare-release.yml'), 'utf8'))
    const prepareSteps = workflow.jobs.prepare.steps
    const claudeStep = prepareSteps.find((step: { name?: string }) => step.name === 'Prepare Release via Claude')
    const retainStep = prepareSteps.find((step: { name?: string }) => step.name === 'Retain prepared release metadata')
    const validationIndex = prepareSteps.findIndex(
      (step: { name?: string }) => step.name === 'Validate prepared release metadata'
    )

    expect(claudeStep.with.claude_args).toContain('Bash(git:*)')
    expect(claudeStep.with.claude_args).toContain('Bash(node:*)')
    expect(retainStep.run).toContain('git diff --binary --full-index')
    expect(retainStep.run).toContain('git reset --hard "$RELEASE_HEAD"')
    expect(retainStep.run).toContain('git clean -fd')
    expect(retainStep.run).toContain('git apply "$RELEASE_PATCH"')
    expect(prepareSteps.indexOf(retainStep)).toBeLessThan(validationIndex)

    const fixture = createGitFixture()
    write(fixture.repo, 'package.json', '{"version":"1.0.0"}\n')
    write(fixture.repo, 'electron-builder.yml', 'releaseInfo:\n  releaseNotes: old\n')
    write(fixture.repo, 'resources/cherry-studio/release-history.json', '[]\n')
    const releaseHead = commit(fixture.repo, 'release metadata')

    write(fixture.repo, 'package.json', '{"version":"1.1.0"}\n')
    write(fixture.repo, 'electron-builder.yml', 'releaseInfo:\n  releaseNotes: new\n')
    write(fixture.repo, 'resources/cherry-studio/release-history.json', '[{"version":"1.1.0"}]\n')
    write(fixture.repo, 'app.txt', 'unexpected tracked change\n')
    write(fixture.repo, '.release-prep/prepare.js', 'temporary helper\n')
    commit(fixture.repo, 'temporary local release preparation')

    const runnerTemp = path.join(fixture.root, 'runner-temp')
    fs.mkdirSync(runnerTemp)
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', retainStep.run], {
      cwd: fixture.repo,
      env: { ...process.env, RELEASE_HEAD: releaseHead, RUNNER_TEMP: runnerTemp }
    })

    expect(git(fixture.repo, 'rev-parse', 'HEAD')).toBe(releaseHead)
    expect(fs.readFileSync(path.join(fixture.repo, 'package.json'), 'utf8')).toBe('{"version":"1.1.0"}\n')
    expect(fs.readFileSync(path.join(fixture.repo, 'electron-builder.yml'), 'utf8')).toContain('releaseNotes: new')
    expect(fs.readFileSync(path.join(fixture.repo, 'app.txt'), 'utf8')).toBe('base\n')
    expect(fs.existsSync(path.join(fixture.repo, '.release-prep'))).toBe(false)
    expect(git(fixture.repo, 'diff', '--name-only').split('\n').sort()).toEqual([
      'electron-builder.yml',
      'package.json',
      'resources/cherry-studio/release-history.json'
    ])
  })

  it('runs release workflow contract tests for release-workflow-only pull requests', () => {
    const workflow = fs.readFileSync(path.join(workflowRoot, 'ci.yml'), 'utf8')
    for (const workflowName of [
      'backport-release-fixes.yml',
      'auto-release-build.yml',
      'post-release.yml',
      'prepare-release.yml',
      'preview-release.yml',
      'publish-release.yml',
      'release.yml',
      'sign-preview-macos.yml'
    ]) {
      expect(workflow).toContain(`- '.github/workflows/${workflowName}'`)
    }
  })
})

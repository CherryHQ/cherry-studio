import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.resolve(__dirname, '../..')
const workflow = parse(fs.readFileSync(path.join(projectRoot, '.github/workflows/prepare-release.yml'), 'utf8'))
const baselineStep = workflow.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'release-baseline')
const versionStep = workflow.jobs.prepare.steps.find((step: { id?: string }) => step.id === 'release-version')
const roots: string[] = []

function createFixture(currentVersion = '2.1.1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-baseline-'))
  roots.push(root)
  const repo = path.join(root, 'repo')
  fs.mkdirSync(repo)
  const config = path.join(root, 'gitconfig')
  fs.writeFileSync(config, '')
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    NODE_PATH: path.join(projectRoot, 'node_modules'),
    REPO: 'test/release',
    GITHUB_OUTPUT: path.join(root, 'output'),
    RELEASE_FIXTURE: path.join(root, 'releases.json')
  }
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim()
  const commit = (message: string) => {
    git('add', '.')
    git('commit', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release-test@example.com')
  git('remote', 'add', 'origin', repo)
  fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"2.1.0"}\n')
  const publishedSha = commit('chore(release): prepare v2.1.0')
  git('tag', 'v2.1.0')
  fs.writeFileSync(path.join(repo, 'fix.txt'), 'fix included in withdrawn release\n')
  const withdrawnFix = commit('fix(chat): restore messages')
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: currentVersion }))
  commit('chore(release): sync v2.1.1 metadata')
  const run = (releases: object[], script = baselineStep.run, extraEnv = {}) => {
    fs.writeFileSync(env.RELEASE_FIXTURE, JSON.stringify([releases]))
    fs.writeFileSync(env.GITHUB_OUTPUT, '')
    const renderedScript = script.replaceAll('${{ github.event.inputs.version }}', '$REQUESTED_VERSION')
    const result = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', `gh() { cat "$RELEASE_FIXTURE"; }\n${renderedScript}`],
      {
        cwd: repo,
        env: { ...env, ...extraEnv },
        encoding: 'utf8'
      }
    )
    const output = Object.fromEntries(
      fs
        .readFileSync(env.GITHUB_OUTPUT, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('='))
    )
    return { ...result, output }
  }
  return { repo, git, commit, run, publishedSha, withdrawnFix }
}

const published = { tag_name: 'v2.1.0', draft: false, published_at: '2026-09-18T00:00:00Z' }

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

// These steps target Ubuntu runners; Windows Bash cannot consume native fixture paths.
describe.skipIf(process.platform === 'win32')('release preparation baseline', () => {
  it.each(['deleted', 'draft'])('prepares 2.1.2 with the withdrawn changes when 2.1.1 is %s', (state) => {
    const fixture = createFixture()
    if (state === 'draft') fixture.git('tag', 'v2.1.1')
    const releases =
      state === 'draft' ? [published, { tag_name: 'v2.1.1', draft: true, published_at: null }] : [published]
    const baseline = fixture.run(releases)

    expect(baseline.status, baseline.stderr).toBe(0)
    expect(baseline.output.version).toBe('2.1.1')
    expect(baseline.output.tag).toBe('v2.1.0')
    const changes = fixture.git('log', `${baseline.output['collection-base']}..HEAD`, '--format=%H').split('\n')
    expect(changes).toContain(fixture.withdrawnFix)
    expect(changes).not.toContain(fixture.publishedSha)
    for (const requested of ['patch', '2.1.2']) {
      const version = fixture.run(releases, versionStep.run, {
        CURRENT_VERSION: baseline.output.version,
        REQUESTED_VERSION: requested
      })
      expect(version.status, version.stderr).toBe(0)
      expect(version.output.version).toBe('2.1.2')
    }
  })

  it('prepares the next version when main matches the published release', () => {
    const fixture = createFixture('2.1.0')
    const result = fixture.run([published])
    expect(result.status, result.stderr).toBe(0)
    expect(result.output).toEqual({ version: '2.1.0', tag: 'v2.1.0', 'collection-base': 'v2.1.0' })
  })

  it('blocks preparation when published metadata has not reached main', () => {
    const fixture = createFixture('2.0.9')
    const result = fixture.run([published])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Merge the latest Post Release metadata pull request')
  })

  it('requires a published semantic-version release and its Git tag', () => {
    const fixture = createFixture()
    const noRelease = fixture.run([{ ...published, tag_name: 'preview-main-abcd' }])
    expect(noRelease.status).not.toBe(0)
    expect(noRelease.stderr).toContain('No published release exists')
    fixture.git('tag', '-d', 'v2.1.0')
    const noTag = fixture.run([published])
    expect(noTag.status).not.toBe(0)
    expect(noTag.stderr).toContain('Published baseline tag v2.1.0 is missing')
  })

  it('uses the published metadata boundary when the tag is on a separate release branch', () => {
    const fixture = createFixture()
    fixture.git('checkout', '-b', 'release', fixture.publishedSha)
    fs.writeFileSync(path.join(fixture.repo, 'release-only.txt'), 'release metadata\n')
    const releaseSha = fixture.commit('chore(release): build v2.1.0')
    fixture.git('tag', '-f', 'v2.1.0', releaseSha)
    fixture.git('checkout', 'main')
    const missingBoundary = fixture.run([published])
    expect(missingBoundary.status).not.toBe(0)
    expect(missingBoundary.stderr).toContain('metadata boundary is missing')

    fixture.git('checkout', '-b', 'with-boundary', fixture.publishedSha)
    fs.writeFileSync(path.join(fixture.repo, 'synced.txt'), 'published metadata\n')
    const boundary = fixture.commit('chore(release): metadata sync\n\nrelease-metadata-boundary: v2.1.0')
    fixture.git('cherry-pick', fixture.withdrawnFix)
    fs.writeFileSync(path.join(fixture.repo, 'package.json'), '{"version":"2.1.1"}\n')
    fixture.commit('chore(release): sync v2.1.1 metadata')
    const result = fixture.run([published])
    expect(result.status, result.stderr).toBe(0)
    expect(result.output['collection-base']).toBe(boundary)
    expect(fixture.git('log', `${boundary}..HEAD`, '--format=%s')).toContain('fix(chat): restore messages')
  })
})

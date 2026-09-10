import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { latestStableRelease, planLinePublication, updateLatestRelease } from '../release/publish-release-line'

const repo = { owner: 'owner', repo: 'project' }
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-line-test-'))
  roots.push(cwd)
  const configPath = path.join(cwd, 'gitconfig')
  fs.writeFileSync(configPath, '')
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: configPath, GIT_CONFIG_NOSYSTEM: '1' }
    }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release@example.com')
  git('commit', '--allow-empty', '-m', 'included fix')
  const included = git('rev-parse', 'HEAD')
  git('commit', '--allow-empty', '-m', 'later fix')
  const later = git('rev-parse', 'HEAD')
  const config = { mode: 'minor-line', current: '2.1.x', previous: '2.0.x' as string | null, candidate: '2.2.x' }
  const prs = [
    {
      base: 'release/2.0.x',
      milestone: { title: 'v2.0.14' },
      merged_at: 'today',
      merge_commit_sha: included,
      html_url: 'included'
    },
    {
      base: 'release/2.0.x',
      milestone: { title: 'v2.0.15' },
      merged_at: null,
      merge_commit_sha: null,
      html_url: 'next-version'
    },
    {
      base: 'release/2.1.x',
      milestone: { title: 'v2.0.14' },
      merged_at: null,
      merge_commit_sha: null,
      html_url: 'other-line'
    }
  ]
  const github = {
    paginate: async <T>(method: (params: never) => Promise<{ data: T[] }>, params: never) =>
      (await method(params)).data,
    rest: {
      repos: {
        get: async () => ({ data: { default_branch: 'main' } }),
        getContent: async ({ path }: { path: string }) => ({
          data: {
            content: Buffer.from(JSON.stringify(path === 'package.json' ? { version: '2.0.14' } : config)).toString(
              'base64'
            )
          }
        })
      },
      pulls: { list: async ({ base }: { base: string }) => ({ data: prs.filter((pr) => pr.base === base) }) }
    }
  }
  const plan = (branch = 'release/2.0.x') => planLinePublication({ github, repo, branch, sha: included, cwd })
  return { config, prs, included, later, plan }
}

describe('line publication scope', () => {
  it('accepts included scheduled fixes without blocking future versions or other lines', async () => {
    expect(await fixture().plan()).toEqual({ mode: 'minor-line', tag: 'v2.0.14', pending: [] })
  })

  it('reports open, closed-unmerged, and merged-after-build scheduled PRs', async () => {
    const f = fixture()
    f.prs.push(
      {
        base: 'release/2.0.x',
        milestone: { title: 'v2.0.14' },
        merged_at: null,
        merge_commit_sha: null,
        html_url: 'open'
      },
      {
        base: 'release/2.0.x',
        milestone: { title: 'v2.0.14' },
        merged_at: null,
        merge_commit_sha: null,
        html_url: 'closed-unmerged'
      },
      {
        base: 'release/2.0.x',
        milestone: { title: 'v2.0.14' },
        merged_at: 'today',
        merge_commit_sha: f.later,
        html_url: 'later'
      }
    )
    expect((await f.plan()).pending).toEqual(['open', 'closed-unmerged', 'later'])
  })

  it('rejects unsupported lines and branch/version mismatches', async () => {
    const f = fixture()
    await expect(f.plan('release/2.1.x')).rejects.toThrow('disagree')
    f.config.previous = null
    await expect(f.plan()).rejects.toThrow('not enabled')
  })

  it('preserves exact-version publication until activation', async () => {
    const f = fixture()
    f.config.mode = 'exact-version'
    expect(await f.plan('release/v2.0.14')).toEqual({ mode: 'exact-version', tag: 'v2.0.14', pending: [] })
    await expect(f.plan()).rejects.toThrow('Exact-version publication')
  })
})

describe('Latest ownership', () => {
  const release = (id: number, tag: string, date = '2026-09-09') => ({
    id,
    tag_name: tag,
    published_at: date,
    draft: false,
    prerelease: false
  })

  it('selects the highest stable version, not the last published maintenance patch', () => {
    const current = release(1, 'v2.1.5')
    expect(latestStableRelease([current, release(2, 'v2.0.15', '2026-09-10')])).toEqual(current)
  })

  it('excludes drafts, prereleases and preview tags, and promotes the first candidate stable', () => {
    const candidate = release(4, 'v2.2.0')
    const releases = [
      release(1, 'v2.1.5'),
      release(2, 'v2.2.0-rc.1'),
      { ...release(3, 'v3.0.0'), draft: true },
      release(5, 'preview-main'),
      { ...release(6, 'v4.0.0'), prerelease: true },
      candidate
    ]
    expect(latestStableRelease(releases)).toEqual(candidate)
    expect(latestStableRelease([release(1, 'preview-main')])).toBeUndefined()
  })

  it('recomputes Latest when an older-line job runs after a newer publication without changing tags or assets', async () => {
    const releases = [release(1, 'v2.1.5'), release(2, 'v2.0.15')]
    let latestId = 0
    const github = {
      paginate: async () => releases,
      rest: {
        repos: {
          listReleases: async () => ({ data: releases }),
          updateRelease: async (update: Record<string, unknown>) => {
            expect(Object.keys(update).sort()).toEqual(['make_latest', 'owner', 'release_id', 'repo', 'tag_name'])
            expect(update.make_latest).toBe('true')
            latestId = Number(update.release_id)
          }
        }
      }
    }
    await updateLatestRelease({ github, repo })
    expect(latestId).toBe(1)
    releases.push(release(3, 'v2.2.0'))
    await updateLatestRelease({ github, repo })
    expect(latestId).toBe(3)
  })
})

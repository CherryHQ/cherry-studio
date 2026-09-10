import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { reconcileLineBackport } from '../release/backport-release-line'

const REPO = { owner: 'owner', repo: 'project' }
const roots: string[] = []
interface PullRequest {
  number: number
  base: { ref: string }
  head: { ref: string; repo: { full_name: string } }
  labels: { name: string }[]
  state: string
  body: string
  html_url: string
  merged_at: string | null
  merge_commit_sha: string
  commits: number
}

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'backport-api-test-'))
  roots.push(cwd)
  fs.mkdirSync(path.join(cwd, 'hooks'))
  fs.writeFileSync(path.join(cwd, 'gitconfig'), '')
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: path.join(cwd, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1'
  }
  function git(args: string[], input?: string | Buffer, extraEnv = {}) {
    return execFileSync(
      'git',
      ['-c', `core.hooksPath=${path.join(cwd, 'hooks')}`, '-c', 'commit.gpgSign=false', ...args],
      { cwd, env: { ...env, ...extraEnv }, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Backport Test'])
  git(['config', 'user.email', 'backport@example.test'])
  git(['remote', 'add', 'origin', cwd])
  function commit(file: string, text: string, message: string) {
    fs.writeFileSync(path.join(cwd, file), text)
    git(['add', file])
    git(['commit', '-m', message])
    return git(['rev-parse', 'HEAD'])
  }
  commit('package.json', '{"version":"2.0.0"}\n', 'package version')
  const base = commit('app.txt', 'base\n', 'base')
  git(['branch', 'release/2.0.x', base])
  git(['branch', 'release/2.1.x', base])
  const sourceSha = commit('app.txt', 'fixed\n', 'fix startup')
  commit('unrelated.txt', 'not for release\n', 'unrelated main feature')
  const source: PullRequest = {
    number: 42,
    base: { ref: 'main' },
    head: { ref: 'fix/startup', repo: { full_name: 'fork/project' } },
    labels: [{ name: 'target/2.0.x' }, { name: 'target/2.1.x' }],
    state: 'closed',
    body: '```release-note\n[Startup] Restore startup.\n```',
    html_url: 'https://github.com/owner/project/pull/42',
    merged_at: '2026-09-10',
    merge_commit_sha: sourceSha,
    commits: 1
  }
  const prs = [source]
  const associatedPullRequests = new Map<string, number[]>()
  const config: { mode: string; current: string; previous: string | null; candidate: string | null } = {
    mode: 'minor-line',
    current: '2.1.x',
    previous: '2.0.x',
    candidate: null
  }
  let failCreate = false
  let verified = true
  const find = (number: number) => {
    const pr = prs.find((entry) => entry.number === number)
    if (!pr) throw new Error(`Missing PR ${number}`)
    return pr
  }
  const github = {
    paginate: async (method: (params: object) => Promise<{ data: unknown[] }>, params: object) =>
      (await method(params)).data,
    rest: {
      repos: {
        get: async () => ({ data: { default_branch: 'main' } }),
        getContent: async () => ({ data: { content: Buffer.from(JSON.stringify(config)).toString('base64') } }),
        listPullRequestsAssociatedWithCommit: async ({ commit_sha }: { commit_sha: string }) => ({
          data: (associatedPullRequests.get(commit_sha) || []).map((number) => ({ number }))
        }),
        getCommit: async ({ ref }: { ref: string }) => ({
          data: {
            sha: ref,
            parents: git(['show', '-s', '--format=%P', ref])
              .split(' ')
              .map((sha) => ({ sha })),
            commit: {
              message: git(['show', '-s', '--format=%B', ref]),
              tree: { sha: git(['rev-parse', `${ref}^{tree}`]) },
              verification: { verified }
            }
          }
        })
      },
      users: { getAuthenticated: async () => ({ data: { id: 1, login: 'publisher' } }) },
      git: {
        getRef: async ({ ref }: { ref: string }) => {
          try {
            return { data: { object: { sha: git(['rev-parse', '--verify', `refs/${ref}`]) } } }
          } catch {
            throw Object.assign(new Error('Not found'), { status: 404 })
          }
        },
        createRef: async ({ ref, sha }: { ref: string; sha: string }) => {
          git(['update-ref', ref, sha, '0000000000000000000000000000000000000000'])
        }
      },
      pulls: {
        get: async ({ pull_number }: { pull_number: number }) => ({ data: structuredClone(find(pull_number)) }),
        list: async ({ head }: { head: string }) => ({ data: prs.filter((pr) => head === `owner:${pr.head.ref}`) }),
        create: async ({ head, base: target, body }: { head: string; base: string; body: string }) => {
          if (failCreate) throw new Error('Temporary PR creation failure')
          const pr: PullRequest = {
            ...source,
            number: prs.length + 100,
            base: { ref: target },
            head: { ref: head, repo: { full_name: 'owner/project' } },
            state: 'open',
            merged_at: null,
            body,
            labels: []
          }
          prs.push(pr)
          return { data: pr }
        },
        update: async ({ pull_number, state }: { pull_number: number; state: string }) => {
          const pr = find(pull_number)
          pr.state = state
          return { data: pr }
        }
      },
      issues: {
        createLabel: async () => {},
        removeLabel: async ({ issue_number, name }: { issue_number: number; name: string }) => {
          find(issue_number).labels = find(issue_number).labels.filter((label) => label.name !== name)
        },
        addLabels: async ({ issue_number, labels }: { issue_number: number; labels: string[] }) => {
          find(issue_number).labels.push(...labels.map((name) => ({ name })))
        }
      }
    },
    graphql: async (
      _query: string,
      {
        input
      }: {
        input: {
          branch: { branchName: string }
          expectedHeadOid: string
          message: { headline: string; body: string }
          fileChanges: { additions: { path: string; contents: string }[]; deletions: { path: string }[] }
        }
      }
    ) => {
      const indexEnv = { GIT_INDEX_FILE: path.join(cwd, 'api-index') }
      git(['read-tree', input.expectedHeadOid], undefined, indexEnv)
      for (const file of input.fileChanges.additions) {
        const sha = git(['hash-object', '-w', '--stdin'], Buffer.from(file.contents, 'base64'))
        git(['update-index', '--add', '--cacheinfo', `100644,${sha},${file.path}`], undefined, indexEnv)
      }
      for (const file of input.fileChanges.deletions)
        git(['update-index', '--force-remove', file.path], undefined, indexEnv)
      const tree = git(['write-tree'], undefined, indexEnv)
      const sha = git(
        ['commit-tree', tree, '-p', input.expectedHeadOid],
        `${input.message.headline}\n\n${input.message.body}\n`
      )
      git(['update-ref', `refs/heads/${input.branch.branchName}`, sha, input.expectedHeadOid])
      return { createCommitOnBranch: { commit: { oid: sha } } }
    }
  }
  const run = (line = '2.0.x', retry = false) =>
    reconcileLineBackport({ github, repo: REPO, source: 42, line, retry, cwd })
  return {
    cwd,
    git,
    base,
    source,
    sourceSha,
    prs,
    associatedPullRequests,
    config,
    github,
    run,
    failCreate: (value: boolean) => {
      failCreate = value
    },
    verified: (value: boolean) => {
      verified = value
    }
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('line backport execution', () => {
  it('creates independent PRs for both target lines with only the source diff and a DCO trailer', async () => {
    const f = fixture()
    await f.run('2.0.x')
    await f.run('2.1.x')
    expect(f.prs.slice(1).map((pr) => pr.base.ref)).toEqual(['release/2.0.x', 'release/2.1.x'])
    for (const line of ['2.0.x', '2.1.x']) {
      const branch = `backport/${line}/pr-42`
      expect(f.git(['diff', '--name-only', `release/${line}`, branch])).toBe('app.txt')
      expect(f.git(['show', `${branch}:app.txt`])).toBe('fixed')
      expect(f.git(['log', '-1', '--format=%B', branch])).toContain(
        'Signed-off-by: publisher <1+publisher@users.noreply.github.com>'
      )
    }
    expect(f.prs[1].body).toContain('<!-- release-backport-source-pr: 42 -->')
    expect(f.prs[1].body).toContain('[Startup] Restore startup.')
  })

  it('does not overwrite an open backport with human adaptations on a repeated event', async () => {
    const f = fixture()
    await f.run()
    const branch = 'backport/2.0.x/pr-42'
    const original = f.git(['rev-parse', branch])
    const adapted = f.git(['commit-tree', `${original}^{tree}`, '-p', original], 'Manual adaptation\n')
    f.git(['update-ref', `refs/heads/${branch}`, adapted, original])
    await f.run()
    expect(f.prs).toHaveLength(2)
    expect(f.git(['rev-parse', branch])).toBe(adapted)
  })

  it('includes every rebased source commit without including later main changes', async () => {
    const f = fixture()
    f.git(['checkout', '-b', 'rebased-source', f.sourceSha])
    fs.writeFileSync(path.join(f.cwd, 'second.txt'), 'second source change\n')
    f.git(['add', 'second.txt'])
    f.git(['commit', '-m', 'second source commit'])
    f.source.merge_commit_sha = f.git(['rev-parse', 'HEAD'])
    f.source.commits = 2
    f.git(['checkout', 'main'])
    f.git(['merge', '--no-edit', 'rebased-source'])
    f.associatedPullRequests.set(f.sourceSha, [42])
    await f.run()
    expect(f.git(['diff', '--name-only', 'release/2.0.x', 'backport/2.0.x/pr-42'])).toBe('app.txt\nsecond.txt')
    expect(f.git(['show', 'backport/2.0.x/pr-42:app.txt'])).toBe('fixed')
    expect(f.git(['show', 'backport/2.0.x/pr-42:second.txt'])).toBe('second source change')
  })

  it('does not create work for unmerged or withdrawn requests', async () => {
    const f = fixture()
    f.source.merged_at = null
    expect((await f.run()).status).toBe('unmerged')
    f.source.merged_at = '2026-09-10'
    f.source.labels = []
    expect((await f.run()).status).toBe('withdrawn')
    expect(f.prs).toHaveLength(1)
  })

  it('marks conflicts failed without altering the release branch and lets the other line proceed', async () => {
    const f = fixture()
    const conflicting = f.git(['commit-tree', `${f.sourceSha}^{tree}`, '-p', f.base], 'conflicting release state\n')
    f.git(['update-ref', 'refs/heads/release/2.0.x', conflicting])
    // A different replacement of the same original line creates a real three-way conflict.
    f.git(['checkout', 'release/2.0.x'])
    fs.writeFileSync(path.join(f.cwd, 'app.txt'), 'other release fix\n')
    f.git(['add', 'app.txt'])
    f.git(['commit', '-m', 'release-specific fix'])
    const head = f.git(['rev-parse', 'HEAD'])
    f.git(['checkout', 'main'])
    await expect(f.run()).rejects.toThrow('conflicts')
    expect(f.git(['rev-parse', 'release/2.0.x'])).toBe(head)
    expect(f.source.labels.map((label) => label.name)).toContain('backport-failed/2.0.x')
    expect((await f.run('2.1.x')).status).toBe('open')
  })

  it('recovers after a signed commit was created but the PR API failed, without another commit', async () => {
    const f = fixture()
    f.failCreate(true)
    await expect(f.run()).rejects.toThrow('Temporary PR creation failure')
    const head = f.git(['rev-parse', 'backport/2.0.x/pr-42'])
    f.failCreate(false)
    await f.run()
    expect(f.git(['rev-parse', 'backport/2.0.x/pr-42'])).toBe(head)
    expect(f.prs).toHaveLength(2)
    expect(f.source.labels.map((label) => label.name)).not.toContain('backport-failed/2.0.x')
  })

  it('tracks closing, explicit reopening and merging without using labels as proof', async () => {
    const f = fixture()
    await f.run()
    const pr = f.prs[1]
    pr.state = 'closed'
    expect((await f.run()).status).toBe('failed')
    expect((await f.run('2.0.x', true)).status).toBe('open')
    pr.state = 'closed'
    pr.merged_at = '2026-09-10'
    f.source.labels = []
    expect((await f.run()).status).toBe('merged')
    expect(f.source.labels.map((label) => label.name)).toEqual(['backported/2.0.x'])
  })

  it('detects a source patch already on the release branch without opening an empty PR', async () => {
    const f = fixture()
    f.git(['update-ref', 'refs/heads/release/2.0.x', f.sourceSha])
    expect((await f.run()).status).toBe('already-present')
    expect(f.prs).toHaveLength(1)
  })

  it('rejects unverified commits and preserves the branch for diagnosis', async () => {
    const f = fixture()
    f.verified(false)
    await expect(f.run()).rejects.toThrow('not GitHub Verified')
    expect(f.prs).toHaveLength(1)
    expect(f.git(['rev-parse', 'backport/2.0.x/pr-42'])).not.toBe(f.base)
  })

  it('rejects new work on an EOL line and does not fall back to another target', async () => {
    const f = fixture()
    f.config.previous = null
    await expect(f.run()).rejects.toThrow('not enabled')
    expect(f.prs).toHaveLength(1)
  })

  it('stops before publishing if a target is withdrawn during preparation', async () => {
    const f = fixture()
    const get = f.github.rest.pulls.get
    let reads = 0
    f.github.rest.pulls.get = async (params) => {
      if (++reads === 2) f.source.labels = []
      return get(params)
    }
    await expect(f.run()).rejects.toThrow('request changed')
    expect(f.prs).toHaveLength(1)
    expect(f.git(['branch', '--list', 'backport/*'])).toBe('')
    expect(f.source.labels).toEqual([])
  })

  it('reloads support configuration before publishing a prepared patch', async () => {
    const f = fixture()
    const get = f.github.rest.repos.getContent
    let reads = 0
    f.github.rest.repos.getContent = async () => {
      if (++reads === 2) f.config.previous = null
      return get()
    }
    await expect(f.run()).rejects.toThrow('not enabled')
    expect(f.prs).toHaveLength(1)
    expect(f.git(['branch', '--list', 'backport/*'])).toBe('')
  })

  it('does not treat a signed orphan with extra changes as the intended source patch', async () => {
    const f = fixture()
    f.failCreate(true)
    await expect(f.run()).rejects.toThrow('Temporary PR creation failure')
    const branch = 'backport/2.0.x/pr-42'
    const original = f.git(['rev-parse', branch])
    const message = f.git(['log', '-1', '--format=%B', original])
    const altered = f.git(['commit-tree', 'main^{tree}', '-p', f.base], message)
    f.git(['update-ref', `refs/heads/${branch}`, altered, original])
    f.failCreate(false)
    await expect(f.run()).rejects.toThrow('differs from the source patch')
    expect(f.git(['rev-parse', branch])).toBe(altered)
    expect(f.prs).toHaveLength(1)
  })

  it('does not copy the main development version into a maintenance line', async () => {
    const f = fixture()
    fs.writeFileSync(path.join(f.cwd, 'package.json'), '{"version":"2.2.0"}\n')
    f.git(['add', 'package.json'])
    f.git(['commit', '-m', 'new development version'])
    f.source.merge_commit_sha = f.git(['rev-parse', 'HEAD'])
    await expect(f.run()).rejects.toThrow('changes the release version')
    expect(f.git(['show', 'release/2.0.x:package.json'])).toBe('{"version":"2.0.0"}')
    expect(f.prs).toHaveLength(1)
  })
})

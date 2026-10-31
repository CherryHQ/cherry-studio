import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { contentTree, git, repositories, roots, scratch } from './content.mjs'
import { stateBranch, statePath, syncBranch } from './github.mjs'
import { reconcile } from './sync.mjs'

type Side = 'desktop' | 'website'
type Pull = {
  number: number
  state: string
  merged_at: string | null
  body: string
  head: { sha: string }
  html_url: string
}
const cleanups: Array<() => void> = []
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  while (cleanups.length) cleanups.pop()!()
})

function githubFixture() {
  const dirs = { desktop: scratch(), website: scratch() }
  const temp = mkdtempSync(path.join(tmpdir(), 'cherry-docs-api-'))
  cleanups.push(() => {
    dirs.desktop.close()
    dirs.website.close()
    rmSync(temp, { recursive: true, force: true })
  })
  const prs: Record<Side, Pull[]> = { desktop: [], website: [] }
  const verified = new Set<string>()
  const statuses = new Map<string, string>()
  let sequence = 0
  let rejectPr = false
  let rejectCheckpoint = false
  let raceBranch: Side | undefined
  const revision = (side: Side, branch = 'main') => {
    const result = spawnSync('git', ['-C', dirs[side].repo, 'rev-parse', '--verify', `refs/heads/${branch}`], {
      encoding: 'utf8'
    })
    return result.status === 0 ? result.stdout.trim() : null
  }
  const commit = (side: Side, parent: string | null, files: Record<string, string | null>, branch: string) => {
    const repo = dirs[side].repo
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temp, `index-${sequence++}`) }
    const run = (args: string[], input?: string) =>
      execFileSync('git', ['-C', repo, ...args], { env, input, encoding: 'utf8' }).trim()
    run(['read-tree', ...(parent ? [parent] : ['--empty'])])
    for (const [name, contents] of Object.entries(files)) {
      if (contents === null) run(['update-index', '--force-remove', '--', name])
      else {
        const blob = run(['hash-object', '-w', '--stdin'], Buffer.from(contents, 'base64').toString())
        run(['update-index', '--add', '--cacheinfo', '100644', blob, name])
      }
    }
    const tree = run(['write-tree'])
    const oid = run([
      '-c',
      'user.name=Docs Test',
      '-c',
      'user.email=docs@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit-tree',
      tree,
      ...(parent ? ['-p', parent] : []),
      '-m',
      'fixture'
    ])
    run(['update-ref', `refs/heads/${branch}`, oid, parent ?? '0'.repeat(40)])
    return oid
  }
  for (const side of Object.keys(dirs) as Side[]) {
    git(dirs[side].repo, ['config', 'receive.denyCurrentBranch', 'ignore'])
    git(dirs[side].repo, ['config', 'uploadpack.allowReachableSHA1InWant', 'true'])
    const files = {
      'content/SUMMARY.md': '# Contents\n',
      'content/page.md': 'one\n\n1\n2\n3\n4\n5\n6\n7\n8\n\nten\n',
      'locales.json': '[]\n',
      'page-aliases.json': '{}\n'
    }
    commit(
      side,
      null,
      Object.fromEntries(
        Object.entries(files).map(([name, text]) => [`${roots[side]}/${name}`, Buffer.from(text).toString('base64')])
      ),
      'main'
    )
  }
  vi.stubEnv('GIT_CONFIG_COUNT', '2')
  for (const [index, side] of (['desktop', 'website'] as Side[]).entries()) {
    vi.stubEnv(`GIT_CONFIG_KEY_${index}`, `url.${dirs[side].repo}.insteadOf`)
    vi.stubEnv(`GIT_CONFIG_VALUE_${index}`, `https://github.com/${repositories[side]}.git`)
  }
  vi.stubEnv('GH_TOKEN', 'test-installation-token')
  vi.stubEnv('DOCS_SYNC_BOT_LOGIN', 'docs-sync[bot]')

  vi.stubGlobal('fetch', async (url: string, options: { method?: string; body?: string }) => {
    const parsed = new URL(url)
    const endpoint = decodeURIComponent(parsed.pathname.slice(1))
    const method = options.method ?? 'GET'
    const data = options.body ? JSON.parse(options.body) : undefined
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    if (endpoint === 'users/docs-sync[bot]') return respond({ id: 123 })
    if (endpoint === 'graphql') {
      const input = data.variables.input
      const side: Side = input.branch.repositoryNameWithOwner === repositories.desktop ? 'desktop' : 'website'
      const branch = input.branch.refName
      if (rejectCheckpoint && branch === stateBranch) {
        rejectCheckpoint = false
        return respond({}, 503)
      }
      if (revision(side, branch) !== input.expectedHeadOid) return respond({ errors: [{ message: 'stale head' }] })
      const files: Record<string, string | null> = {}
      for (const file of input.fileChanges.additions) files[file.path] = file.contents
      for (const file of input.fileChanges.deletions) files[file.path] = null
      const oid = commit(side, input.expectedHeadOid, files, branch)
      verified.add(oid)
      if (raceBranch === side && branch.startsWith('docs-sync/build-')) {
        raceBranch = undefined
        commit(
          side,
          revision(side, syncBranch),
          { [`${roots[side]}/content/manual.md`]: Buffer.from('concurrent human edit').toString('base64') },
          syncBranch
        )
      }
      return respond({ data: { createCommitOnBranch: { commit: { oid } } } })
    }
    const match = /^repos\/(CherryHQ\/cherry-studio(?:-website)?)\/(.*)$/.exec(endpoint)
    if (!match) throw new Error(`Unexpected API endpoint: ${endpoint}`)
    const side: Side = match[1] === repositories.desktop ? 'desktop' : 'website'
    const route = match[2]
    if (route.startsWith('git/ref/heads/')) {
      const oid = revision(side, route.slice('git/ref/heads/'.length))
      return oid ? respond({ object: { sha: oid } }) : respond({}, 404)
    }
    if (route === 'git/refs') {
      git(dirs[side].repo, ['update-ref', data.ref, data.sha, '0'.repeat(40)])
      return respond({ object: { sha: data.sha } }, 201)
    }
    if (route.startsWith('git/refs/heads/') && method === 'DELETE') {
      git(dirs[side].repo, ['update-ref', '-d', route.replace('git/', '')])
      return new Response(null, { status: 204 })
    }
    if (route.startsWith('commits/')) {
      const oid = route.slice('commits/'.length)
      return respond({
        author: {
          type: verified.has(oid) ? 'Bot' : 'User',
          login: verified.has(oid) ? 'docs-sync[bot]' : 'maintainer'
        },
        commit: { verification: { verified: verified.has(oid) }, message: `Docs-Sync-Result: fixture` }
      })
    }
    if (route.startsWith('statuses/')) {
      statuses.set(route, data.state)
      return respond({}, 201)
    }
    if (route === 'pulls' && method === 'GET') {
      const latest = prs[side].at(-1)
      if (latest?.state === 'open') latest.head.sha = revision(side, syncBranch)!
      return respond(latest ? [latest] : [])
    }
    if (route === 'pulls' && method === 'POST') {
      if (rejectPr) {
        rejectPr = false
        return respond({}, 503)
      }
      const pr = {
        number: prs[side].length + 1,
        state: 'open',
        merged_at: null,
        body: data.body,
        head: { sha: revision(side, syncBranch)! },
        html_url: `https://github.com/${repositories[side]}/pull/1`
      }
      prs[side].push(pr)
      return respond(pr, 201)
    }
    if (route.startsWith('pulls/') && method === 'PATCH') {
      const pr = prs[side].find((pull) => pull.number === Number(route.split('/')[1]))!
      Object.assign(pr, data)
      return respond(pr)
    }
    throw new Error(`Unexpected API request: ${method} ${route}`)
  })
  const edit = (side: Side, name: string, text: string, branch = 'main') =>
    commit(side, revision(side, branch), { [`${roots[side]}/${name}`]: Buffer.from(text).toString('base64') }, branch)
  const merge = (side: Side) => {
    const pr = prs[side].at(-1)!
    git(dirs[side].repo, ['update-ref', 'refs/heads/main', pr.head.sha])
    pr.state = 'closed'
    pr.merged_at = '2026-10-31T00:00:00Z'
  }
  return {
    dirs,
    prs,
    statuses,
    revision,
    edit,
    merge,
    failPr: () => {
      rejectPr = true
    },
    raceNextPublish: (side: Side) => {
      raceBranch = side
    },
    failCheckpoint: () => {
      rejectCheckpoint = true
    }
  }
}

describe('coordinator against Git repositories and the GitHub API contract', () => {
  it('dry-runs without repository writes, then imports through a PR and checkpoints only after merge', async () => {
    const f = githubFixture()
    const original = { desktop: f.revision('desktop'), website: f.revision('website') }
    await reconcile({ bootstrap: true })
    expect(f.revision('desktop', stateBranch)).toBeNull()
    expect(f.prs.desktop).toEqual([])
    await reconcile({ bootstrap: true, apply: true })
    const checkpoint = f.revision('desktop', stateBranch)
    f.edit('desktop', 'content/new.md', 'from desktop\n')
    const plan = await reconcile()
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ side: 'website', action: 'create', paths: ['content/new.md'] })
    )
    expect(f.prs.website).toEqual([])
    await reconcile({ apply: true })
    expect(f.revision('website')).toBe(original.website)
    expect(f.revision('desktop', stateBranch)).toBe(checkpoint)
    expect(git(f.dirs.website.repo, ['show', `${f.prs.website[0].head.sha}:docs-site/content/new.md`]).toString()).toBe(
      'from desktop\n'
    )
    const firstHead = f.prs.website[0].head.sha
    await reconcile({ apply: true })
    expect(f.prs.website).toHaveLength(1)
    expect(f.revision('website', syncBranch)).toBe(firstHead)
    f.merge('website')
    await reconcile({ apply: true })
    expect(f.revision('desktop', stateBranch)).not.toBe(checkpoint)
    expect(f.prs.desktop).toHaveLength(0)
    const state = JSON.parse(
      git(f.dirs.desktop.repo, ['show', `${f.revision('desktop', stateBranch)}:${statePath}`]).toString()
    )
    expect(state.heads.website).toBe(f.revision('website'))
    expect(state.tree).toBe(contentTree(f.dirs.desktop.repo, f.revision('desktop'), 'desktop'))
  })

  it('retains both concurrent additions and waits for both PRs before advancing', async () => {
    const f = githubFixture()
    await reconcile({ bootstrap: true, apply: true })
    const checkpoint = f.revision('desktop', stateBranch)
    f.edit('desktop', 'content/desktop.md', 'desktop')
    f.edit('website', 'content/website.md', 'website')
    await reconcile({ apply: true })
    expect(f.prs.desktop).toHaveLength(1)
    expect(f.prs.website).toHaveLength(1)
    f.merge('desktop')
    await reconcile({ apply: true })
    expect(f.revision('desktop', stateBranch)).toBe(checkpoint)
    f.merge('website')
    await reconcile({ apply: true })
    expect(f.revision('desktop', stateBranch)).not.toBe(checkpoint)
    for (const side of ['desktop', 'website'] as Side[]) {
      expect(git(f.dirs[side].repo, ['show', `main:${roots[side]}/content/desktop.md`]).toString()).toBe('desktop')
      expect(git(f.dirs[side].repo, ['show', `main:${roots[side]}/content/website.md`]).toString()).toBe('website')
    }
  })

  it('preserves a manually edited bot branch and pauses a closed PR until resume', async () => {
    const f = githubFixture()
    await reconcile({ bootstrap: true, apply: true })
    f.edit('desktop', 'content/new.md', 'new')
    await reconcile({ apply: true })
    const manual = f.edit('website', 'content/new.md', 'manual resolution', syncBranch)
    f.prs.website[0].head.sha = manual
    const report = await reconcile({ apply: true })
    expect(report.actions).toContainEqual(expect.objectContaining({ action: 'manual' }))
    expect(f.revision('website', syncBranch)).toBe(manual)
    f.prs.website[0].state = 'closed'
    expect((await reconcile({ apply: true })).actions).toContainEqual(expect.objectContaining({ action: 'paused' }))
  })

  it('retries a failed PR creation without losing its signed branch or acknowledging content', async () => {
    const f = githubFixture()
    await reconcile({ bootstrap: true, apply: true })
    const checkpoint = f.revision('desktop', stateBranch)
    f.edit('website', 'content/reference.md', 'new reference snapshot')
    f.failPr()
    await expect(reconcile({ apply: true })).rejects.toThrow('HTTP 503')
    expect(f.revision('desktop', stateBranch)).toBe(checkpoint)
    expect(f.prs.desktop).toHaveLength(0)
    await reconcile({ apply: true })
    expect(f.prs.desktop).toHaveLength(1)
    expect(
      git(f.dirs.desktop.repo, ['show', `${f.prs.desktop[0].head.sha}:website-docs/content/reference.md`]).toString()
    ).toBe('new reference snapshot')
  })

  it('can resume an interrupted first checkpoint without guessing a new baseline', async () => {
    const f = githubFixture()
    f.failCheckpoint()
    await expect(reconcile({ bootstrap: true, apply: true })).rejects.toThrow('HTTP 503')
    await expect(reconcile({ apply: true })).rejects.toThrow('Incomplete baseline initialization')
    await reconcile({ bootstrap: true, apply: true })
    expect(
      JSON.parse(git(f.dirs.desktop.repo, ['show', `${f.revision('desktop', stateBranch)}:${statePath}`]).toString())
        .version
    ).toBe(1)
  })

  it('refreshes new source edits on the same PR and resumes a deliberately closed bot PR', async () => {
    const f = githubFixture()
    await reconcile({ bootstrap: true, apply: true })
    f.edit('website', 'content/first.md', 'first')
    await reconcile({ apply: true })
    const first = f.prs.desktop[0].head.sha
    f.edit('website', 'content/second.md', 'second')
    await reconcile({ apply: true })
    expect(f.prs.desktop).toHaveLength(1)
    const updated = f.revision('desktop', syncBranch)!
    expect(updated).not.toBe(first)
    expect(git(f.dirs.desktop.repo, ['show', `${updated}:website-docs/content/first.md`]).toString()).toBe('first')
    expect(git(f.dirs.desktop.repo, ['show', `${updated}:website-docs/content/second.md`]).toString()).toBe('second')
    f.prs.desktop[0].state = 'closed'
    expect((await reconcile({ apply: true })).actions).toContainEqual(expect.objectContaining({ action: 'paused' }))
    await reconcile({ apply: true, resume: 'desktop' })
    expect(f.prs.desktop).toHaveLength(2)
    expect(f.prs.desktop[1].state).toBe('open')
  })

  it('refuses to overwrite a human branch update racing a refresh', async () => {
    const f = githubFixture()
    await reconcile({ bootstrap: true, apply: true })
    const checkpoint = f.revision('desktop', stateBranch)
    f.edit('website', 'content/first.md', 'first')
    await reconcile({ apply: true })
    f.edit('website', 'content/second.md', 'second')
    f.raceNextPublish('desktop')
    await expect(reconcile({ apply: true })).rejects.toThrow('stale info')
    const preserved = f.revision('desktop', syncBranch)!
    expect(git(f.dirs.desktop.repo, ['show', `${preserved}:website-docs/content/manual.md`]).toString()).toBe(
      'concurrent human edit'
    )
    expect(f.revision('desktop', stateBranch)).toBe(checkpoint)
  })

  it('fails conflicting batches without publishing independent paths or advancing state', async () => {
    const f = githubFixture()
    await reconcile({ bootstrap: true, apply: true })
    const checkpoint = f.revision('desktop', stateBranch)
    f.edit('desktop', 'content/page.md', 'desktop conflict\n')
    f.edit('desktop', 'content/independent.md', 'independent\n')
    f.edit('website', 'content/page.md', 'website conflict\n')
    await expect(reconcile({ apply: true })).rejects.toThrow('Documentation conflicts: content/page.md')
    expect(f.prs.desktop).toHaveLength(0)
    expect(f.prs.website).toHaveLength(0)
    expect(f.revision('desktop', stateBranch)).toBe(checkpoint)
    expect(git(f.dirs.website.repo, ['show', 'main:docs-site/content/page.md']).toString()).toBe('website conflict\n')
  })
})

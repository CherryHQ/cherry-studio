import { describe, expect, it } from 'vitest'

import { openLinePreparation, planLinePreparation } from '../release/prepare-release-line'
import { resolveLineBuild } from '../release/release-line-build'

const repo = { owner: 'owner', repo: 'project' }

function fixture() {
  const config = { mode: 'minor-line', current: '2.1.x', previous: '2.0.x' as string | null, candidate: '2.2.x' }
  const refs = new Map([
    ['heads/release/2.0.x', 'old-head'],
    ['heads/release/2.1.x', 'current-head'],
    ['tags/v2.0.13', 'old-tag'],
    ['tags/v2.1.4', 'current-tag']
  ])
  const versions = new Map([
    ['old-head', '2.0.13'],
    ['current-head', '2.1.4'],
    ['main-head', '2.1.4']
  ])
  const releases: { tag_name: string; draft: boolean; published_at: string | null }[] = [
    { tag_name: 'v2.0.13', draft: false, published_at: '2026-09-10' },
    { tag_name: 'v2.1.4', draft: false, published_at: '2026-09-09' }
  ]
  const prs: { head: string; base: string; body: string; title: string }[] = []
  const commits = new Map<string, { message: string; verification: { verified: boolean } }>()
  const additions: { path: string; contents: string }[] = []
  const signing = { verified: true }
  const github = {
    paginate: async <T>(method: (params: never) => Promise<{ data: T[] }>, params: never) =>
      (await method(params)).data,
    rest: {
      repos: {
        get: async () => ({ data: { default_branch: 'main' } }),
        getContent: async ({ path, ref }: { path: string; ref: string }) => ({
          data: {
            content: Buffer.from(
              JSON.stringify(path === 'package.json' ? { version: versions.get(ref) } : config)
            ).toString('base64')
          }
        }),
        listReleases: async () => ({ data: releases }),
        getCommit: async ({ ref }: { ref: string }) => ({ data: { commit: commits.get(ref) } })
      },
      git: {
        getRef: async ({ ref }: { ref: string }) => {
          if (!refs.has(ref)) throw Object.assign(new Error('Not found'), { status: 404 })
          return { data: { object: { sha: refs.get(ref) } } }
        },
        createRef: async ({ ref, sha }: { ref: string; sha: string }) => {
          const key = ref.slice(5)
          if (refs.has(key)) throw new Error('Ref already exists')
          refs.set(key, sha)
        }
      },
      users: { getAuthenticated: async () => ({ data: { login: 'publisher', id: 1 } }) },
      pulls: {
        create: async (pr: (typeof prs)[number]) => {
          prs.push(pr)
          return { data: pr }
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
          fileChanges: { additions: { path: string; contents: string }[] }
        }
      }
    ) => {
      const ref = `heads/${input.branch.branchName}`
      if (refs.get(ref) !== input.expectedHeadOid) throw new Error('Expected head changed')
      const sha = `prepared-${commits.size}`
      commits.set(sha, {
        message: `${input.message.headline}\n\n${input.message.body}`,
        verification: { verified: signing.verified }
      })
      additions.push(...input.fileChanges.additions)
      refs.set(ref, sha)
      return { createCommitOnBranch: { commit: { oid: sha } } }
    }
  }
  const plan = (line = '2.0.x', requestedVersion = 'patch') =>
    planLinePreparation({ github, repo, line, requestedVersion, mainSha: 'main-head' })
  const build = (branch = 'release/2.0.x', sha = refs.get(`heads/${branch}`) || 'missing') =>
    resolveLineBuild({ github, repo, branch, sha })
  return { github, config, refs, versions, releases, prs, commits, additions, signing, plan, build }
}

describe('minor-line preparation', () => {
  it('selects each line source and baseline independently of publication order', async () => {
    const f = fixture()
    expect(await f.plan()).toMatchObject({ sourceSha: 'old-head', version: '2.0.14', baselineTag: 'v2.0.13' })
    expect(await f.plan('2.1.x')).toMatchObject({ sourceSha: 'current-head', version: '2.1.5', baselineTag: 'v2.1.4' })
  })

  it.each(['2.1.5', '2.0.13', '2.0.12', '2.0.14+build', 'v2.0.14', '02.0.14', 'minor', '2.0.14-rc.1'])(
    'rejects invalid maintenance version %s',
    async (version) => {
      await expect(fixture().plan('2.0.x', version)).rejects.toThrow()
    }
  )

  it('cuts only a configured candidate from the frozen main source', async () => {
    const f = fixture()
    const plan = await f.plan('2.2.x', '2.2.0-rc.1')
    expect(plan).toMatchObject({ cut: true, sourceSha: 'main-head', baselineTag: 'v2.1.4' })
    await openLinePreparation({ github: f.github, repo, plan, additions: [] })
    expect(f.refs.get('heads/release/2.2.x')).toBe('main-head')
    expect(f.prs[0].base).toBe('release/2.2.x')
    f.refs.delete('heads/release/2.0.x')
    await expect(f.plan()).rejects.toThrow('Missing maintained')
  })

  it('requires an explicit version for a new candidate line', async () => {
    await expect(fixture().plan('2.2.x')).rejects.toThrow('Invalid release version')
  })

  it('does not prepare below the highest published version on the line', async () => {
    const f = fixture()
    f.releases.push({ tag_name: 'v2.0.15', draft: false, published_at: '2026-09-01' })
    await expect(f.plan()).rejects.toThrow('published baseline')
  })

  it.each(['tag', 'draft'])('rejects target version reuse through a %s', async (kind) => {
    const f = fixture()
    if (kind === 'tag') f.refs.set('tags/v2.0.14', 'orphan')
    else f.releases.push({ tag_name: 'v2.0.14', draft: true, published_at: null })
    await expect(f.plan()).rejects.toThrow('already exists')
  })

  it('allows unrelated drafts and concurrent preparations on other lines', async () => {
    const f = fixture()
    f.releases.push({ tag_name: 'v2.1.5', draft: true, published_at: null })
    f.refs.set('heads/release-prep/2.1.x/v2.1.5', 'other-preparation')
    const plan = await f.plan()
    await openLinePreparation({ github: f.github, repo, plan, additions: [] })
    expect(f.prs[0].base).toBe('release/2.0.x')
  })

  it('opens a signed metadata PR from the frozen source even when its target advances', async () => {
    const f = fixture()
    const plan = await f.plan()
    f.refs.set('heads/release/2.0.x', 'new-head')
    const additions = [{ path: 'package.json', contents: Buffer.from('{"version":"2.0.14"}').toString('base64') }]
    await openLinePreparation({ github: f.github, repo, plan, additions })
    expect(f.refs.get('heads/release/2.0.x')).toBe('new-head')
    expect(f.prs[0]).toMatchObject({ base: 'release/2.0.x', head: 'release-prep/2.0.x/v2.0.14' })
    expect(f.prs[0].body).toContain('from source old-head, with notes since v2.0.13')
    expect(f.additions).toEqual(additions)
    expect(f.commits.get('prepared-0')?.message).toContain(
      'Signed-off-by: publisher <1+publisher@users.noreply.github.com>'
    )
  })

  it('preserves an existing preparation branch on an API collision', async () => {
    const f = fixture()
    const plan = await f.plan()
    f.refs.set('heads/release-prep/2.0.x/v2.0.14', 'existing-work')
    await expect(openLinePreparation({ github: f.github, repo, plan, additions: [] })).rejects.toThrow(
      'Ref already exists'
    )
    expect(f.refs.get('heads/release-prep/2.0.x/v2.0.14')).toBe('existing-work')
    expect(f.prs).toEqual([])
  })

  it('does not open a PR for an unverified commit', async () => {
    const f = fixture()
    const plan = await f.plan()
    f.signing.verified = false
    await expect(openLinePreparation({ github: f.github, repo, plan, additions: [] })).rejects.toThrow(
      'GitHub Verified'
    )
    expect(f.prs).toEqual([])
  })

  it('preserves the exact-version route until activation', async () => {
    const f = fixture()
    f.config.mode = 'exact-version'
    expect(await f.plan('')).toEqual({ mode: 'exact-version', sourceSha: 'main-head' })
    await expect(f.plan()).rejects.toThrow('not enabled')
  })
})

describe('release-line build routing', () => {
  it('builds an unpublished version using its own line baseline, including after another fix', async () => {
    const f = fixture()
    f.versions.set('old-head', '2.0.14')
    expect(await f.build()).toEqual({ mode: 'minor-line', tag: 'v2.0.14', baselineTag: 'v2.0.13' })
    f.refs.set('heads/release/2.0.x', 'fixed-head')
    f.versions.set('fixed-head', '2.0.14')
    f.releases.push({ tag_name: 'v2.0.14', draft: true, published_at: null })
    f.refs.set('tags/v2.0.14', 'old-head')
    expect(await f.build()).toEqual({ mode: 'minor-line', tag: 'v2.0.14', baselineTag: 'v2.0.13' })
  })

  it('does not build a published version or a candidate branch cut still carrying the main version', async () => {
    const f = fixture()
    expect(await f.build()).toBeNull()
    expect(await f.build('release/2.2.x', 'main-head')).toBeNull()
  })

  it('uses the current line as baseline for the first candidate, then its own earlier prerelease', async () => {
    const f = fixture()
    f.versions.set('candidate-head', '2.2.0-rc.1')
    expect(await f.build('release/2.2.x', 'candidate-head')).toMatchObject({ baselineTag: 'v2.1.4' })
    f.releases.push({ tag_name: 'v2.2.0-rc.1', draft: false, published_at: '2026-09-10' })
    f.versions.set('candidate-head', '2.2.0-rc.2')
    expect(await f.build('release/2.2.x', 'candidate-head')).toMatchObject({ baselineTag: 'v2.2.0-rc.1' })
  })

  it('rejects retired lines and missing published baselines', async () => {
    const f = fixture()
    f.versions.set('old-head', '2.0.14')
    f.releases.length = 0
    await expect(f.build()).rejects.toThrow('No published baseline')
    f.config.previous = null
    await expect(f.build()).rejects.toThrow('not enabled')
  })

  it('keeps exact-version builds isolated while that route remains active', async () => {
    const f = fixture()
    f.config.mode = 'exact-version'
    expect(await f.build('release/v2.0.13', 'old-head')).toEqual({ mode: 'exact-version', tag: 'v2.0.13' })
    expect(await f.build()).toBeNull()
    await expect(f.build('release/v2.1.4', 'old-head')).rejects.toThrow('disagree')
  })
})

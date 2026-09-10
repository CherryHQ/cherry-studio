import { describe, expect, it } from 'vitest'

import {
  backportIdentity,
  planLineBackports,
  requireSupportedLine,
  validateReleaseLines
} from '../release/release-lines'

const CONFIG = { mode: 'minor-line', current: '2.1.x', previous: '2.0.x', candidate: '2.2.x' }

describe('release line configuration', () => {
  it('keeps the existing release route while minor-line publishing is unfinished', () => {
    const config = { mode: 'exact-version', current: null, previous: null, candidate: null }
    expect(validateReleaseLines(config).mode).toBe('exact-version')
    expect(() => requireSupportedLine(config, '2.1.x')).toThrow('not enabled')
  })

  it.each(['2.0.x', '2.1.x', '2.2.x'])('allows an explicitly supported or candidate line: %s', (line) => {
    expect(() => requireSupportedLine(CONFIG, line)).not.toThrow()
  })

  it.each(['1.9.x', '2.3.x', 'current', 'v2.1.0', '02.1.x', '../../main'])(
    'rejects unknown or malformed targets: %s',
    (line) => {
      expect(() => requireSupportedLine(CONFIG, line)).toThrow()
    }
  )

  it.each([
    { ...CONFIG, mode: 'automatic' },
    { ...CONFIG, current: null },
    { ...CONFIG, previous: '2.1.x' },
    { ...CONFIG, previous: '2.3.x' },
    { ...CONFIG, candidate: '1.9.x' }
  ])('rejects an inconsistent support window: %j', (config) => {
    expect(() => validateReleaseLines(config)).toThrow()
  })

  it('supports major-version transitions without inventing a negative minor', () => {
    expect(() =>
      validateReleaseLines({ ...CONFIG, current: '2.0.x', previous: '1.9.x', candidate: null })
    ).not.toThrow()
  })
})

describe('backport routing', () => {
  function fixture() {
    const pr = {
      number: 123,
      merged_at: '2026-09-10',
      base: { ref: 'main' },
      head: { ref: 'fix/startup', repo: { full_name: 'fork/project' } },
      labels: [{ name: 'target/2.0.x' }, { name: 'target/2.1.x' }],
      body: ''
    }
    let config = CONFIG
    const labels = new Set<string>()
    const github = {
      rest: {
        repos: {
          get: async () => ({ data: { default_branch: 'main' } }),
          getContent: async () => ({ data: { content: Buffer.from(JSON.stringify(config)).toString('base64') } })
        },
        pulls: { get: async () => ({ data: pr }) },
        issues: {
          createLabel: async ({ name }: { name: string }) => {
            if (labels.has(name)) {
              throw Object.assign(new Error('Already exists'), {
                status: 422,
                response: { data: { errors: [{ code: 'already_exists' }] } }
              })
            }
            labels.add(name)
          }
        }
      }
    }
    const context = {
      repo: { owner: 'owner', repo: 'project' },
      eventName: 'pull_request_target',
      payload: {
        action: 'closed',
        pull_request: { number: 123 },
        label: { name: 'target/2.0.x' }
      }
    }
    return {
      pr,
      labels,
      github,
      context,
      setConfig: (value: typeof CONFIG) => {
        config = value
      }
    }
  }

  it('plans a separate backport for each requested line without requiring hotfix or a draft release', async () => {
    const f = fixture()
    expect((await planLineBackports(f)).targets).toEqual([
      { source: 123, line: '2.0.x', retry: false },
      { source: 123, line: '2.1.x', retry: false }
    ])
  })

  it('does not run both release routes when old workflows are retried after a mode change', async () => {
    const f = fixture()
    f.setConfig({ ...CONFIG, mode: 'exact-version' })
    expect(await planLineBackports(f)).toEqual({ mode: 'exact-version', targets: [] })
    f.context.eventName = 'workflow_dispatch'
    await expect(planLineBackports({ ...f, inputs: { source_pr: '123', line: '2.0.x' } })).rejects.toThrow(
      'not enabled'
    )
  })

  it('waits for main merge before processing labels', async () => {
    const f = fixture()
    f.pr.merged_at = ''
    expect((await planLineBackports(f)).targets).toEqual([])
  })

  it('provisions only configured target labels and tolerates repeated configuration pushes', async () => {
    const f = fixture()
    f.context.eventName = 'push'
    await planLineBackports(f)
    expect((await planLineBackports(f)).targets).toEqual([])
    expect([...f.labels]).toEqual(['target/2.1.x', 'target/2.0.x', 'target/2.2.x'])
  })

  it('uses current labels rather than an obsolete labeled event', async () => {
    const f = fixture()
    f.context.payload.action = 'labeled'
    f.pr.labels = []
    expect((await planLineBackports(f)).targets).toEqual([])
  })

  it('does not recursively enqueue work when automation updates status labels', async () => {
    const f = fixture()
    f.context.payload.action = 'labeled'
    f.context.payload.label.name = 'backport-open/2.0.x'
    expect((await planLineBackports(f)).targets).toEqual([])
  })

  it('routes merged-then-labeled PRs and limits manual retry to the requested line', async () => {
    const f = fixture()
    f.context.eventName = 'workflow_dispatch'
    expect((await planLineBackports({ ...f, inputs: { source_pr: '123', line: '2.0.x' } })).targets).toEqual([
      { source: 123, line: '2.0.x', retry: true }
    ])
  })

  it('tracks backport lifecycle even after that line has reached EOL', async () => {
    const f = fixture()
    f.pr.base.ref = 'release/1.9.x'
    f.pr.head = { ref: 'backport/1.9.x/pr-42', repo: { full_name: 'owner/project' } }
    f.pr.body = '<!-- release-backport-source-pr: 42 -->'
    expect((await planLineBackports(f)).targets).toEqual([{ source: 42, line: '1.9.x', retry: false }])
  })

  it('rejects forged or mismatched source markers', () => {
    const f = fixture()
    f.pr.base.ref = 'release/2.0.x'
    f.pr.head = { ref: 'backport/2.0.x/pr-42', repo: { full_name: 'owner/project' } }
    f.pr.body = '<!-- release-backport-source-pr: 41 -->'
    expect(() => backportIdentity(f.pr, 'owner/project')).toThrow('marker')
    expect(backportIdentity(f.pr, 'another/project')).toBeNull()
  })

  it.each([
    '```release-note\n<!-- release-backport-source-pr: 42 -->\n```',
    '<!-- release-backport-source-pr: 42 -->\n<!-- release-backport-source-pr: 42 -->'
  ])('requires exactly one source marker outside the release note', (body) => {
    const f = fixture()
    f.pr.base.ref = 'release/2.0.x'
    f.pr.head = { ref: 'backport/2.0.x/pr-42', repo: { full_name: 'owner/project' } }
    f.pr.body = body
    expect(() => backportIdentity(f.pr, 'owner/project')).toThrow('marker')
  })
})

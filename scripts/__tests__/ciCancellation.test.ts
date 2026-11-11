import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
const expression = (value: string, github: unknown) =>
  new Function('github', `return (${value.replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)(github)
const group = (event: string, ref = 'refs/heads/feature', number = 12) =>
  ci.concurrency.group.replace(/\$\{\{(.*?)\}\}/g, (_match: string, value: string) =>
    expression(value, {
      workflow: 'CI',
      event_name: event,
      ref,
      event: { pull_request: event === 'pull_request' ? { number } : {} }
    })
  )

describe('CI supersession', () => {
  it('replaces superseded PR and manual runs while preserving push ranges and scheduled full checks', () => {
    for (const event of ['pull_request', 'workflow_dispatch']) {
      expect(expression(ci.concurrency['cancel-in-progress'], { event_name: event })).toBe(true)
    }
    for (const event of ['push', 'schedule']) {
      expect(expression(ci.concurrency['cancel-in-progress'], { event_name: event })).toBe(false)
    }
  })

  it('isolates manual full validation from PR merge checks, pushes and daily validation', () => {
    const events = ['pull_request', 'workflow_dispatch', 'push', 'schedule']
    expect(new Set(events.map((event) => group(event))).size).toBe(events.length)
    expect(group('pull_request', 'refs/pull/12/merge', 12)).not.toBe(group('pull_request', 'refs/pull/13/merge', 13))
    expect(group('workflow_dispatch', 'refs/heads/first')).not.toBe(group('workflow_dispatch', 'refs/heads/second'))
    expect(group('workflow_dispatch', 'refs/heads/feature')).not.toBe(group('workflow_dispatch', 'refs/tags/feature'))
  })
})

const closedPr = {
  number: 12,
  state: 'closed',
  created_at: '2026-11-09T03:00:00Z',
  closed_at: '2026-11-09T06:00:00Z',
  head: { ref: 'feature', repo: { id: 1, owner: { login: 'CherryHQ' } } }
}
const run = (id: number, overrides = {}) => ({
  id,
  path: '.github/workflows/ci.yml',
  event: 'pull_request',
  status: 'queued',
  conclusion: null as string | null,
  head_branch: 'feature',
  head_repository: { id: 1 },
  created_at: '2026-11-09T05:00:00Z',
  run_started_at: '2026-11-09T05:00:00Z',
  ...overrides
})

async function cleanup(
  runs: ReturnType<typeof run>[],
  options: {
    pr?: typeof closedPr
    openPeers?: boolean
    reopenAfterListing?: boolean
    finishedDuringCancel?: number
    cancelError?: Error
  } = {}
) {
  const workflow = parse(readFileSync('.github/workflows/ci-cancel-closed-pr.yml', 'utf8'))
  const pr = structuredClone(options.pr ?? closedPr)
  const listRuns = () => {}
  const listPulls = () => {}
  const github = {
    rest: {
      actions: {
        listWorkflowRuns: listRuns,
        async cancelWorkflowRun({ run_id }: { run_id: number }) {
          const current = runs.find((item) => item.id === run_id)!
          if (options.cancelError) throw options.cancelError
          if (run_id === options.finishedDuringCancel) {
            current.status = 'completed'
            current.conclusion = 'success'
            throw Object.assign(new Error('Already finished'), { status: 409 })
          }
          current.status = 'completed'
          current.conclusion = 'cancelled'
        },
        async getWorkflowRun({ run_id }: { run_id: number }) {
          return { data: structuredClone(runs.find((item) => item.id === run_id)) }
        }
      },
      pulls: {
        list: listPulls,
        async get() {
          return { data: structuredClone(pr) }
        }
      }
    },
    async paginate(method: unknown, args: Record<string, string>) {
      if (method === listRuns) {
        if (options.reopenAfterListing) pr.state = 'open'
        const [since, until] = args.created?.split('..') ?? ['', '\uffff']
        return runs.filter(
          (item) =>
            item.path === `.github/workflows/${args.workflow_id}` &&
            item.head_branch === args.branch &&
            item.created_at >= since &&
            item.created_at <= until
        )
      }
      if (method === listPulls) return options.openPeers || pr.state === 'open' ? [pr] : []
      throw new Error('Unexpected paginated endpoint')
    }
  }
  const script = workflow.jobs.cancel.steps[0].with.script
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  await new AsyncFunction('github', 'context', 'core', script)(
    github,
    {
      repo: { owner: 'CherryHQ', repo: 'cherry-studio' },
      payload: { pull_request: closedPr, repository: { default_branch: 'main' } }
    },
    { info: () => {} }
  )
  return runs.filter((item) => item.status !== 'completed').map((item) => item.id)
}

describe('closed PR cleanup', () => {
  it('uses trusted API-only cleanup on PR closure without checking out PR code', () => {
    const workflow = parse(readFileSync('.github/workflows/ci-cancel-closed-pr.yml', 'utf8'))
    expect(workflow.on).toEqual({ pull_request_target: { types: ['closed'] } })
    expect(workflow.permissions).toEqual({})
    expect(workflow.jobs.cancel.permissions).toEqual({ actions: 'write', 'pull-requests': 'read' })
    for (const step of workflow.jobs.cancel.steps) {
      expect(step.uses).toMatch(/^actions\/github-script@/)
      expect(step.run).toBeUndefined()
    }
  })

  it('cancels unfinished PR and manual CI while retaining unrelated or completed work', async () => {
    const runs = [
      run(1),
      run(2, { event: 'workflow_dispatch', status: 'in_progress' }),
      run(3, { event: 'push' }),
      run(4, { event: 'schedule' }),
      run(5, { head_repository: { id: 2 } }),
      run(6, { head_branch: 'other' }),
      run(7, { path: '.github/workflows/release.yml' }),
      run(8, { created_at: '2026-11-09T06:01:00Z' }),
      run(9, { status: 'completed', conclusion: 'success' }),
      run(10, { run_started_at: '2026-11-09T06:01:00Z' })
    ]
    expect(await cleanup(runs)).toEqual([3, 4, 5, 6, 7, 8, 10])
    expect(runs[8].conclusion).toBe('success')
  })

  it('cleans up fork PRs without cancelling same-named base-repository runs', async () => {
    expect(
      await cleanup([run(1), run(2, { head_repository: { id: 2 } })], {
        pr: { ...closedPr, head: { ref: 'feature', repo: { id: 2, owner: { login: 'contributor' } } } }
      })
    ).toEqual([1])
  })

  it.each(['main', 'release/v2.1.0'])('preserves manual validation on %s', async (branch) => {
    expect(
      await cleanup([run(1, { head_branch: branch }), run(2, { head_branch: branch, event: 'workflow_dispatch' })], {
        pr: { ...closedPr, head: { ...closedPr.head, ref: branch } }
      })
    ).toEqual([2])
  })

  it('ignores delayed close events after reopening and branches shared with another open PR', async () => {
    expect(await cleanup([run(1)], { pr: { ...closedPr, state: 'open' } })).toEqual([1])
    expect(await cleanup([run(1)], { reopenAfterListing: true })).toEqual([1])
    expect(await cleanup([run(1)], { openPeers: true })).toEqual([1])
  })

  it('accepts a completion race but reports unexpected cancellation failures', async () => {
    const runs = [run(1), run(2)]
    expect(await cleanup(runs, { finishedDuringCancel: 1 })).toEqual([])
    expect(runs[0].conclusion).toBe('success')
    await expect(cleanup([run(1)], { cancelError: new Error('API unavailable') })).rejects.toThrow('API unavailable')
    await expect(
      cleanup([run(1)], { cancelError: Object.assign(new Error('Still active'), { status: 409 }) })
    ).rejects.toThrow('Still active')
  })
})

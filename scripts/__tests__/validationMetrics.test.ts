import { describe, expect, it } from 'vitest'

import { compareRuns, renderReport, summarizeRun } from '../validation/metrics.mjs'

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString()
const run = { id: 1, run_attempt: 1, created_at: at(0), event: 'pull_request', conclusion: 'success' }
const job = (name: string, start: number, end: number) => ({
  name,
  conclusion: 'success',
  labels: ['ubuntu-latest'],
  started_at: at(start),
  completed_at: at(end),
  steps: [
    { name: 'Validation scope: source-plan', conclusion: 'success', started_at: at(start), completed_at: at(start + 1) }
  ]
})

describe('CI performance reporting', () => {
  it('separates initial queue and execution window from parallel runner consumption', () => {
    const result = summarizeRun(run, [
      job('lint', 10, 40),
      job('types', 20, 60),
      { name: 'skipped', conclusion: 'skipped' }
    ])
    expect(result.queueSeconds).toBe(10)
    expect(result.executionSeconds).toBe(50)
    expect(result.elapsedSeconds).toBe(60)
    expect(result.runnerSeconds).toBe(70)
    expect(result.jobs[0].steps[0].seconds).toBe(1)
  })
  it('exposes later scheduling waits instead of hiding them behind the initial queue', () => {
    const result = summarizeRun(run, [
      { ...job('changes', 21, 42), created_at: at(1) },
      { ...job('main-test (1/3)', 237, 513), created_at: at(42) },
      { ...job('general-test', 645, 656), created_at: at(513) }
    ])
    expect(result.queueSeconds).toBe(21)
    expect(result.executionSeconds).toBe(635)
    expect(result.elapsedSeconds).toBe(656)
    expect(result.runnerSeconds).toBe(308)
    expect(result.jobs.find((item: { name: string }) => item.name === 'general-test')).toMatchObject({
      createdAt: at(513),
      startedAt: at(645),
      completedAt: at(656),
      beforeCreationSeconds: 513,
      schedulingSeconds: 132,
      seconds: 11
    })
    expect(result.jobTimings.scheduling).toEqual({ samples: 3, p50: 132, p90: 195, max: 195 })
    expect(result.jobTimings.execution).toEqual({ samples: 3, p50: 21, p90: 276, max: 276 })
    const report = renderReport(result, compareRuns(result, []))
    expect(report).toContain('132.0 s')
    expect(report).toContain(at(513))
    expect(report).toContain('not an isolated dependency wait')
    expect(report).toContain('No critical path is inferred')
  })
  it('preserves execution data when creation timestamps are absent or inconsistent', () => {
    const result = summarizeRun(run, [
      job('old API', 10, 30),
      { ...job('invalid creation', 10, 30), created_at: 'invalid' },
      { ...job('creation after start', 10, 30), created_at: at(31) },
      { ...job('creation before run', 10, 30), created_at: at(-1) }
    ])
    expect(result.runnerSeconds).toBe(80)
    for (const item of result.jobs) {
      expect(item.schedulingSeconds).toBeNull()
      expect(item.beforeCreationSeconds).toBeNull()
    }
    expect(result.jobTimings.scheduling).toEqual({ samples: 0, p50: null, p90: null, max: null })
    expect(renderReport(result, compareRuns(result, []))).toContain('0/4')
  })
  it.each([null, undefined, 0])(
    'does not treat unallocated runners (%s) or missing end times as zero cost',
    (runner) => {
      const result = summarizeRun({ ...run, conclusion: 'cancelled' }, [
        {
          ...job('never allocated', 10, 10),
          conclusion: 'cancelled',
          created_at: at(10),
          runner_id: runner,
          steps: []
        },
        { ...job('missing completion', 10, 20), created_at: at(1), completed_at: undefined }
      ])
      expect(result.runnerSeconds).toBeNull()
      expect(result.jobTimings.execution.samples).toBe(0)
      expect(result.jobs.find((item: { name: string }) => item.name === 'never allocated')).toMatchObject({
        seconds: null,
        schedulingSeconds: null
      })
    }
  )
  it('reports a known job scheduling interval when the workflow creation time is missing', () => {
    const result = summarizeRun({ ...run, created_at: undefined }, [{ ...job('lint', 30, 50), created_at: at(10) }])
    expect(result.queueSeconds).toBeNull()
    expect(result.elapsedSeconds).toBeNull()
    expect(result.jobs[0].beforeCreationSeconds).toBeNull()
    expect(result.jobs[0].schedulingSeconds).toBe(20)
    expect(result.runnerSeconds).toBe(20)
  })
  it('retains real zero-second jobs and does not confuse missing times with zero', () => {
    const result = summarizeRun(run, [{ ...job('brief', 10, 10), created_at: at(10) }])
    expect(result.runnerSeconds).toBe(0)
    expect(result.jobTimings.scheduling).toEqual({ samples: 1, p50: 0, p90: 0, max: 0 })
  })
  it('does not count the delay between reruns as queue or elapsed CI time', () => {
    const result = summarizeRun({ ...run, run_attempt: 2 }, [{ ...job('lint', 3600, 3630), created_at: at(3590) }])
    expect(result.queueSeconds).toBeNull()
    expect(result.elapsedSeconds).toBeNull()
    expect(result.executionSeconds).toBe(30)
    expect(result.jobs[0].beforeCreationSeconds).toBeNull()
    expect(result.jobs[0].schedulingSeconds).toBeNull()
  })
  it('does not count cancelled jobs without timestamps as zero-cost successes', () => {
    const result = summarizeRun({ ...run, conclusion: 'cancelled' }, [{ name: 'lint', conclusion: 'cancelled' }])
    expect(result.executionSeconds).toBeNull()
    expect(result.runnerSeconds).toBeNull()
    expect(result.comparisonKey).toBeNull()
    expect(renderReport(result, compareRuns(result, []))).toContain('Unavailable')
  })
  it('compares only equivalent successful runs and computes nearest-rank percentiles', () => {
    const current = summarizeRun(run, [job('lint', 10, 40)])
    const history = [20, 40, 60].map((duration, i) =>
      summarizeRun({ ...run, id: i + 2 }, [job('lint', 10, 10 + duration)])
    )
    const otherScope = { ...job('lint', 10, 20), steps: [{ name: 'Validation scope: docs-only' }] }
    const coldCache = {
      ...job('lint', 10, 20),
      steps: [...job('lint', 10, 20).steps, { name: 'Dependency cache: unknown' }]
    }
    history.push(
      current,
      summarizeRun({ ...run, id: 5, conclusion: 'failure' }, [job('lint', 10, 20)]),
      summarizeRun({ ...run, id: 6 }, [otherScope]),
      summarizeRun({ ...run, id: 7 }, [{ ...job('lint', 10, 20), labels: ['windows-2022'] }]),
      summarizeRun({ ...run, id: 8 }, [coldCache]),
      summarizeRun({ ...run, id: 9, event: 'push' }, [job('lint', 10, 20)])
    )
    expect(compareRuns(current, history)).toEqual({
      samples: 3,
      executionP50: 40,
      executionP90: 60,
      runnerP50: 40,
      runIds: [2, 3, 4]
    })
    expect(compareRuns(summarizeRun(run, [coldCache]), history).samples).toBe(0)
  })
  it('keeps uninstrumented dependency setup and old workflows out of baselines', () => {
    const old = summarizeRun(run, [{ ...job('lint', 10, 20), steps: [{ name: 'Install dependencies' }] }])
    expect(old.comparisonKey).toBeNull()
    const missingCache = summarizeRun(run, [
      {
        ...job('lint', 10, 20),
        steps: [...job('lint', 10, 20).steps, { name: 'Run ./.github/actions/setup-validation' }]
      }
    ])
    expect(missingCache.comparisonKey).toBeNull()
  })
  it('includes cache state in the comparison and safely renders job names', () => {
    const jobs = [
      {
        ...job('lint | <tag>\ntext', 10, 20),
        steps: [...job('lint', 10, 20).steps, { name: 'Dependency cache: exact-hit' }]
      }
    ]
    const measured = summarizeRun(run, jobs)
    expect(measured.jobs[0].cache).toBe('exact-hit')
    expect(measured.comparisonKey).toContain('exact-hit')
    expect(renderReport(measured, compareRuns(measured, []))).toContain('lint \\| &lt;tag> text')
  })
  it('accepts stored reports without the new timing fields as historical baselines', () => {
    const current = summarizeRun(run, [job('lint', 10, 40)])
    const legacy = JSON.parse(JSON.stringify({ ...current, id: 2 }))
    delete legacy.jobTimings
    for (const item of legacy.jobs) {
      for (const field of ['createdAt', 'startedAt', 'completedAt', 'beforeCreationSeconds', 'schedulingSeconds'])
        delete item[field]
    }
    expect(compareRuns(current, [legacy]).samples).toBe(1)
    expect(renderReport(legacy, compareRuns(legacy, []))).toContain('Unavailable')
  })
})

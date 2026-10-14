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
  it('separates queue and critical-path wall time from parallel runner consumption', () => {
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
  it('does not count the delay between reruns as queue or elapsed CI time', () => {
    const result = summarizeRun({ ...run, run_attempt: 2 }, [job('lint', 3600, 3630)])
    expect(result.queueSeconds).toBeNull()
    expect(result.elapsedSeconds).toBeNull()
    expect(result.executionSeconds).toBe(30)
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
})

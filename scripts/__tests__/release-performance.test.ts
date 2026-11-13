import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { renderReleasePerformance, summarizeRelease } from '../release/performance.mjs'

const time = (minutes: number) => new Date(Date.UTC(2026, 10, 13, 0, minutes)).toISOString()
const run = { id: 1, run_attempt: 1, head_sha: 'workflow', created_at: time(0) }
const job = (name: string, start: number, end: number, conclusion = 'success') => ({
  name,
  runner_id: 1,
  labels: ['windows-signing'],
  created_at: time(1),
  started_at: time(start),
  completed_at: time(end),
  conclusion,
  steps: [
    {
      name: 'Dependency cache: persistent-local',
      conclusion: 'success',
      started_at: time(start),
      completed_at: time(start)
    }
  ]
})

describe('release performance', () => {
  it('measures draft readiness without adding parallel jobs or waiting for approval and sync', () => {
    const report = summarizeRelease(
      run,
      [
        job('Prepare release ref', 1, 2),
        job('Build global (windows-latest)', 2, 20),
        job('Build cn (macos-latest)', 2, 15),
        job('Update draft release', 20, 23),
        job('Approve production release', 30, 31),
        job('Publish approved release', 31, 35),
        job('Sync both editions to GitCode', 35, 90)
      ],
      'source'
    )

    expect(report.sourceSha).toBe('source')
    expect(report.workflowSha).toBe('workflow')
    expect(report.draftReadySeconds).toBe(23 * 60)
    expect(report.runnerSeconds).toBe(35 * 60)
    expect(report.jobs.find(({ name }) => name.startsWith('Build global'))?.cache).toBe('persistent-local')
    expect(renderReleasePerformance(report)).toContain('23.00 min')
  })

  it('does not report a ready draft when finalization fails', () => {
    const report = summarizeRelease(run, [job('Update draft release', 1, 2, 'failure')], 'source')
    expect(report.draftReadySeconds).toBeNull()
  })

  it('does not count time between attempts as a rerun duration', () => {
    const report = summarizeRelease({ ...run, run_attempt: 2 }, [job('Update draft release', 30, 35)], 'source')
    expect(report.draftReadySeconds).toBeNull()
    expect(report.jobs[0].schedulingSeconds).toBeNull()
    expect(report.runnerSeconds).toBe(5 * 60)
  })

  it('preserves unknown durations for missing timestamps', () => {
    const report = summarizeRelease(run, [{ ...job('Build global (linux)', 1, 2), completed_at: null }], 'source')
    expect(report.runnerSeconds).toBeNull()
    expect(renderReleasePerformance(report)).toContain('unknown')
  })

  it('reports the final inventory size without treating missing inventory as empty', () => {
    const report = summarizeRelease(run, [job('Update draft release', 1, 2)], 'source', {
      'global/mac/app.zip': 1048576,
      'cn/mac/app.zip': 2097152
    })
    expect(renderReleasePerformance(report)).toContain('2 files, 3.00 MiB')
    const missing = summarizeRelease(run, [job('Build global (linux)', 1, 2, 'failure')], 'source')
    expect(missing.artifactSizes).toBeNull()
    expect(renderReleasePerformance(missing)).toContain('Artifact sizes: unknown')
  })

  it('exports real finalizer file sizes as one valid GitHub output line', () => {
    const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
    const step = workflow.jobs['finalize-build'].steps.find((entry) => entry.id === 'inventory')
    const script = step.run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/)[1]
    const root = mkdtempSync(path.join(tmpdir(), 'release-size-output-'))
    try {
      const output = path.join(root, 'output')
      writeFileSync(
        path.join(root, 'cos-release.json'),
        JSON.stringify({ files: { 'global/mac/app.zip': { size: 42 } } })
      )
      execFileSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output } })
      expect(readFileSync(output, 'utf8')).toBe('artifacts={"global/mac/app.zip":42}\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

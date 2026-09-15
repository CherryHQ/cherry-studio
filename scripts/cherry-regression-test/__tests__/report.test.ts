import { aggregateRuns, renderAggregateMarkdown, renderJUnit, renderMarkdown } from '../report'
import { completeE2eCase, createRun, finalizeRun, updatePhase } from '../state'

describe('regression report gate', () => {
  it('does not report a release pass when either platform is blocked', () => {
    const macos = finalizeRun(
      createRun({
        appVersion: '2.0.8',
        commitSha: 'sha',
        mode: 'tag',
        platform: 'macos',
        ref: 'v2.0.8',
        runner: 'macos-latest',
        task: 'all'
      })
    )
    const windows = completeE2eCase(
      createRun({
        appVersion: '2.0.8',
        commitSha: 'sha',
        mode: 'tag',
        platform: 'windows',
        ref: 'v2.0.8',
        runner: 'windows-latest',
        task: 'all'
      }),
      'C-02',
      'blocked',
      'No interactive desktop available'
    )

    expect(aggregateRuns([macos, finalizeRun(windows)]).verdict).toBe('release_blocked')
  })

  it('renders actionable Markdown and JUnit without relying on snapshots', () => {
    const run = finalizeRun(
      createRun({
        appVersion: 'development',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'windows',
        ref: 'main',
        runner: 'windows-latest',
        task: 'all'
      })
    )

    const markdown = renderMarkdown(run)
    expect(markdown).toContain('# Cherry Studio End-to-End Regression Report')
    expect(markdown).toContain('> **Overall verdict: ⛔ Development tests blocked**')
    expect(markdown).toContain(
      '| M-01 | Sign in to CherryIN and chat | ⛔ Blocked | Task did not finish before the final report | 0 |'
    )
    expect(markdown).toContain('Task did not finish before the final report')
    expect(markdown).not.toMatch(/[\u3400-\u9fff]/)
    expect(renderJUnit(run)).not.toMatch(/[\u3400-\u9fff]/)
    expect(renderAggregateMarkdown(aggregateRuns([run]))).not.toMatch(/[\u3400-\u9fff]/)
    expect(renderJUnit(run)).toContain('<skipped message="Task did not finish before the final report"')
    expect(renderJUnit(run)).toContain('classname="cherry-regression.executor" name="01-startup"><skipped')
  })

  it('keeps a missing branch matrix in the development verdict namespace', () => {
    const report = aggregateRuns([], 'branch')
    expect(report.verdict).toBe('development_blocked')
    expect(renderAggregateMarkdown(report)).toContain('> **Overall verdict: ⛔ Development tests blocked**')
    expect(renderAggregateMarkdown(report)).toContain('**Missing platform reports:** macOS, Windows')
  })

  it('includes both platforms and their failure details in one report', () => {
    const metadata = {
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      ref: 'main',
      task: 'notes'
    } as const
    const macos = completeE2eCase(
      createRun({ ...metadata, platform: 'macos', runner: 'macos-latest' }),
      'N-01',
      'passed',
      'Note saved successfully'
    )
    const windows = completeE2eCase(
      createRun({ ...metadata, platform: 'windows', runner: 'windows-2022' }),
      'N-01',
      'failed',
      'Save failed | File is read-only'
    )
    const markdown = renderAggregateMarkdown(aggregateRuns([windows, macos]))
    expect(markdown).toContain('| N-01 | Create and save a note | ✅ Passed | ❌ Failed |')
    expect(markdown).not.toContain('Note saved successfully')
    expect(markdown).not.toContain('Full results')
    expect(markdown).toContain('Save failed \\| File is read-only')
    expect(markdown).toContain('`index.html`')
    expect(markdown).toContain('`evidence/macos`')
    expect(markdown).toContain('`evidence/windows`')
    expect(markdown).not.toContain('| M-01 |')
    expect(renderAggregateMarkdown(aggregateRuns([macos]))).toContain(
      '| N-01 | Create and save a note | ✅ Passed | ⛔ Missing report |'
    )
  })

  it('keeps executor errors visible even when every case passed', () => {
    const run = completeE2eCase(
      createRun({
        appVersion: 'development',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'macos',
        ref: 'main',
        runner: 'macos-latest',
        task: 'notes'
      }),
      'N-01',
      'passed',
      'Note saved successfully'
    )
    const phaseId = Object.keys(run.phases)[0]
    const passed = updatePhase(run, phaseId, 'passed')
    expect(renderAggregateMarkdown(aggregateRuns([passed]))).not.toContain('## Needs attention')
    const failed = updatePhase(passed, phaseId, 'failed', ['Executor exit code 1'])
    const markdown = renderAggregateMarkdown(aggregateRuns([failed]))
    expect(markdown).toContain(`| macOS | Phase ${phaseId} | ❌ Failed | Executor exit code 1 |`)
    expect(markdown).toContain('Overall verdict: ❌ Development tests failed')
  })

  it('shows unfinished cases without claiming a passing result', () => {
    const run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'windows',
      ref: 'main',
      runner: 'windows-2022',
      task: 'notes'
    })
    const markdown = renderAggregateMarkdown(aggregateRuns([run]))
    expect(markdown).toContain('| Windows | 0 | 0 | 0 | 1 |')
    expect(markdown).toContain('| Windows | N-01 | ⏳ Pending | Task incomplete |')
    expect(markdown).toContain('Overall verdict: ⛔ Development tests blocked')
  })
})

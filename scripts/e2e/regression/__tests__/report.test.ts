import { aggregateRuns, renderAggregateMarkdown, renderJUnit, renderMarkdown } from '../report'
import { completeE2eCase, createRun, finalizeRun, updatePhase } from '../state'

describe('regression report gate', () => {
  const backendRun = (platform: 'macos' | 'windows') => {
    const run = createRun({
      appVersion: 'test',
      mockVersion: '1.46.0',
      commitSha: 'sha',
      mode: 'tag',
      platform,
      ref: 'vtest',
      runner: platform,
      task: 'translation-settings'
    })
    return finalizeRun(
      updatePhase(
        completeE2eCase(
          run,
          'MP-86',
          'passed',
          'Translation verified',
          [],
          ['aiMock: fixed model responses; real clipboard']
        ),
        'translation',
        'passed'
      )
    )
  }

  it('labels mock success separately from release acceptance in platform, aggregate and JUnit reports', () => {
    const runs = [backendRun('macos'), backendRun('windows')]
    const aggregate = aggregateRuns(runs)
    expect(aggregate.verdict).toBe('mock_pass')
    expect(renderAggregateMarkdown(aggregate)).toContain('Mock tests passed (deterministic fixtures)')
    const platform = renderMarkdown(runs[0])
    expect(platform).toContain('| Configured provider backend | mock |')
    expect(platform).toContain('| aiMock version | 1.46.0 |')
    expect(platform).toContain('MP-86 data source:')
    expect(renderJUnit(runs[0])).toContain('name="provider_mode" value="mock"')
    expect(renderJUnit(runs[0])).toContain('name="aimock_version" value="1.46.0"')
    expect(renderJUnit(runs[0])).toContain('name="data-source" value="aiMock: fixed model responses; real clipboard"')
  })

  it.each(['missing-provider', 'unsupported-provider', 'missing-version'])(
    'does not certify completed cases with invalid mock provenance: %s',
    (invalid) => {
      const run = backendRun('macos')
      if (invalid === 'missing-provider') delete run.metadata.providerMode
      if (invalid === 'unsupported-provider') Object.assign(run.metadata, { providerMode: 'unsupported' })
      if (invalid === 'missing-version') delete run.metadata.mockVersion
      const aggregate = aggregateRuns([run, backendRun('windows')])
      expect(aggregate.verdict).toBe('mock_blocked')
      expect(renderAggregateMarkdown(aggregate)).toContain(
        'Mock provider provenance or service version is missing or unsupported'
      )
      expect(renderMarkdown(run)).toContain('Overall verdict: ⛔ Mock tests blocked')
    }
  )
  describe.each(['branch', 'tag'] as const)('%s verdicts', (mode) => {
    it.each([
      ['passed', 'passed', 'pass'],
      ['passed', 'blocked', 'blocked'],
      ['blocked', 'passed', 'blocked'],
      ['passed', 'failed', 'failed'],
      ['failed', 'passed', 'failed'],
      ['blocked', 'blocked', 'blocked'],
      ['blocked', 'failed', 'failed'],
      ['failed', 'blocked', 'failed'],
      ['failed', 'failed', 'failed']
    ] as const)('macOS %s + Windows %s yields %s', (macosStatus, windowsStatus, expected) => {
      const runs = (['macos', 'windows'] as const).map((platform, index) => {
        const run = createRun({
          appVersion: 'test',
          mockVersion: '1.46.0',
          commitSha: 'sha',
          mode,
          platform,
          ref: 'test',
          runner: platform,
          task: 'notes-smoke'
        })
        const completed = completeE2eCase(run, 'N-01', index === 0 ? macosStatus : windowsStatus, 'Case finished')
        return finalizeRun(updatePhase(completed, 'basicFeatures', 'passed'))
      })
      expect(aggregateRuns(runs).verdict).toBe(`mock_${expected}`)
    })
  })

  it('renders actionable Markdown and JUnit without relying on snapshots', () => {
    const run = finalizeRun(
      createRun({
        appVersion: 'development',
        mockVersion: '1.46.0',
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
    expect(markdown).toContain('> **Overall verdict: ⛔ Mock tests blocked**')
    expect(markdown).toContain(
      '| N-01 | Create and save a note | ⛔ Blocked | Task did not finish before the final report | 0 |'
    )
    expect(markdown).toContain('Task did not finish before the final report')
    expect(markdown).not.toMatch(/[\u3400-\u9fff]/)
    expect(renderJUnit(run)).not.toMatch(/[\u3400-\u9fff]/)
    expect(renderAggregateMarkdown(aggregateRuns([run]))).not.toMatch(/[\u3400-\u9fff]/)
    expect(renderJUnit(run)).toContain('<skipped message="Task did not finish before the final report"')
    expect(renderJUnit(run)).toContain('classname="cherry-regression.executor" name="startup"><skipped')
  })

  it('blocks missing platform reports with a mock verdict', () => {
    const report = aggregateRuns([])
    expect(report.verdict).toBe('mock_blocked')
    expect(renderAggregateMarkdown(report)).toContain('> **Overall verdict: ⛔ Mock tests blocked**')
    expect(renderAggregateMarkdown(report)).toContain('**Missing platform reports:** macOS, Windows')
  })

  it('includes both platforms and their failure details in one report', () => {
    const metadata = {
      appVersion: 'development',
      mockVersion: '1.46.0',
      commitSha: 'sha',
      mode: 'branch',
      ref: 'main',
      task: 'notes-smoke'
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
    expect(markdown).not.toContain('| K-01 |')
    expect(renderAggregateMarkdown(aggregateRuns([macos]))).toContain(
      '| N-01 | Create and save a note | ✅ Passed | ⛔ Missing report |'
    )
  })

  it('keeps executor errors visible even when every case passed', () => {
    const run = completeE2eCase(
      createRun({
        appVersion: 'development',
        mockVersion: '1.46.0',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'macos',
        ref: 'main',
        runner: 'macos-latest',
        task: 'notes-smoke'
      }),
      'N-01',
      'passed',
      'Note saved successfully'
    )
    const phaseId = Object.keys(run.phases)[0]
    const passed = updatePhase(run, phaseId, 'passed')
    expect(renderAggregateMarkdown(aggregateRuns([passed]))).not.toContain('## Needs attention')
    expect(renderMarkdown(passed)).toContain('| Task selection | `notes-smoke` |')
    const failed = updatePhase(passed, phaseId, 'failed', ['Executor exit code 1'])
    const markdown = renderAggregateMarkdown(aggregateRuns([failed]))
    expect(markdown).toContain(`| macOS | Phase ${phaseId} | ❌ Failed | Executor exit code 1 |`)
    expect(markdown).toContain('Overall verdict: ❌ Mock tests failed')
  })

  it('shows unfinished cases without claiming a passing result', () => {
    const run = createRun({
      appVersion: 'development',
      mockVersion: '1.46.0',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'windows',
      ref: 'main',
      runner: 'windows-2022',
      task: 'notes-smoke'
    })
    const markdown = renderAggregateMarkdown(aggregateRuns([run]))
    expect(markdown).toContain('| Windows | 0 | 0 | 0 | 1 |')
    expect(markdown).toContain('| Windows | N-01 | ⏳ Pending | Task incomplete |')
    expect(markdown).toContain('Overall verdict: ⛔ Mock tests blocked')
  })
})

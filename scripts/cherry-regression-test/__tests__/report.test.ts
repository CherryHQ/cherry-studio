import { aggregateRuns, renderJUnit, renderMarkdown } from '../report'
import { completeCase, createRun, finalizeRun } from '../state'

describe('regression report gate', () => {
  it('does not report a release pass when either platform is blocked', () => {
    const macos = finalizeRun(
      createRun({
        appVersion: '2.0.8',
        commitSha: 'sha',
        mode: 'tag',
        platform: 'macos',
        ref: 'v2.0.8',
        runner: 'macos-latest'
      })
    )
    const windows = completeCase(
      createRun({
        appVersion: '2.0.8',
        commitSha: 'sha',
        mode: 'tag',
        platform: 'windows',
        ref: 'v2.0.8',
        runner: 'windows-latest'
      }),
      'C-02',
      'blocked',
      'No interactive desktop'
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
        runner: 'windows-latest'
      })
    )

    expect(renderMarkdown(run)).toContain('| M-01 | 登录 CherryIN 并完成聊天 | blocked |')
    expect(renderMarkdown(run)).toContain('Not executed before finalization')
    expect(renderJUnit(run)).toContain('<skipped message="Not executed before finalization"')
    expect(renderJUnit(run)).toContain('tests="23"')
  })

  it('keeps a missing branch matrix in the development verdict namespace', () => {
    expect(aggregateRuns([], 'branch').verdict).toBe('development_blocked')
  })
})

import { aggregateRuns, renderJUnit, renderMarkdown, renderTaskMarkdown } from '../report'
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
        runner: 'macos-latest',
        task: 'all'
      })
    )
    const windows = completeCase(
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
        runner: 'windows-latest',
        task: 'all'
      })
    )

    expect(renderMarkdown(run)).toContain('| M-01 | 登录 CherryIN 并完成聊天 | blocked |')
    expect(renderMarkdown(run)).toContain('Task did not finish before finalization')
    expect(renderJUnit(run)).toContain('<skipped message="Task did not finish before finalization"')
    expect(renderJUnit(run)).toContain('tests="23"')
  })

  it('renders an actionable task summary', () => {
    const run = finalizeRun(
      createRun({
        appVersion: 'development',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'macos',
        ref: 'main',
        runner: 'macos-latest',
        task: 'startup-smoke'
      })
    )

    const markdown = renderTaskMarkdown(run, 'startup-smoke', 'reached maximum number of turns (13)')
    expect(markdown).toContain('### Task `startup-smoke`')
    expect(markdown).toContain('Agent execution: reached maximum number of turns (13)')
    expect(markdown).toContain('| S-01 | blocked | Task did not finish before finalization |')
  })

  it('keeps a missing branch matrix in the development verdict namespace', () => {
    expect(aggregateRuns([], 'branch').verdict).toBe('development_blocked')
  })
})

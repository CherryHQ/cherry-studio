import { aggregateRuns, renderAggregateMarkdown, renderJUnit, renderMarkdown } from '../report'
import { completeE2eCase, createRun, finalizeRun } from '../state'

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
      '没有可交互的桌面'
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
    expect(markdown).toContain('# Cherry Studio 全链路回归测试报告')
    expect(markdown).toContain('> **总体结论：⛔ 开发分支测试受阻**')
    expect(markdown).toContain('| M-01 | 登录 CherryIN 并完成聊天 | ⛔ 阻塞 | 任务在生成最终报告前未完成 | 0 |')
    expect(markdown).toContain('任务在生成最终报告前未完成')
    expect(markdown).not.toContain('## Results')
    expect(markdown).not.toContain('Failures and Blockers')
    expect(renderJUnit(run)).toContain('<skipped message="任务在生成最终报告前未完成"')
    expect(renderJUnit(run)).toContain('tests="22"')
  })

  it('keeps a missing branch matrix in the development verdict namespace', () => {
    const report = aggregateRuns([], 'branch')
    expect(report.verdict).toBe('development_blocked')
    expect(renderAggregateMarkdown(report)).toContain('> **总体结论：⛔ 开发分支测试受阻**')
    expect(renderAggregateMarkdown(report)).toContain('**缺少平台报告：**macOS、Windows')
  })
})

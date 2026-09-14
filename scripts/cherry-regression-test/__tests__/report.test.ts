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
    expect(renderJUnit(run)).toContain('classname="cherry-regression.executor" name="01-startup"><skipped')
  })

  it('keeps a missing branch matrix in the development verdict namespace', () => {
    const report = aggregateRuns([], 'branch')
    expect(report.verdict).toBe('development_blocked')
    expect(renderAggregateMarkdown(report)).toContain('> **总体结论：⛔ 开发分支测试受阻**')
    expect(renderAggregateMarkdown(report)).toContain('**缺少平台报告：**macOS、Windows')
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
      '笔记保存成功'
    )
    const windows = completeE2eCase(
      createRun({ ...metadata, platform: 'windows', runner: 'windows-2022' }),
      'N-01',
      'failed',
      '保存失败 | 文件只读'
    )
    const markdown = renderAggregateMarkdown(aggregateRuns([windows, macos]))
    expect(markdown).toContain('| N-01 | 创建和保存笔记 | ✅ 通过 | ❌ 失败 |')
    expect(markdown).not.toContain('笔记保存成功')
    expect(markdown).not.toContain('完整结果')
    expect(markdown).toContain('保存失败 \\| 文件只读')
    expect(markdown).toContain('playwright/index.html')
    expect(markdown).not.toContain('| M-01 |')
    expect(renderAggregateMarkdown(aggregateRuns([macos]))).toContain(
      '| N-01 | 创建和保存笔记 | ✅ 通过 | ⛔ 缺少报告 |'
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
      '笔记保存成功'
    )
    const phaseId = Object.keys(run.phases)[0]
    const passed = updatePhase(run, phaseId, 'passed')
    expect(renderAggregateMarkdown(aggregateRuns([passed]))).not.toContain('## 需要关注')
    const failed = updatePhase(passed, phaseId, 'failed', ['执行器退出码 1'])
    const markdown = renderAggregateMarkdown(aggregateRuns([failed]))
    expect(markdown).toContain(`| macOS | 阶段 ${phaseId} | ❌ 失败 | 执行器退出码 1 |`)
    expect(markdown).toContain('总体结论：❌ 开发分支测试未通过')
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
    expect(markdown).toContain('| Windows | N-01 | ⏳ 等待执行 | 任务未完成 |')
    expect(markdown).toContain('总体结论：⛔ 开发分支测试受阻')
  })
})

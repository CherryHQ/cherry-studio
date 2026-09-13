import { aggregateRuns, renderJUnit, renderMarkdown } from '../report'
import { completeE2eCase, createRun, finalizeRun, getRunVerdict, updatePhase } from '../state'

function passedCase() {
  return completeE2eCase(
    createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'macos',
      ref: 'main',
      runner: 'macos-latest',
      task: 'startup-smoke'
    }),
    'S-01',
    'passed',
    '启动成功'
  )
}

describe('phase failure gate', () => {
  it('rejects global errors even after every case passed and exposes them in reports', () => {
    const run = updatePhase(passedCase(), '01-startup', 'failed', ['执行器错误：全局清理失败'])
    expect(getRunVerdict(run)).toBe('development_failed')
    expect(aggregateRuns([run]).verdict).toBe('development_failed')
    expect(renderMarkdown(run)).toContain('全局清理失败')
    expect(renderJUnit(run)).toContain('<failure message="执行器错误：全局清理失败"')
  })

  it('does not accept a killed or never-started phase whose cases passed', () => {
    const interrupted = updatePhase(passedCase(), '01-startup', 'running')
    expect(getRunVerdict(finalizeRun(interrupted))).toBe('development_blocked')
    expect(renderJUnit(finalizeRun(interrupted))).toContain('name="01-startup"><skipped message="阶段在完成前中断"')
    expect(getRunVerdict(passedCase())).toBe('development_blocked')
  })

  it('requires the executor and the selected cases to pass together', () => {
    const run = updatePhase(passedCase(), '01-startup', 'passed')
    expect(getRunVerdict(run)).toBe('development_pass')
    expect(getRunVerdict(completeE2eCase(run, 'S-01', 'blocked', '缺少运行能力'))).toBe('development_blocked')
    expect(getRunVerdict(updatePhase(run, '01-startup', 'passed', ['执行器错误']))).toBe('development_failed')
  })
})

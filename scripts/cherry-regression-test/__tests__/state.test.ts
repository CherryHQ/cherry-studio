import { completeE2eCase, createRun, finalizeRun, getRunVerdict } from '../state'

describe('Playwright run state', () => {
  it('requires every report summary to use Chinese', () => {
    const run = createRun({
      appVersion: '2.0.8',
      commitSha: 'sha',
      mode: 'tag',
      platform: 'macos',
      ref: 'v2.0.8',
      runner: 'macos-latest',
      task: 'all'
    })

    expect(() => completeE2eCase(run, 'M-02', 'failed', 'Provider returned an error')).toThrow(
      'M-02 的结果摘要必须使用简体中文'
    )
  })

  it('records Playwright results and artifacts without the legacy evidence contract', () => {
    const run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'macos',
      ref: 'main',
      runner: 'macos-latest',
      task: 'startup-smoke'
    })

    const completed = completeE2eCase(run, 'S-01', 'passed', '应用窗口已正常启动', ['failure.png'])

    expect(completed.cases['S-01']).toMatchObject({
      artifacts: ['failure.png'],
      status: 'passed',
      summary: '应用窗口已正常启动'
    })
  })

  it('turns every unexecuted applicable path into blocked at finalization', () => {
    const run = finalizeRun(
      createRun({
        appVersion: 'development',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'macos',
        ref: 'main',
        runner: 'macos-latest',
        task: 'all'
      })
    )

    expect(run.cases['S-01'].status).toBe('blocked')
    expect(run.cases['M-01'].status).toBe('blocked')
    expect(getRunVerdict(run)).toBe('development_blocked')
  })

  it('marks unselected tasks as not applicable', () => {
    const run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'macos',
      ref: 'main',
      runner: 'macos-latest',
      task: 'startup-smoke'
    })

    expect(run.cases['S-01'].status).toBe('pending')
    expect(run.cases['M-01']).toMatchObject({
      status: 'not_applicable',
      summary: '未被任务 startup-smoke 选中'
    })
  })
})

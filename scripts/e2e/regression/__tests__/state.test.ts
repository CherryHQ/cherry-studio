import { completeE2eCase, createRun, finalizeRun, getRunVerdict } from '../state'

describe('Playwright run state', () => {
  it('accepts English summaries but rejects empty results', () => {
    const run = createRun({
      appVersion: '2.0.8',
      commitSha: 'sha',
      mode: 'tag',
      platform: 'macos',
      ref: 'v2.0.8',
      runner: 'macos-latest',
      task: 'all'
    })

    const completed = completeE2eCase(run, 'M-02', 'failed', 'Provider returned an error')
    expect(completed.cases['M-02']).toMatchObject({ status: 'failed', summary: 'Provider returned an error' })
    expect(() => completeE2eCase(run, 'M-02', 'failed', '  ')).toThrow('M-02 requires a non-empty result summary')
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

    const completed = completeE2eCase(run, 'S-01', 'passed', 'Application window started successfully', ['failure.png'])

    expect(completed.cases['S-01']).toMatchObject({
      artifacts: ['failure.png'],
      status: 'passed',
      summary: 'Application window started successfully'
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

  it('marks platform-scoped cases as not applicable instead of failing a Windows run', () => {
    const run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'windows',
      ref: 'main',
      runner: 'windows-2022',
      task: 'all'
    })

    expect(run.cases['MP-133']).toMatchObject({
      status: 'not_applicable',
      summary: 'Not supported on windows'
    })
    expect(run.cases['S-01'].status).toBe('pending')
  })

  it('reports a task with no applicable case on this platform as not applicable instead of blocked', () => {
    const run = finalizeRun(
      createRun({
        appVersion: 'development',
        commitSha: 'sha',
        mode: 'branch',
        platform: 'windows',
        ref: 'main',
        runner: 'windows-2022',
        task: '08-code-tools'
      })
    )

    expect(run.phases).toEqual({})
    expect(getRunVerdict(run)).toBe('development_not_applicable')
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
      summary: 'Not selected by task startup-smoke'
    })
  })
})

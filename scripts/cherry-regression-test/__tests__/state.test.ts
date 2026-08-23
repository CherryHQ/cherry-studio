import { REGRESSION_CASES } from '../cases'
import { addEvidence, blockIncompleteTaskCases, completeCase, createRun, finalizeRun, getRunVerdict } from '../state'

describe('evidence-backed run state', () => {
  it('rejects a passed result when required machine evidence is missing', () => {
    const run = createRun({
      appVersion: '2.0.8',
      commitSha: 'sha',
      mode: 'tag',
      platform: 'macos',
      ref: 'v2.0.8',
      runner: 'macos-latest',
      task: 'all'
    })

    expect(() => completeCase(run, 'M-02', 'passed', 'Agent says the chat worked')).toThrow(
      'M-02 cannot pass without machine evidence'
    )
  })

  it('accepts pass only after every declared evidence item succeeded', () => {
    let run = createRun({
      appVersion: '2.0.8',
      commitSha: 'sha',
      mode: 'tag',
      platform: 'windows',
      ref: 'v2.0.8',
      runner: 'windows-latest',
      task: 'all'
    })
    const testCase = REGRESSION_CASES.find(({ id }) => id === 'N-01')!

    for (const requirement of testCase.evidence) {
      run = addEvidence(run, 'N-01', {
        id: requirement.id,
        kind: requirement.kind,
        observedAt: '2026-08-22T00:00:00.000Z',
        passed: true,
        source: 'driver',
        summary: requirement.description
      })
    }

    run = completeCase(run, 'N-01', 'passed', 'Note persisted after restart')
    expect(run.cases['N-01'].status).toBe('passed')
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
      summary: 'Not selected for task startup-smoke'
    })
  })

  it('blocks only unfinished cases from the failed agent task', () => {
    let run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'windows',
      ref: 'main',
      runner: 'windows-latest',
      task: 'all'
    })
    run = completeCase(run, 'P-01', 'failed', 'Image generation returned an error')
    run = blockIncompleteTaskCases(run, 'image-generation', 'Test agent reached maximum number of turns (70)')

    expect(run.cases['P-01']).toMatchObject({ status: 'failed', summary: 'Image generation returned an error' })
    expect(run.cases['P-02']).toMatchObject({
      status: 'blocked',
      summary: 'Test agent reached maximum number of turns (70)'
    })
    expect(run.cases['T-01'].status).toBe('pending')
  })
})

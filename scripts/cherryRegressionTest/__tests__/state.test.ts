import { REGRESSION_CASES } from '../cases'
import { addEvidence, completeCase, createRun, finalizeRun, getRunVerdict } from '../state'

describe('evidence-backed run state', () => {
  it('rejects a passed result when required machine evidence is missing', () => {
    const run = createRun({
      appVersion: '2.0.8',
      commitSha: 'sha',
      mode: 'tag',
      platform: 'macos',
      ref: 'v2.0.8',
      runner: 'macos-latest'
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
      runner: 'windows-latest'
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
        runner: 'macos-latest'
      })
    )

    expect(run.cases['S-01'].status).toBe('not_applicable')
    expect(run.cases['M-01'].status).toBe('blocked')
    expect(getRunVerdict(run)).toBe('development_blocked')
  })
})

import { describe, expect, it, vi } from 'vitest'

import { parseDoctorOutput } from '../prometheusDoctor'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

/**
 * The pack's stdout is a cross-process interface it documents as stable
 * (`lib/doctor/contract.md`): one JSON object per line, then a summary line. These cases are
 * taken from real output captured by running the doctor from an isolated copy of the pack.
 */
describe('parseDoctorOutput', () => {
  it('parses a check line into a result', () => {
    const { results } = parseDoctorOutput(
      '{"id":"mini-node-version","title":"Node.js version","status":"pass","summary":"Node 24.16.0"}\n'
    )

    expect(results).toEqual([
      { id: 'mini-node-version', title: 'Node.js version', status: 'pass', summary: 'Node 24.16.0', fixId: undefined }
    ])
  })

  it('treats the summary line as a completion marker, not a check', () => {
    const stdout =
      '{"id":"mini-pk","title":"Karpathy CLI (pk)","status":"pass","summary":"pk 1.9.0"}\n' +
      '{"summary":true,"pass":1,"warn":0,"fail":0,"skip":0}\n'

    const { results, complete } = parseDoctorOutput(stdout)

    expect(results).toHaveLength(1)
    expect(complete).toBe(true)
  })

  it('reports an absent summary line as an incomplete run', () => {
    // The process died partway. Partial results are still worth showing, but must not be
    // presented as a finished run.
    const { complete } = parseDoctorOutput('{"id":"mini-pk","title":"pk","status":"pass","summary":"ok"}\n')

    expect(complete).toBe(false)
  })

  it('reads the fix id a check offers, so the Repair button renders only where one exists', () => {
    const stdout =
      '{"id":"mini-skill-copies","title":"Skill copies","status":"fail","summary":"stale",' +
      '"actions":[{"kind":"fix","fixId":"copy-skills"}]}\n'

    const { results } = parseDoctorOutput(stdout)

    expect(results[0].fixId).toBe('copy-skills')
  })

  it('ignores a non-fix action rather than rendering a button for it', () => {
    const stdout =
      '{"id":"mini-docker","title":"Docker","status":"skip","summary":"absent",' +
      '"actions":[{"kind":"navigate","target":"/settings/general"}]}\n'

    expect(parseDoctorOutput(stdout).results[0].fixId).toBeUndefined()
  })

  it('keeps good lines when one line is not JSON', () => {
    // A single malformed line must not discard ten good results.
    const stdout =
      '{"id":"a","title":"A","status":"pass","summary":"ok"}\n' +
      'this is not json\n' +
      '{"id":"b","title":"B","status":"pass","summary":"ok"}\n'

    expect(parseDoctorOutput(stdout).results.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('drops a line whose status is not one the contract defines', () => {
    // A status we do not recognise means the contract drifted; guessing at it would be worse
    // than omitting the row.
    const stdout =
      '{"id":"a","title":"A","status":"exploded","summary":"?"}\n' +
      '{"id":"b","title":"B","status":"warn","summary":"ok"}\n'

    expect(parseDoctorOutput(stdout).results.map((r) => r.id)).toEqual(['b'])
  })

  it('drops a line missing the id or title the contract requires', () => {
    const stdout = '{"status":"pass","summary":"no id"}\n{"id":"b","title":"B","status":"pass","summary":"ok"}\n'

    expect(parseDoctorOutput(stdout).results.map((r) => r.id)).toEqual(['b'])
  })

  it('carries detail through, which is where a check with no repair explains what to do', () => {
    const stdout =
      '{"id":"mini-versions-toml","title":"Version authority","status":"skip",' +
      '"summary":"not authored yet","detail":"The operator writes it; agents never do."}\n'

    expect(parseDoctorOutput(stdout).results[0].detail).toBe('The operator writes it; agents never do.')
  })

  it('returns no results for empty output', () => {
    expect(parseDoctorOutput('')).toEqual({ results: [], complete: false })
  })
})

import { mkdtempSync, renameSync, rmSync } from 'node:fs'
import type * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { completeE2eCase, createRun, finalizeRun, getRunVerdict, readRun, updatePhase, writeRun } from '../state'
import type { RegressionRun } from '../types'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

describe('Playwright run state', () => {
  it('initializes every phase selected by a module task without selecting unrelated cases', () => {
    const run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'macos',
      ref: 'main',
      runner: 'macos-latest',
      task: 'notes'
    })
    expect(Object.keys(run.phases)).toEqual(['basicFeatures', 'notes'])
    expect(run.cases['N-01'].status).toBe('pending')
    expect(run.cases['MP-76'].status).toBe('pending')
    expect(run.cases['APP-01'].status).toBe('not_applicable')
  })

  it('preserves recorded verdicts after a task name is removed from the current manifest', () => {
    const run = createRun({
      appVersion: 'development',
      commitSha: 'sha',
      mode: 'branch',
      platform: 'macos',
      ref: 'main',
      runner: 'macos-latest',
      task: 'code-cli-permissions'
    })
    const completed = updatePhase(
      completeE2eCase(run, 'MP-97', 'passed', 'Permission modes verified'),
      'codeTools',
      'passed'
    )
    const historical = JSON.parse(
      JSON.stringify({
        ...completed,
        metadata: { ...completed.metadata, task: 'codeTools' }
      })
    ) as RegressionRun
    expect(getRunVerdict(historical)).toBe('development_pass')
  })
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
        task: 'code-cli-permissions'
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

describe('atomic run-state writes', () => {
  let directory: string
  let filePath: string
  let next: RegressionRun

  beforeEach(() => {
    vi.mocked(renameSync).mockReset()
    directory = mkdtempSync(join(tmpdir(), 'cherry-regression-state-'))
    filePath = join(directory, 'run.json')
    const run = createRun({
      appVersion: 'development',
      commitSha: 'base',
      mode: 'branch',
      platform: 'windows',
      ref: 'main',
      runner: 'windows',
      task: 'startup-smoke'
    })
    writeRun(filePath, run)
    next = { ...run, metadata: { ...run.metadata, commitSha: 'next' } }
  })

  afterEach(() => {
    vi.mocked(renameSync).mockReset()
    rmSync(directory, { recursive: true, force: true })
  })

  it.runIf(process.platform === 'win32')('publishes the new result after a temporary Windows file lock', () => {
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('File is temporarily in use'), { code: 'EPERM' })
    })

    writeRun(filePath, next)

    expect(readRun(filePath).metadata.commitSha).toBe('next')
  })

  it.runIf(process.platform === 'win32')('preserves the old result when a Windows file lock never releases', () => {
    const error = Object.assign(new Error('File remains in use'), { code: 'EPERM' })
    vi.mocked(renameSync).mockImplementation(() => {
      throw error
    })

    expect(() => writeRun(filePath, next)).toThrow(error)
    expect(readRun(filePath).metadata.commitSha).toBe('base')
  })

  it('propagates non-transient filesystem failures without losing the old result', () => {
    const error = Object.assign(new Error('Device write failed'), { code: 'EIO' })
    vi.mocked(renameSync).mockImplementation(() => {
      throw error
    })

    expect(() => writeRun(filePath, next)).toThrow(error)
    expect(readRun(filePath).metadata.commitSha).toBe('base')
  })
})

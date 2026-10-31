import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { addFailure, completeResult, createResult, QaError, readResult, saveResult } from '../report'

// Catch a later infrastructure error hiding or downgrading the original failure.
it('preserves all errors while selecting environment > unavailable > assertion', () => {
  const result = createResult({})
  addFailure(result, new QaError('steps', 1, 'ASSERTION_FAILED', 'missing response'))
  addFailure(result, new QaError('steps', 3, 'APP_UNAVAILABLE', 'connection closed'))
  completeResult(result)
  expect(result).toMatchObject({ status: 'failed', exitCode: 3, failureStage: 'steps' })
  addFailure(result, new QaError('cleanup', 2, 'CLEANUP_FAILED', 'owned process remains'))
  completeResult(result)
  expect(result).toMatchObject({ exitCode: 3, failureStage: 'steps' })
  expect(result.errors.map((error) => error.code)).toEqual(['ASSERTION_FAILED', 'APP_UNAVAILABLE', 'CLEANUP_FAILED'])
  addFailure(result, new QaError('environment', 2, 'TIMEZONE_MISMATCH', 'wrong timezone'))
  completeResult(result)
  expect(result).toMatchObject({ exitCode: 2, failureStage: 'environment' })
})

it.each([1, 3] as const)('keeps execution exit %s when cleanup also fails', (exitCode) => {
  const result = createResult({})
  addFailure(result, new QaError('cleanup', 2, 'CLEANUP_FAILED', 'owned process remains'))
  addFailure(result, new QaError('steps', exitCode, 'STEP_FAILED', 'step failed'))
  completeResult(result)
  expect(result).toMatchObject({ status: 'failed', exitCode, failureStage: 'steps' })
  expect(result.errors.map((error) => error.code)).toEqual(['CLEANUP_FAILED', 'STEP_FAILED'])
})

it('fails an otherwise successful run when cleanup fails', () => {
  const result = createResult({})
  completeResult(result)
  expect(result).toMatchObject({ status: 'passed', exitCode: 0 })
  addFailure(result, new QaError('cleanup', 2, 'CLEANUP_FAILED', 'owned process remains'))
  completeResult(result)
  expect(result).toMatchObject({ status: 'failed', exitCode: 2, failureStage: 'cleanup' })
})

it('starts with a recoverable interrupted snapshot rather than a provisional pass', () => {
  expect(createResult({})).toMatchObject({ schemaVersion: 1, status: 'interrupted', exitCode: null })
})

it('retains the public v1 fields, runtime provenance, and sanitized failure evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'qa-report-'))
  try {
    const result = createResult({
      ImageOS: 'win22',
      ImageVersion: '20261020.1',
      GITHUB_SHA: 'controller',
      QA_SHA: 'application'
    })
    result.environment.appVersion = '2.1.7'
    result.steps.push({ step: 1, verb: 'fill', status: 'passed', seconds: 0 })
    addFailure(
      result,
      new QaError('environment', 2, 'ENVIRONMENT_FAILED', 'Bearer secret-value and configured-credential')
    )
    completeResult(result)
    saveResult(directory, result, ['configured-credential', 'passed', 'failed', 'fill', 'ENVIRONMENT_FAILED'])
    const stored = readResult(directory)
    expect(Object.keys(stored).sort()).toEqual(
      [
        'schemaVersion',
        'status',
        'exitCode',
        'failureStage',
        'errors',
        'metadata',
        'environment',
        'timings',
        'steps',
        'artifacts'
      ].sort()
    )
    expect(stored).toMatchObject({
      schemaVersion: 1,
      exitCode: 2,
      metadata: { controllerSha: 'controller', applicationSha: 'application' },
      environment: { appVersion: '2.1.7', imageOS: 'win22', imageVersion: '20261020.1' }
    })
    expect(stored.status).toBe('failed')
    expect(stored.steps[0]).toMatchObject({ verb: 'fill', status: 'passed' })
    expect(stored.errors[0].code).toBe('ENVIRONMENT_FAILED')
    for (const file of ['results.json', 'results.md']) {
      const output = readFileSync(join(directory, file), 'utf8')
      expect(output).not.toContain('secret-value')
      expect(output).not.toContain('configured-credential')
      expect(output).toContain('[REDACTED]')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

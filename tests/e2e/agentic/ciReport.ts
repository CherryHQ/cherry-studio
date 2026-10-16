import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Report } from 'e2e'

export const cases = ['startup', 'settings', 'notes', 'chat', 'chatRecovery'] as const
const phasesFor = (name: string) =>
  ['settings', 'notes', 'chatRecovery'].includes(name) ? ['write', 'read'] : ['write']

export interface RunReport {
  status: string
  error?: string
  interrupted: boolean
  metadata: {
    sha: string
    runDirectory: string
    platform: string
    arch: string
    osRelease: string
    runner?: string
    startedAt: string
    versions: Record<string, string>
    preflight?: { modelCalls: number; modelTokens: number }
  }
  finishedAt: string
  results: Array<{
    case: string
    status: string
    phases: Array<{
      phase: string
      exitCode: number
      report?: string
      modelCalls?: number
      modelTokens?: number
      replayed?: number
      durationMs?: number
    }>
  }>
}

export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8'))
export const readRun = (directory: string) => readJson<RunReport>(join(directory, 'report.json'))
export const readIdentity = (directory: string, name: string, phase: string) =>
  readJson<{ electronPid: number; targetId: string; logPath: string; cdpPort: number }>(
    join(directory, name, `identity-${phase}.json`)
  )

export function verifyRun(directory: string, expected: readonly string[], sha: string) {
  const report = readRun(directory)
  assert.equal(report.metadata.sha, sha, 'Report belongs to a different commit')
  assert.equal(report.status, 'passed', 'Run did not pass')
  assert.equal(report.interrupted, false)
  assert.deepEqual(
    report.results.map((result) => result.case),
    expected,
    'Missing, duplicate, or unexpected cases'
  )
  for (const result of report.results) {
    assert.equal(result.status, 'passed')
    assert.deepEqual(
      result.phases.map((phase) => phase.phase),
      phasesFor(result.case),
      'Incomplete persistence phases'
    )
    for (const phase of result.phases) {
      assert.equal(phase.exitCode, 0)
      const relativeReport = join(result.case, phase.phase, 'report.json')
      assert.equal(phase.report, relativeReport, 'Phase report must use a portable relative path')
      const framework = readJson<Report>(join(directory, relativeReport))
      assert.equal(framework.run.results.length, 1)
      const test = framework.run.results[0]
      assert.equal(test.status, 'passed')
      assert.equal(test.attempts.length, 1, 'Automatic retries are not permitted')
      assert.equal(test.attempts[0].cleanup, 'complete')
      const identity = readIdentity(directory, result.case, phase.phase)
      assert(identity.electronPid > 0 && identity.targetId.length > 0, 'Missing native-window identity')
    }
    if (result.phases.length === 2) {
      const before = readIdentity(directory, result.case, 'write')
      const after = readIdentity(directory, result.case, 'read')
      assert.notEqual(after.electronPid, before.electronPid, 'Electron was not restarted')
      assert.notEqual(after.targetId, before.targetId, 'Native target was not replaced')
      assert.equal(after.logPath, before.logPath, 'Restart used a different application profile')
    }
  }
  return report
}

export function verifyFreshProfiles(cold: string, warm: string) {
  assert.notEqual(readRun(cold).metadata.runDirectory, readRun(warm).metadata.runDirectory)
  for (const name of cases) {
    const marker = (directory: string) => readJson<{ marker: string }>(join(directory, name, 'case.json')).marker
    assert(marker(cold) && marker(warm))
    assert.notEqual(marker(cold), marker(warm), 'Warm run reused old test input')
    assert.notEqual(
      readIdentity(cold, name, 'write').logPath,
      readIdentity(warm, name, 'write').logPath,
      'Warm run reused an application profile'
    )
  }
}

export function verifyWrongResponse(directory: string) {
  const report = readRun(directory)
  assert.equal(report.status, 'failed')
  assert.deepEqual(
    report.results.map((result) => [result.case, result.status]),
    [['chat', 'failed']]
  )
  assert.deepEqual(
    report.results[0].phases.map((phase) => [phase.phase, phase.exitCode]),
    [['write', 1]]
  )
  const framework = readJson<Report>(join(directory, 'chat/write/report.json'))
  assert.equal(framework.run.results.length, 1)
  assert.equal(framework.run.results[0].status, 'failed')
  assert.equal(framework.run.results[0].attempts.length, 1)
  const attempt = framework.run.results[0].attempts[0]
  assert.equal(attempt.cleanup, 'complete')
  assert.equal(attempt.error?.code, 'ASSERTION_FAILED', 'Failure was not a product assertion')
  assert(attempt.error.message.includes('Sunlight separates into colors.'), 'A different assertion failed')
  const screen = attempt.artifacts.find((artifact) => artifact.id === attempt.failure?.screen)
  assert(screen?.path, 'Missing failure screen evidence')
  assert(
    readFileSync(join(directory, 'chat/write/results', screen.path), 'utf8').includes('WRONG RESPONSE'),
    'Wrong response never reached the UI'
  )
  assert(
    attempt.artifacts.some(
      (artifact) =>
        artifact.kind === 'screenshot' &&
        artifact.path &&
        existsSync(join(directory, 'chat/write/results', artifact.path))
    ),
    'Missing failure screenshot'
  )
}

export function assertNoSecrets(directory: string, secrets: string[]) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    assert(!entry.isSymbolicLink(), 'Evidence and caches must not contain symbolic links')
    if (entry.isDirectory()) assertNoSecrets(file, secrets)
    else if (secrets.filter(Boolean).some((secret) => readFileSync(file).includes(secret)))
      throw new Error(`Configured secret found in ${entry.name}; publication blocked`)
  }
}

export function summary(rounds: Array<{ name: string; exitCode: number; report?: RunReport }>, error?: string) {
  const metadata = rounds.find((round) => round.report)?.report?.metadata
  return [
    '# Agentic Electron E2E',
    '',
    `Result: ${error ? 'failed' : 'passed'}`,
    `Commit: ${metadata?.sha ?? 'unavailable'}`,
    `Runner: ${metadata?.runner ?? 'local'}; ${metadata?.platform ?? '?'} ${metadata?.arch ?? '?'} ${metadata?.osRelease ?? '?'}`,
    `Versions: ${JSON.stringify(metadata?.versions ?? {})}`,
    '',
    '| Run | Case | Result | Duration (ms) | Model calls | Tokens | Replayed steps |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rounds.flatMap(({ name, report }) => {
      const rows =
        report?.results.map((result) => {
          const total = (key: 'durationMs' | 'modelCalls' | 'modelTokens' | 'replayed') =>
            result.phases.reduce((n, phase) => n + (phase[key] ?? 0), 0)
          return `| [${name}](${name}/summary.md) | ${result.case} | ${result.status} | ${total('durationMs')} | ${total('modelCalls')} | ${total('modelTokens')} | ${total('replayed')} |`
        }) ?? []
      return rows
    }),
    '',
    ...rounds.map(
      ({ name, exitCode, report }) =>
        `\n[${name}](${name}/summary.md): exit ${exitCode}; report ${report?.status ?? 'missing'}; API preflight ${report?.metadata.preflight?.modelCalls ?? 0} calls / ${report?.metadata.preflight?.modelTokens ?? 0} tokens${report?.error ? `; ${report.error.replaceAll('\n', ' ')}` : ''}\n`
    ),
    ...(error ? ['', `Failure: ${error.replaceAll('\n', ' ').replaceAll('|', '\\|')}`] : []),
    ''
  ].join('\n')
}

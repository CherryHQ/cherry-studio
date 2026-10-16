import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'

import {
  assertNoSecrets,
  cases,
  readRun,
  summary,
  verifyFreshProfiles,
  verifyRun,
  verifyWrongResponse
} from './ciReport'
import type { RunReport } from './ciReport'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const expectedPhases = {
    startup: ['write'],
    settings: ['write', 'read'],
    notes: ['write', 'read'],
    chat: ['write'],
    chatRecovery: ['write', 'read']
  }
  const directory = mkdtempSync(join(tmpdir(), 'agentic-ci-contract-'))
  directories.push(directory)
  const write = (file: string, value: unknown) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true })
    writeFileSync(join(directory, file), JSON.stringify(value))
  }
  const report: RunReport = {
    status: 'passed',
    interrupted: false,
    finishedAt: '2026-10-16T01:00:00Z',
    metadata: {
      sha: 'tested-sha',
      runDirectory: directory,
      platform: 'darwin',
      arch: 'arm64',
      osRelease: '25',
      startedAt: '2026-10-16T00:00:00Z',
      versions: { electron: '44.4.4' }
    },
    results: cases.map((name, index) => ({
      case: name,
      status: 'passed',
      phases: expectedPhases[name].map((phase, phaseIndex) => {
        write(`${name}/identity-${phase}.json`, {
          electronPid: index * 10 + phaseIndex + 1,
          targetId: `${name}-${phase}`,
          logPath: `${directory}/${name}/electron.log`,
          cdpPort: 19322
        })
        write(`${name}/${phase}/report.json`, {
          run: { results: [{ status: 'passed', attempts: [{ cleanup: 'complete' }] }] }
        })
        return { phase, exitCode: 0, report: `${name}/${phase}/report.json` }
      })
    }))
  }
  for (const name of cases) write(`${name}/case.json`, { marker: `${directory}-${name}` })
  write('report.json', report)
  return { directory, report, write }
}

await test('a complete five-case run with native restarts passes and exports portable links', () => {
  const { directory } = fixture()
  const report = verifyRun(directory, cases, 'tested-sha')
  assert.equal(report.results.length, 5)
  assert(summary([{ name: 'cold', exitCode: 0, report }]).includes('[cold](cold/summary.md)'))
})

for (const status of ['blocked', 'failed', 'running', 'interrupted'])
  await test(`a ${status} run cannot pass the CI gate`, () => {
    const { directory, report, write } = fixture()
    report.status = status
    write('report.json', report)
    assert.throws(() => verifyRun(directory, cases, 'tested-sha'), /Run did not pass/)
  })

await test('a different tested commit cannot satisfy the CI gate', () => {
  assert.throws(() => verifyRun(fixture().directory, cases, 'another-sha'), /different commit/)
})

await test('missing cases, missing persistence phases, failed children and missing reports cannot hide behind a passed summary', () => {
  for (const defect of ['case', 'phase', 'exit', 'report']) {
    const { directory, report, write } = fixture()
    if (defect === 'case') report.results.pop()
    if (defect === 'phase') report.results[1].phases.pop()
    if (defect === 'exit') report.results[0].phases[0].exitCode = 1
    if (defect === 'report') rmSync(join(directory, 'startup/write/report.json'))
    write('report.json', report)
    assert.throws(() => verifyRun(directory, cases, 'tested-sha'), defect)
  }
})

await test('a page reload cannot masquerade as an Electron restart', () => {
  const { directory, write } = fixture()
  const identity = JSON.parse(readFileSync(join(directory, 'settings/identity-write.json'), 'utf8'))
  write('settings/identity-read.json', identity)
  assert.throws(() => verifyRun(directory, cases, 'tested-sha'), /Electron was not restarted/)
})

await test('framework retries and incomplete cleanup fail the gate', () => {
  for (const attempts of [[{ cleanup: 'incomplete' }], [{ cleanup: 'complete' }, { cleanup: 'complete' }]]) {
    const { directory, write } = fixture()
    write('startup/write/report.json', { run: { results: [{ status: 'passed', attempts }] } })
    assert.throws(() => verifyRun(directory, cases, 'tested-sha'))
  }
})

await test('cold and warm runs must use distinct profiles and inputs', () => {
  const cold = fixture(),
    warm = fixture()
  verifyFreshProfiles(cold.directory, warm.directory)
  assert.throws(() => verifyFreshProfiles(cold.directory, cold.directory))
  warm.write('startup/case.json', JSON.parse(readFileSync(join(cold.directory, 'startup/case.json'), 'utf8')))
  assert.throws(() => verifyFreshProfiles(cold.directory, warm.directory), /old test input/)
})

await test('wrong-response acceptance requires the intended assertion, displayed wrong text and screenshot', () => {
  const { directory, report, write } = fixture()
  report.status = 'failed'
  report.results = [{ case: 'chat', status: 'failed', phases: [{ phase: 'write', exitCode: 1 }] }]
  write('report.json', report)
  const attempt = {
    cleanup: 'complete',
    error: { code: 'ASSERTION_FAILED', message: 'Sunlight separates into colors.' },
    failure: { screen: 'screen' },
    artifacts: [
      { id: 'screen', path: 'screen.txt' },
      { kind: 'screenshot', path: 'failure.png' }
    ]
  }
  const framework = { run: { results: [{ status: 'failed', attempts: [attempt] }] } }
  write('chat/write/report.json', framework)
  mkdirSync(join(directory, 'chat/write/results'), { recursive: true })
  writeFileSync(join(directory, 'chat/write/results/screen.txt'), 'WRONG RESPONSE')
  writeFileSync(join(directory, 'chat/write/results/failure.png'), '')
  verifyWrongResponse(directory)
  attempt.error.code = 'MODEL_ERROR'
  write('chat/write/report.json', framework)
  assert.throws(() => verifyWrongResponse(directory), /not a product assertion/)
  attempt.error.code = 'ASSERTION_FAILED'
  write('chat/write/report.json', framework)
  writeFileSync(join(directory, 'chat/write/results/screen.txt'), 'Settings could not open')
  assert.throws(() => verifyWrongResponse(directory), /never reached the UI/)
})

await test('a configured secret blocks publication without printing its value', () => {
  const { directory, write } = fixture()
  write('nested/log.json', { token: 'private-test-value' })
  assert.throws(
    () => assertNoSecrets(directory, ['private-test-value']),
    (error: Error) => error.message.includes('publication blocked') && !error.message.includes('private-test-value')
  )
  assertNoSecrets(directory, ['another-private-value'])
})

await test('missing reports remain visible in the job summary', () => {
  const markdown = summary([{ name: 'cold', exitCode: 1 }], 'Missing report')
  assert(markdown.includes('Result: failed'))
  assert(markdown.includes('report missing'))
  assert.throws(() => readRun(join(fixture().directory, 'missing')))
})

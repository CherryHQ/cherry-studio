import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import type * as processControl from '../../../scripts/e2e/regression/process'
import type * as redaction from '../../../scripts/e2e/regression/redaction'
import {
  assertNoSecrets,
  cases,
  readIdentity,
  readJson,
  readRun,
  summary,
  verifyFreshProfiles,
  verifyRun,
  verifyWrongResponse
} from './ciReport'
import type { RunReport } from './ciReport'
import { secretValues } from './environment'

const require = createRequire(import.meta.url)
const { findListeningPid, isAlive } = require('../../../scripts/e2e/regression/process.ts') as typeof processControl
const { createRedactor } = require('../../../scripts/e2e/regression/redaction.ts') as typeof redaction
const redact = createRedactor(secretValues)
const project = import.meta.dirname
const repository = resolve(project, '../../..')
const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'run' },
    case: { type: 'string', default: 'all' },
    output: { type: 'string' }
  }
})
assert(['run', 'acceptance'].includes(values.mode), 'Unknown CI mode')
assert(values.case === 'all' || cases.includes(values.case as (typeof cases)[number]), 'Unknown case')
assert(values.mode !== 'acceptance' || values.case === 'all', 'Acceptance requires all five cases')
assert(values.output, '--output is required')
const output = resolve(values.output)
assert(!existsSync(output) || readdirSync(output).length === 0, 'Output directory must be empty')
const artifact = join(output, 'artifact')
mkdirSync(artifact, { recursive: true })
const data = mkdtempSync(join(tmpdir(), 'cherry-agentic-ci-'))
const cache = join(project, '.e2e/cache')
const previousCache = join(data, 'previous-cache')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
const rounds: Array<{ name: string; exitCode: number; report?: RunReport }> = []
let child: ReturnType<typeof spawn> | undefined
let interrupted = false
let error: string | undefined
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    interrupted = true
    child?.kill(signal)
  })

async function run(name: string, args: string[], env: NodeJS.ProcessEnv = {}, cancel = false) {
  assert(!interrupted, 'CI run interrupted')
  const directory = join(artifact, name)
  const runDirectory = join(data, name)
  const worker = spawn(
    process.execPath,
    [
      '--import',
      join(project, 'node_modules/tsx/dist/loader.mjs'),
      join(project, 'run.ts'),
      '--run-dir',
      runDirectory,
      '--evidence-dir',
      directory,
      ...args
    ],
    { cwd: project, env: { ...process.env, ...env }, stdio: 'inherit' }
  )
  child = worker
  const exited = new Promise<number>((done, reject) => {
    worker.once('error', reject)
    worker.once('close', (code) => {
      child = undefined
      done(code ?? 130)
    })
  })
  try {
    if (cancel) {
      const deadline = Date.now() + 180_000
      let fixture: { pid: number; port: number } | undefined
      while (Date.now() < deadline && worker.exitCode === null && !interrupted) {
        const file = join(runDirectory, 'chat/fixture.json')
        if (existsSync(file) && existsSync(join(runDirectory, 'chat/identity-write.json'))) {
          fixture = readJson(file)
          if (findListeningPid('macos', fixture!.port) === fixture!.pid) break
          fixture = undefined
        }
        await delay(500)
      }
      assert(fixture, 'No live framework HTTP fixture observed before cancellation')
      const identity = readIdentity(runDirectory, 'chat', 'write')
      worker.kill('SIGTERM')
      const timeout = setTimeout(() => worker.kill('SIGKILL'), 45_000)
      let code: number
      try {
        code = await exited
      } finally {
        clearTimeout(timeout)
      }
      assert.equal(code, 130, 'Driver did not finish graceful cancellation')
      assert.equal(worker.signalCode, null, 'Driver required force termination')
      assert.equal(isAlive(fixture.pid), false, 'Framework worker survived cancellation')
      assert.notEqual(findListeningPid('macos', fixture.port), fixture.pid, 'HTTP fixture survived cancellation')
      assert.equal(findListeningPid('macos', identity.cdpPort), undefined, 'Electron listener survived cancellation')
      writeFileSync(
        join(directory, 'cancellation-proof.json'),
        JSON.stringify({ exitCode: code, fixture, identity, cleaned: true }, null, 2)
      )
    }
    const exitCode = await exited
    const report = existsSync(join(directory, 'report.json')) ? readRun(directory) : undefined
    rounds.push({ name, exitCode, report })
    assert(report, `Missing report for ${name}`)
    assert.equal(report.metadata.sha, sha, 'Report belongs to a different commit')
    return { directory, exitCode, report }
  } finally {
    if (child === worker) {
      worker.kill('SIGTERM')
      const timeout = setTimeout(() => worker.kill('SIGKILL'), 45_000)
      try {
        await exited
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}

try {
  if (values.mode === 'acceptance') {
    if (existsSync(cache)) renameSync(cache, previousCache)
    const cold = await run('cold', [])
    assert.equal(cold.exitCode, 0)
    verifyRun(cold.directory, cases, sha)
    assert(
      cold.report.results.every((result) => result.phases.every((phase) => phase.replayed === 0)),
      'Cold run reused action recordings'
    )
    const warm = await run('warm', [])
    assert.equal(warm.exitCode, 0)
    verifyRun(warm.directory, cases, sha)
    verifyFreshProfiles(cold.directory, warm.directory)
    assert(
      warm.report.results.some((result) => result.phases.some((phase) => (phase.replayed ?? 0) > 0)),
      'Warm run did not replay any actions'
    )
    const negative = await run('wrong-response', ['--case', 'chat', '--inject-failure'])
    assert.equal(negative.exitCode, 1)
    verifyWrongResponse(negative.directory)
    const missing = await run('missing-key', ['--case', 'startup'], { CHERRY_TEST_CUSTOM_PROVIDER_API_KEY: '' })
    assert.equal(missing.exitCode, 1)
    assert.equal(missing.report.status, 'blocked')
    assert.equal(missing.report.error, 'Missing CHERRY_TEST_CUSTOM_PROVIDER_API_KEY')
    assert.deepEqual(missing.report.results, [], 'Missing-key preflight launched test cases')
    const cancelled = await run('cancellation', ['--case', 'chat'], {}, true)
    assert.equal(cancelled.report.status, 'interrupted')
    assert.equal(cancelled.report.interrupted, true)
  } else {
    const expected = cases.filter((name) => values.case === 'all' || name === values.case)
    const result = await run('run', values.case === 'all' ? [] : ['--case', values.case])
    assert.equal(result.exitCode, 0)
    verifyRun(result.directory, expected, sha)
  }
} catch (failure) {
  error = redact(failure instanceof Error ? failure.message : String(failure))
} finally {
  if (interrupted) error = 'CI run interrupted'
  if (existsSync(previousCache)) {
    rmSync(cache, { recursive: true, force: true })
    renameSync(previousCache, cache)
  }
  try {
    assertNoSecrets(artifact, secretValues)
    assertNoSecrets(cache, secretValues)
  } catch {
    renameSync(artifact, join(output, 'quarantined-evidence'))
    mkdirSync(artifact)
    error = 'Configured secret or unsafe file detected; evidence quarantined and cache publication blocked'
  }
  const markdown = redact(summary(rounds, error))
  writeFileSync(join(artifact, 'summary.md'), markdown)
  writeFileSync(
    join(artifact, 'ci.json'),
    JSON.stringify(
      redact({ sha, mode: values.mode, case: values.case, status: error ? 'failed' : 'passed', error, rounds }),
      null,
      2
    )
  )
  assertNoSecrets(artifact, secretValues)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'publishable=true\n')
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'))
  if (error) {
    process.stderr.write(`${error}\n`)
    process.exitCode = interrupted ? 130 : 1
  }
  process.stdout.write(`CI evidence: ${artifact}\n`)
}

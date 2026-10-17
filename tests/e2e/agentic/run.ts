import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import type { Report } from 'e2e'
import { chromium } from 'playwright-core'

import type * as lifecycle from '../../../scripts/e2e/regression/lifecycle'
import type * as paths from '../../../scripts/e2e/regression/paths'
import type * as redaction from '../../../scripts/e2e/regression/redaction'
import { secretValues } from './environment'
import { checkAgent } from './preflight'

const require = createRequire(import.meta.url)
const { launchApp, stopOwnedApp, readAppRecord } =
  require('../../../scripts/e2e/regression/lifecycle.ts') as typeof lifecycle
const { ensureRunDirectories, getRunPaths } = require('../../../scripts/e2e/regression/paths.ts') as typeof paths
const { createRedactor } = require('../../../scripts/e2e/regression/redaction.ts') as typeof redaction
const redact = createRedactor(secretValues)
const project = import.meta.dirname
const repository = resolve(project, '../../..')
const cases = ['startup', 'settings', 'notes', 'chat', 'chatRecovery'] as const
const { values } = parseArgs({
  options: {
    case: { type: 'string' },
    'no-cache': { type: 'boolean' },
    'run-dir': { type: 'string' },
    'evidence-dir': { type: 'string' },
    'inject-failure': { type: 'boolean' }
  }
})
if (values.case && !cases.includes(values.case as (typeof cases)[number]))
  throw new Error(`Unknown case: ${values.case}`)
if (values['inject-failure'] && values.case !== 'chat') throw new Error('--inject-failure requires --case chat')
const selectedCases = cases.filter((name) => !values.case || name === values.case)
const runDirectory = values['run-dir'] ? resolve(values['run-dir']) : mkdtempSync(join(tmpdir(), 'cherry-agentic-'))
if (existsSync(runDirectory) && readdirSync(runDirectory).length > 0)
  throw new Error('Run directory must be empty; previous evidence is never overwritten')
mkdirSync(runDirectory, { recursive: true })
const evidenceDirectory = values['evidence-dir']
  ? resolve(values['evidence-dir'])
  : join(
      repository,
      '.context/agentic-e2e',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    )
if (existsSync(evidenceDirectory) && readdirSync(evidenceDirectory).length > 0)
  throw new Error('Evidence directory must be empty; previous evidence is never overwritten')
mkdirSync(evidenceDirectory, { recursive: true })
const trackingFile = join(repository, '.context/cherry-electron-dev/instance.json')
const previousTracking = existsSync(trackingFile) ? readFileSync(trackingFile, 'utf8') : undefined
const metadata = {
  sha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim().length > 0,
  platform: process.platform,
  arch: process.arch,
  osRelease: release(),
  runner: process.env.RUNNER_NAME,
  startedAt: new Date().toISOString(),
  runDirectory,
  versions: {
    e2e: '0.21.1',
    web: '0.15.1',
    node: process.version,
    electron: JSON.parse(readFileSync(join(repository, 'node_modules/electron/package.json'), 'utf8')).version as string
  },
  preflight: undefined as { modelCalls: number; modelTokens: number } | undefined,
  cache: values['no-cache'] ? 'off' : 'read-write'
}
const results: Array<{
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
  error?: string
}> = []
let activePaths: ReturnType<typeof getRunPaths> | undefined
let child: ReturnType<typeof spawn> | undefined
let interrupted = false
let runError: string | undefined
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    interrupted = true
    child?.kill(signal)
  })
}

async function freePort() {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())))
  return port
}

async function command(command: string, args: string[], env: NodeJS.ProcessEnv, log: string, cwd = project) {
  return new Promise<number>((done, reject) => {
    child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout!, child.stderr!])
      stream.on('data', (chunk: Buffer) => {
        const text = redact(chunk.toString())
        output += text
        process.stdout.write(text)
      })
    child.once('error', reject)
    child.once('exit', (code) => {
      writeFileSync(log, redact(output))
      child = undefined
      done(code ?? 130)
    })
  })
}

async function trackAndPrepare(paths: ReturnType<typeof getRunPaths>, startup: boolean, phase: string) {
  const record = readAppRecord(paths)
  const cwd = execFileSync('lsof', ['-a', '-p', String(record.electronPid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  if (!cwd.includes(`n${repository}\n`)) throw new Error('Electron cwd does not match this checkout')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${record.cdpPort}`)
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((page) => page.url() === record.targetUrl)
    if (!page) throw new Error('The recorded native main-window target is missing')
    await page.waitForFunction(() => Boolean(window.api?.preference), undefined, { timeout: 60_000 })
    await page.locator('#root > *').first().waitFor({ state: 'visible', timeout: 60_000 })
    const session = await page.context().newCDPSession(page)
    const identity = (await session.send('Target.getTargetInfo')).targetInfo
    await session.detach()
    writeFileSync(
      join(paths.root, `identity-${phase}.json`),
      JSON.stringify({ ...record, targetId: identity.targetId }, null, 2)
    )
    mkdirSync(dirname(trackingFile), { recursive: true })
    writeFileSync(
      trackingFile,
      JSON.stringify(
        {
          ...record,
          workspace: repository,
          head: metadata.sha,
          policy: 'ephemeral',
          ownership: 'agent',
          launch_purpose: 'agentic-e2e',
          workflow_relation: 'started'
        },
        null,
        2
      )
    )
    if (phase === 'write') {
      await page.evaluate(async (startup) => {
        await window.api.preference.setMultiple({
          'app.language': 'en-US',
          'app.privacy.data_collection.enabled': false,
          'feature.quick_assistant.enabled': false,
          'feature.selection.enabled': false,
          'topic.naming.enabled': false,
          ...(!startup ? { 'app.onboarding.provider_setup.status': 'skipped' } : {})
        })
      }, startup)
    }
  } finally {
    await browser.close()
  }
}

function saveSummary(error?: string) {
  const status = interrupted
    ? 'interrupted'
    : (error ?? runError) || results.some((result) => result.status === 'blocked')
      ? 'blocked'
      : results.some((result) => result.status === 'failed')
        ? 'failed'
        : results.length === selectedCases.length && results.every((result) => result.status === 'passed')
          ? 'passed'
          : 'running'
  const report = redact({
    status,
    metadata,
    results,
    error: error ?? runError,
    interrupted,
    finishedAt: new Date().toISOString()
  })
  writeFileSync(join(runDirectory, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(
    join(runDirectory, 'summary.md'),
    [
      '# Cherry Studio agentic E2E',
      '',
      `Commit: ${metadata.sha} (local changes: ${metadata.dirty})`,
      `Run data: ${runDirectory}`,
      `Cache: ${metadata.cache}`,
      `Result: ${status}`,
      `API preflight: ${metadata.preflight?.modelCalls ?? 0} model calls, ${metadata.preflight?.modelTokens ?? 0} tokens`,
      '',
      '| Case | Result | Model calls | Tokens | Replayed steps |',
      '| --- | --- | --- | --- | --- |',
      ...results.map(
        (result) =>
          `| ${result.case} | ${result.status}${result.error ? `: ${redact(result.error).replace(/\n/g, ' ')}` : ''} | ${result.phases.reduce((n, p) => n + (p.modelCalls ?? 0), 0)} | ${result.phases.reduce((n, p) => n + (p.modelTokens ?? 0), 0)} | ${result.phases.reduce((n, p) => n + (p.replayed ?? 0), 0)} |`
      ),
      ...((error ?? runError) ? ['', `Run blocked: ${redact(error ?? runError!)}`] : []),
      ''
    ].join('\n')
  )
  cpSync(join(runDirectory, 'report.json'), join(evidenceDirectory, 'report.json'))
  cpSync(join(runDirectory, 'summary.md'), join(evidenceDirectory, 'summary.md'))
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('This pilot supports local macOS only')
  metadata.preflight = await checkAgent()
  for (const args of [['rebuild:electron'], ['download:binaries'], ['run', 'build:utility-process']]) {
    if (interrupted) throw new Error('Run interrupted')
    if (await command('pnpm', args, process.env, join(runDirectory, `${args.at(-1)}.log`), repository))
      throw new Error(`Preparation failed: pnpm ${args.join(' ')}`)
  }
  for (const file of ['rg', '.rg-version']) {
    if (!existsSync(join(repository, 'resources/binaries', `${process.platform}-${process.arch}`, file)))
      throw new Error(`Required bundled ripgrep file is missing: ${file}`)
  }
  for (const name of selectedCases) {
    if (interrupted) break
    const result: (typeof results)[number] = { case: name, status: 'running', phases: [] }
    results.push(result)
    const paths = getRunPaths(join(runDirectory, name))
    ensureRunDirectories(paths)
    activePaths = paths
    const caseData = join(paths.root, 'case.json')
    writeFileSync(caseData, JSON.stringify({ marker: randomUUID().replaceAll('-', '').slice(0, 16) }))
    const cdpPort = await freePort()
    const inspectorPort = await freePort()
    const phases = ['settings', 'notes', 'chatRecovery'].includes(name) ? ['write', 'read'] : ['write']
    try {
      for (const phase of phases) {
        if (interrupted) throw new Error('Run interrupted')
        await launchApp(paths, {
          mode: 'branch',
          platform: 'macos',
          profile: 'clean',
          targetRoot: repository,
          runKey: `${name}-${cdpPort}`,
          cdpPort,
          inspectorPort,
          restartCount: phase === 'read' ? 1 : 0
        })
        if (interrupted) throw new Error('Run interrupted')
        await trackAndPrepare(paths, name === 'startup', phase)
        const args = [
          join(project, 'node_modules/e2e/dist/cli/bin.js'),
          'run',
          ...(values['no-cache'] ? ['--no-cache'] : [])
        ]
        rmSync(join(project, '.e2e/current'), { recursive: true, force: true })
        const exitCode = await command(
          process.execPath,
          args,
          {
            ...process.env,
            AGENTIC_APP_RECORD: paths.appRecord,
            AGENTIC_TARGET_ID: JSON.parse(readFileSync(join(paths.root, `identity-${phase}.json`), 'utf8')).targetId,
            AGENTIC_CASE_DATA: caseData,
            AGENTIC_TEST_FILE: `${name}.test.ts`,
            AGENTIC_STAGE: phase,
            AGENTIC_INJECT_FAILURE: values['inject-failure'] ? '1' : '0',
            E2E_TELEMETRY_DISABLED: '1'
          },
          join(paths.output, `${phase}.log`)
        )
        const destination = join(paths.output, phase)
        if (existsSync(join(project, '.e2e/current')))
          cpSync(join(project, '.e2e/current'), destination, { recursive: true })
        const reportPath = join(destination, 'report.json')
        const report: Report | undefined = existsSync(reportPath)
          ? JSON.parse(readFileSync(reportPath, 'utf8'))
          : undefined
        const steps = report?.run.results.flatMap((result) => result.attempts.flatMap((attempt) => attempt.steps)) ?? []
        result.phases.push({
          phase,
          exitCode,
          report: report ? join(name, phase, 'report.json') : undefined,
          modelCalls: steps.reduce((n, step) => n + (step.metrics?.modelCalls ?? 0), 0),
          modelTokens: report?.run.usage.modelTokens,
          replayed: steps.filter((step) => step.cache?.mode === 'self-finalized').length,
          durationMs: report?.run.results.reduce(
            (n, result) => n + result.attempts.reduce((n, attempt) => n + attempt.durationMs, 0),
            0
          )
        })
        await stopOwnedApp(paths)
        if (exitCode !== 0) throw new Error(`Phase ${phase} exited ${exitCode}; inspect ${reportPath}`)
        if (!existsSync(reportPath)) throw new Error(`Missing framework report: ${reportPath}`)
        if (!report || report.run.results.length !== 1 || report.run.results[0].status !== 'passed')
          throw new Error('Expected exactly one passed framework test')
      }
      result.status = 'passed'
    } catch (error) {
      result.status = result.phases.length > 0 && result.phases.at(-1)!.exitCode === 1 ? 'failed' : 'blocked'
      result.error = error instanceof Error ? error.message : String(error)
    } finally {
      try {
        await stopOwnedApp(paths)
      } catch (error) {
        result.status = 'blocked'
        result.error = `Cleanup failed: ${String(error)}`
      }
      activePaths = undefined
      cpSync(paths.output, join(evidenceDirectory, name), { recursive: true })
      for (const file of readdirSync(paths.root).filter((file) => /^(identity-.*|case|fixture)\.json$/.test(file)))
        writeFileSync(join(evidenceDirectory, name, file), redact(readFileSync(join(paths.root, file), 'utf8')))
      for (const file of readdirSync(paths.logs))
        writeFileSync(join(evidenceDirectory, `${name}-${file}`), redact(readFileSync(join(paths.logs, file), 'utf8')))
      saveSummary()
    }
  }
  if (interrupted || results.some((result) => result.status !== 'passed')) process.exitCode = interrupted ? 130 : 1
}

try {
  await main()
} catch (error) {
  process.exitCode = 1
  const message = redact(error instanceof Error ? error.message : String(error))
  runError = message
  process.stderr.write(`${message}\n`)
  saveSummary(message)
} finally {
  if (activePaths) await stopOwnedApp(activePaths)
  if (existsSync(trackingFile)) {
    const tracked = JSON.parse(readFileSync(trackingFile, 'utf8'))
    if (tracked.logPath?.startsWith(runDirectory + '/')) {
      if (previousTracking === undefined) rmSync(trackingFile)
      else writeFileSync(trackingFile, previousTracking)
    }
  }
  saveSummary()
  process.stdout.write(`\nReport: ${join(evidenceDirectory, 'summary.md')}\n`)
}

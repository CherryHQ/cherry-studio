import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { assertAgentPreflightOutput, assertAgentSuiteOutput } from './agent'
import { normalizeRunnerArch, selectReleaseAsset, sha256File } from './artifacts'
import { probeCapabilities } from './capabilities'
import { SUITE_IDS } from './cases'
import { getSensitiveConfigValues, loadTestConfig, REQUIRED_CONFIG } from './config'
import { createFixtures } from './fixtures'
import { installReleaseArtifact, launchApp, stopOwnedApp } from './lifecycle'
import { ensureRunDirectories, getRunPaths, isPathInside } from './paths'
import { createRedactor } from './redaction'
import { parseRemoteRefs, resolveTrustedRef } from './ref'
import { aggregateRuns, renderAggregateMarkdown, writeReports } from './report'
import { createRun, finalizeRun, getRunVerdict, readRun, setCapabilities, updateRunMetadata, writeRun } from './state'
import { PLATFORMS, type RegressionRun, RUN_MODES } from './types'

const AGENT_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'mcp__cherry-regression__get-run-context',
  'mcp__cherry-regression__begin-case',
  'mcp__cherry-regression__inspect-ui',
  'mcp__cherry-regression__interact',
  'mcp__cherry-regression__system-action',
  'mcp__cherry-regression__restart-app',
  'mcp__cherry-regression__record-evidence',
  'mcp__cherry-regression__complete-case'
] as const

const AGENT_DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent'] as const

function argument(name: string, required = true): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (required && (!value || value.startsWith('--'))) throw new Error(`--${name} is required`)
  return value
}

function oneOf<T extends string>(value: string, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new Error(`${label} must be one of: ${choices.join(', ')}`)
  return value as T
}

function outputLine(name: string, value: string): void {
  const output = process.env.GITHUB_OUTPUT
  if (output) appendFileSync(output, `${name}=${value}\n`)
  else process.stdout.write(`${name}=${value}\n`)
}

function runDirectory() {
  const value = argument('run-dir') ?? ''
  const paths = getRunPaths(value)
  ensureRunDirectories(paths)
  return paths
}

function sanitizeRunKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80)
}

function findFiles(root: string, fileName: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(root, entry.name)
    if (entry.isDirectory()) return findFiles(filePath, fileName)
    return entry.name === fileName ? [filePath] : []
  })
}

function redactLogs(paths: ReturnType<typeof getRunPaths>): void {
  const values = REQUIRED_CONFIG.map((name) => process.env[name]).filter((value): value is string => Boolean(value))
  const redact = createRedactor(values)
  const outputDirectory = join(paths.output, 'logs')
  mkdirSync(outputDirectory, { recursive: true })
  if (!existsSync(paths.logs)) return
  for (const entry of readdirSync(paths.logs, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const source = join(paths.logs, entry.name)
    const content = readFileSync(source, 'utf8')
    writeFileSync(join(outputDirectory, entry.name), redact(content), { mode: 0o600 })
  }
}

async function resolveRefCommand(): Promise<void> {
  const requested = argument('requested') ?? ''
  const repository = argument('repository') ?? ''
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository slug')
  const remote = `https://github.com/${repository}.git`
  const output = execFileSync('git', ['ls-remote', '--heads', '--tags', remote], {
    encoding: 'utf8',
    timeout: 60_000
  })
  const resolvedRef = resolveTrustedRef(requested, parseRemoteRefs(output))
  outputLine('mode', resolvedRef.kind)
  outputLine('name', resolvedRef.name)
  outputLine('ref', resolvedRef.ref)
  outputLine('sha', resolvedRef.sha)
}

async function initializeCommand(): Promise<void> {
  const paths = runDirectory()
  const mode = oneOf(argument('mode') ?? '', RUN_MODES, 'mode')
  const platform = oneOf(argument('platform') ?? '', PLATFORMS, 'platform')
  const ref = argument('ref') ?? ''
  const sha = argument('sha') ?? ''
  const runner = argument('runner') ?? ''
  const appVersion = mode === 'tag' ? ref.replace(/^v/, '') : `development-${sha.slice(0, 7)}`
  let run = createRun({ appVersion, commitSha: sha, mode, platform, ref, runner })
  await createFixtures(paths)
  run = setCapabilities(run, probeCapabilities(platform, paths))
  writeRun(paths.runState, run)
}

async function preflightCommand(): Promise<void> {
  const config = loadTestConfig()
  const redacted = createRedactor(getSensitiveConfigValues(config))
  process.stdout.write(`${JSON.stringify(redacted({ configured: REQUIRED_CONFIG }), null, 2)}\n`)
}

async function agentSettingsCommand(): Promise<void> {
  const paths = runDirectory()
  const suite = oneOf(argument('suite') ?? '', SUITE_IDS, 'suite')
  const config = loadTestConfig()
  const output = resolve(argument('output') ?? '')
  if (!isPathInside(paths.root, output)) throw new Error('Agent settings must stay inside the run directory')
  const environment = Object.fromEntries(REQUIRED_CONFIG.map((name) => [name, process.env[name]]))
  writeFileSync(
    output,
    `${JSON.stringify({ env: { ...environment, CHERRY_TEST_RUN_DIR: paths.root, CHERRY_TEST_SUITE: suite } }, null, 2)}\n`,
    { mode: 0o600 }
  )
  const redacted = createRedactor(getSensitiveConfigValues(config))
  process.stdout.write(`${JSON.stringify(redacted({ output, suite }))}\n`)
}

async function agentPreflightCommand(): Promise<void> {
  const paths = runDirectory()
  const claudePath = resolve(argument('claude-path') ?? '')
  const config = loadTestConfig()
  const marker = 'CHERRY_TEST_AGENT_READY'
  const environment = { ...process.env }
  for (const name of REQUIRED_CONFIG) delete environment[name]
  environment.ANTHROPIC_BASE_URL = config.customProvider.baseUrl
  environment.ANTHROPIC_API_KEY = config.customProvider.apiKey
  const result = spawnSync(
    claudePath,
    [
      '--print',
      '--bare',
      '--model',
      config.customProvider.chatModel,
      '--max-turns',
      '1',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--tools',
      '',
      '--system-prompt',
      'Respond with only the requested marker.',
      `Reply exactly ${marker}.`
    ],
    { cwd: process.cwd(), encoding: 'utf8', env: environment, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }
  )
  const redact = createRedactor(getSensitiveConfigValues(config))
  writeFileSync(
    join(paths.logs, 'agent-preflight.json'),
    `${JSON.stringify(
      redact({
        error: result.error?.message,
        signal: result.signal,
        status: result.status,
        stderr: result.stderr,
        stdout: result.stdout
      }),
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
  if (result.error || result.status !== 0) {
    throw new Error('Test agent preflight failed; inspect the redacted platform evidence')
  }
  assertAgentPreflightOutput(result.stdout, marker)
  process.stdout.write('Test agent preflight passed\n')
}

async function runAgentSuiteCommand(): Promise<void> {
  const paths = runDirectory()
  const suite = oneOf(argument('suite') ?? '', SUITE_IDS, 'suite')
  const claudePath = resolve(argument('claude-path') ?? '')
  const settingsPath = join(paths.root, `claude-settings-${suite}.json`)
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { env?: Record<string, string | undefined> }
  if (!settings.env) throw new Error(`Agent settings are missing environment values for ${suite}`)

  const config = loadTestConfig(settings.env)
  const skillInstructions = readFileSync(resolve('.agents/skills/cherry-regression-test/SKILL.md'), 'utf8')
  const environment = {
    ...process.env,
    ...settings.env,
    ANTHROPIC_BASE_URL: config.customProvider.baseUrl,
    ANTHROPIC_API_KEY: config.customProvider.apiKey
  }
  const mcpConfig = JSON.stringify({
    mcpServers: {
      'cherry-regression': {
        command: 'node',
        args: ['node_modules/tsx/dist/cli.mjs', 'scripts/cherry-regression-test/server.ts']
      }
    }
  })
  const startupOnly = suite === 'suite-1'
  const result = spawnSync(
    claudePath,
    [
      '--print',
      '--bare',
      '--model',
      config.customProvider.chatModel,
      '--max-turns',
      startupOnly ? '12' : '180',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--settings',
      settingsPath,
      '--append-system-prompt',
      skillInstructions,
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--allowedTools',
      AGENT_ALLOWED_TOOLS.join(','),
      '--disallowedTools',
      AGENT_DISALLOWED_TOOLS.join(','),
      '--permission-mode',
      'dontAsk',
      `Run suite ${suite}. Use only the CI MCP workflow for application control and evidence. Finish every applicable case with its actual status.`
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: environment,
      maxBuffer: 100 * 1024 * 1024,
      timeout: (startupOnly ? 8 : 45) * 60_000
    }
  )
  const redact = createRedactor(getSensitiveConfigValues(config))
  writeFileSync(
    join(paths.logs, `agent-${suite}.json`),
    `${JSON.stringify(
      redact({
        error: result.error?.message,
        signal: result.signal,
        status: result.status,
        stderr: result.stderr,
        stdout: result.stdout
      }),
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
  if (result.error || result.status !== 0) {
    throw new Error(`Test agent failed for ${suite}; inspect the redacted platform evidence`)
  }
  assertAgentSuiteOutput(result.stdout)
  process.stdout.write(`Test agent completed ${suite}\n`)
}

async function releaseCommand(): Promise<void> {
  const paths = runDirectory()
  let run = readRun(paths.runState)
  if (run.metadata.mode !== 'tag') throw new Error('Release preparation is only valid for a tag run')
  const repository = argument('repository') ?? ''
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository slug')
  const arch = normalizeRunnerArch(argument('arch') ?? '')
  const releaseJson = execFileSync(
    'gh',
    ['api', `repos/${repository}/releases/tags/${encodeURIComponent(run.metadata.ref)}`],
    { encoding: 'utf8', timeout: 60_000 }
  )
  const release = JSON.parse(releaseJson) as { assets: Array<{ name: string }> }
  const artifactName = selectReleaseAsset(
    release.assets.map(({ name }) => name),
    run.metadata.platform,
    arch
  )
  execFileSync(
    'gh',
    [
      'release',
      'download',
      run.metadata.ref,
      '--repo',
      repository,
      '--pattern',
      artifactName,
      '--dir',
      paths.artifacts,
      '--clobber'
    ],
    { stdio: 'inherit', timeout: 300_000 }
  )
  const artifactPath = join(paths.artifacts, artifactName)
  const artifactSha256 = await sha256File(artifactPath)
  installReleaseArtifact(paths, run.metadata.platform, artifactPath, artifactSha256)
  run = updateRunMetadata(run, { artifactName, artifactSha256 })
  writeRun(paths.runState, run)
}

async function launchCommand(): Promise<void> {
  const paths = runDirectory()
  const run = readRun(paths.runState)
  const profile = run.metadata.mode === 'tag' ? 'clean' : 'authenticated'
  const targetRoot = argument('target-root') ?? ''
  const runKey = sanitizeRunKey(
    argument('run-key', false) ??
      `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${run.metadata.platform}`
  )
  await launchApp(paths, {
    mode: run.metadata.mode,
    platform: run.metadata.platform,
    profile,
    runKey,
    targetRoot
  })
}

async function finalizeCommand(): Promise<void> {
  const paths = runDirectory()
  const run = finalizeRun(readRun(paths.runState))
  writeRun(paths.runState, run)
  redactLogs(paths)
  writeReports(run, paths.output)
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${readFileSync(join(paths.output, 'report.md'), 'utf8')}\n`)
}

async function gateCommand(): Promise<void> {
  const paths = runDirectory()
  const verdict = getRunVerdict(readRun(paths.runState))
  process.stdout.write(`Cherry regression verdict: ${verdict}\n`)
  if (!verdict.endsWith('_pass')) process.exitCode = 1
}

async function aggregateCommand(): Promise<void> {
  const input = resolve(argument('input') ?? '')
  const output = resolve(argument('output') ?? '')
  const modeValue = argument('mode', false)
  const expectedMode = modeValue ? oneOf(modeValue, RUN_MODES, 'mode') : undefined
  const resultFiles = findFiles(input, 'results.json')
  const runs = resultFiles.map((filePath) => JSON.parse(readFileSync(filePath, 'utf8')) as RegressionRun)
  const report = aggregateRuns(runs, expectedMode)
  mkdirSync(output, { recursive: true })
  const markdown = renderAggregateMarkdown(report)
  writeFileSync(join(output, 'combined-results.json'), `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(join(output, 'combined-report.md'), markdown)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  process.stdout.write(`Combined Cherry regression verdict: ${report.verdict}\n`)
}

async function aggregateGateCommand(): Promise<void> {
  const reportPath = resolve(argument('report') ?? '')
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as { verdict: string }
  if (!report.verdict.endsWith('_pass')) {
    process.stderr.write(`Combined Cherry regression verdict is ${report.verdict}\n`)
    process.exitCode = 1
  }
}

async function cleanupCommand(): Promise<void> {
  const paths = runDirectory()
  try {
    await stopOwnedApp(paths)
  } finally {
    for (const entry of readdirSync(paths.root, { withFileTypes: true })) {
      if (entry.isFile() && /^claude-settings-suite-[1-6]\.json$/.test(entry.name)) {
        rmSync(join(paths.root, entry.name))
      }
    }
  }
}

async function main(): Promise<void> {
  const command = process.argv[2]
  switch (command) {
    case 'resolve-ref':
      await resolveRefCommand()
      break
    case 'initialize':
      await initializeCommand()
      break
    case 'preflight':
      await preflightCommand()
      break
    case 'agent-settings':
      await agentSettingsCommand()
      break
    case 'agent-preflight':
      await agentPreflightCommand()
      break
    case 'run-agent-suite':
      await runAgentSuiteCommand()
      break
    case 'release':
      await releaseCommand()
      break
    case 'launch':
      await launchCommand()
      break
    case 'finalize':
      await finalizeCommand()
      break
    case 'gate':
      await gateCommand()
      break
    case 'aggregate':
      await aggregateCommand()
      break
    case 'aggregate-gate':
      await aggregateGateCommand()
      break
    case 'cleanup':
      await cleanupCommand()
      break
    default:
      throw new Error(`Unknown Cherry regression command: ${command ?? '(missing)'}`)
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exitCode = 1
})

import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { assertAgentPreflightOutput, assertAgentTaskOutput, describeAgentFailure } from './agent'
import { normalizeRunnerArch, selectReleaseAsset, sha256File } from './artifacts'
import { probeCapabilities } from './capabilities'
import { getSensitiveConfigValues, loadTestConfig, REQUIRED_CONFIG } from './config'
import { createFixtures } from './fixtures'
import { installReleaseArtifact, launchApp, stopOwnedApp } from './lifecycle'
import { ensureRunDirectories, getRunPaths } from './paths'
import { createRedactor } from './redaction'
import { parseRemoteRefs, resolveTrustedRef } from './ref'
import { aggregateRuns, renderAggregateMarkdown, renderTaskMarkdown, writeReports } from './report'
import {
  blockIncompleteTaskCases,
  createRun,
  finalizeRun,
  getRunVerdict,
  getTaskCaseResults,
  readRun,
  setCapabilities,
  updateRunMetadata,
  writeRun
} from './state'
import { PLATFORMS, type RegressionRun, RUN_MODES, TASK_IDS, TASK_SELECTIONS, type TaskId } from './types'

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

const HEAVY_AGENT_TASKS = new Set<TaskId>([
  'agent-ppt',
  'claude-agent-runtime',
  'pi-runtime',
  'deepseek-harness-runtime',
  'image-generation',
  'translation',
  'code-cli',
  'openclaw'
])

function agentTaskLimits(task: TaskId): { maxTurns: number; timeoutMinutes: number } {
  if (task === 'startup-smoke') return { maxTurns: 16, timeoutMinutes: 8 }
  if (HEAVY_AGENT_TASKS.has(task)) return { maxTurns: 70, timeoutMinutes: 18 }
  return { maxTurns: 50, timeoutMinutes: 13 }
}

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
  const task = oneOf(argument('task', false) ?? 'all', TASK_SELECTIONS, 'task')
  const ref = argument('ref') ?? ''
  const sha = argument('sha') ?? ''
  const runner = argument('runner') ?? ''
  const appVersion = mode === 'tag' ? ref.replace(/^v/, '') : `development-${sha.slice(0, 7)}`
  let run = createRun({ appVersion, commitSha: sha, mode, platform, ref, runner, task })
  await createFixtures(paths)
  run = setCapabilities(run, probeCapabilities(platform, paths))
  writeRun(paths.runState, run)
}

async function preflightCommand(): Promise<void> {
  const config = loadTestConfig()
  const redacted = createRedactor(getSensitiveConfigValues(config))
  process.stdout.write(`${JSON.stringify(redacted({ configured: REQUIRED_CONFIG }), null, 2)}\n`)
}

async function prepareAgentSettingsCommand(): Promise<void> {
  const paths = runDirectory()
  const run = readRun(paths.runState)
  const config = loadTestConfig()
  const environment = Object.fromEntries(REQUIRED_CONFIG.map((name) => [name, process.env[name]]))
  const tasks: TaskId[] = run.metadata.task === 'all' ? [...TASK_IDS] : [run.metadata.task]
  const outputs = tasks.map((task) => {
    const output = join(paths.root, `claude-settings-${task}.json`)
    writeFileSync(
      output,
      `${JSON.stringify({ env: { ...environment, CHERRY_TEST_RUN_DIR: paths.root, CHERRY_TEST_TASK: task } }, null, 2)}\n`,
      { mode: 0o600 }
    )
    return output
  })
  const redacted = createRedactor(getSensitiveConfigValues(config))
  process.stdout.write(`${JSON.stringify(redacted({ outputs, tasks }))}\n`)
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

async function runAgentTaskCommand(): Promise<void> {
  const paths = runDirectory()
  const task = oneOf(argument('task') ?? '', TASK_IDS, 'task')
  const claudePath = resolve(argument('claude-path') ?? '')
  const settingsPath = join(paths.root, `claude-settings-${task}.json`)
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as { env?: Record<string, string | undefined> }
  if (!settings.env) throw new Error(`Agent settings are missing environment values for ${task}`)

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
  const limits = agentTaskLimits(task)
  process.stdout.write(
    `Starting regression task ${task} (max turns: ${limits.maxTurns}, timeout: ${limits.timeoutMinutes} minutes)\n`
  )
  const result = spawnSync(
    claudePath,
    [
      '--print',
      '--bare',
      '--model',
      config.customProvider.chatModel,
      '--max-turns',
      String(limits.maxTurns),
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
      [
        `Run task ${task} with at most ${limits.maxTurns} turns.`,
        'Use only the CI MCP workflow for application control and evidence.',
        'Do not repeat an equivalent failed inspection or interaction more than once.',
        'Reserve the final two tool calls for complete-case and get-run-context.',
        'Once every applicable case is terminal, respond immediately without another tool call.'
      ].join(' ')
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: environment,
      maxBuffer: 100 * 1024 * 1024,
      timeout: limits.timeoutMinutes * 60_000
    }
  )
  const redact = createRedactor(getSensitiveConfigValues(config))
  writeFileSync(
    join(paths.logs, `agent-${task}.json`),
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

  let agentFailure = describeAgentFailure(result, limits)
  if (!agentFailure) {
    try {
      assertAgentTaskOutput(result.stdout)
    } catch (error) {
      agentFailure = error instanceof Error ? error.message : String(error)
    }
  }

  let run = readRun(paths.runState)
  const incompleteCases = getTaskCaseResults(run, task).filter(({ status }) => ['pending', 'running'].includes(status))
  if (incompleteCases.length > 0) {
    const reason = agentFailure ?? 'returned without completing every applicable case'
    run = blockIncompleteTaskCases(run, task, `Test agent ${reason}`)
    writeRun(paths.runState, run)
  }

  const results = getTaskCaseResults(run, task).filter(({ status }) => status !== 'not_applicable')
  const taskMarkdown = redact(renderTaskMarkdown(run, task, agentFailure ?? 'completed'))
  process.stdout.write(`${taskMarkdown}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${taskMarkdown}\n`)

  const nonPassing = results.filter(({ status }) => status !== 'passed')
  if (nonPassing.length > 0) {
    const statuses = nonPassing.map(({ id, status }) => `${id}=${status}`).join(', ')
    throw new Error(`Regression task ${task} did not pass: ${statuses}`)
  }
  if (agentFailure) {
    process.stderr.write(`Test agent ${agentFailure} after all ${task} cases were completed; accepting case results\n`)
  } else {
    process.stdout.write(`Test agent completed ${task}\n`)
  }
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
  const targetRoot = argument('target-root') ?? ''
  const runKey = sanitizeRunKey(
    argument('run-key', false) ??
      `${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-${run.metadata.platform}`
  )
  await launchApp(paths, {
    mode: run.metadata.mode,
    platform: run.metadata.platform,
    profile: 'clean',
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
  const settingsFiles = new Set(TASK_IDS.map((task) => `claude-settings-${task}.json`))
  try {
    await stopOwnedApp(paths)
  } finally {
    for (const entry of readdirSync(paths.root, { withFileTypes: true })) {
      if (entry.isFile() && settingsFiles.has(entry.name)) {
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
    case 'prepare-agent-settings':
      await prepareAgentSettingsCommand()
      break
    case 'agent-preflight':
      await agentPreflightCommand()
      break
    case 'run-agent-task':
      await runAgentTaskCommand()
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

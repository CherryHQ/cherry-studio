import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REGRESSION_CASES, type TaskSelection } from './cases'
import { getRunVerdict } from './state'
import {
  type AggregateReport,
  type CaseStatus,
  type Platform,
  PLATFORMS,
  type RegressionRun,
  type RunMode,
  type RunVerdict
} from './types'

const STATUS_LABELS: Record<CaseStatus, string> = {
  pending: '⏳ Pending',
  running: '🔄 Running',
  passed: '✅ Passed',
  failed: '❌ Failed',
  blocked: '⛔ Blocked',
  not_applicable: '— Not applicable'
}

const VERDICT_LABELS: Record<RunVerdict, string> = {
  development_pass: '✅ Development tests passed',
  development_failed: '❌ Development tests failed',
  development_blocked: '⛔ Development tests blocked',
  release_pass: '✅ Release acceptance passed',
  release_failed: '❌ Release acceptance failed',
  release_blocked: '⛔ Release acceptance blocked'
}

const PLATFORM_LABELS: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows'
}

const MODE_LABELS: Record<RunMode, string> = {
  branch: 'Development branch',
  tag: 'Release'
}

const CAPABILITY_LABELS: Record<string, string> = {
  desktopAutomation: 'Desktop automation',
  externalSelection: 'Cross-app text selection',
  globalShortcut: 'Global shortcut',
  directCdp: 'Direct CDP connection',
  npx: 'npx',
  screenCapture: 'Screen capture',
  systemFilePicker: 'System file picker'
}

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function taskLabel(task: TaskSelection): string {
  if (task === 'all') return 'All tasks'
  const titles = REGRESSION_CASES.filter((testCase) => testCase.task === task).map(({ title }) => title)
  return titles.length > 0 ? titles.join(', ') : task
}

function selectedCases(run: RegressionRun) {
  return REGRESSION_CASES.filter(({ id }) => run.cases[id].status !== 'not_applicable')
}

function statusCount(run: RegressionRun, status: CaseStatus): number {
  return selectedCases(run).filter(({ id }) => run.cases[id].status === status).length
}

function capabilityLabel(name: string): string {
  return CAPABILITY_LABELS[name] ?? name
}

function formatDuration(startedAt: string, finishedAt?: string): string {
  if (!finishedAt) return 'Still running'
  const totalSeconds = Math.max(0, Math.floor((Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000))
  if (!Number.isFinite(totalSeconds)) return 'Unknown'
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

export function renderMarkdown(run: RegressionRun): string {
  const verdict = getRunVerdict(run)
  const testCases = selectedCases(run)
  const rows = testCases.map((testCase) => {
    const result = run.cases[testCase.id]
    return `| ${testCase.id} | ${escapeMarkdown(testCase.title)} | ${STATUS_LABELS[result.status]} | ${escapeMarkdown(result.summary || 'No result recorded')} | ${result.artifacts?.length ?? 0} |`
  })
  const blockingResults = testCases
    .filter(({ id }) => ['blocked', 'failed'].includes(run.cases[id].status))
    .flatMap((testCase) => {
      const result = run.cases[testCase.id]
      return [
        `### ${STATUS_LABELS[result.status]} · ${testCase.id} · ${escapeMarkdown(testCase.title)}`,
        '',
        `- **Summary:** ${escapeMarkdown(result.summary)}`,
        `- **Artifacts:** ${result.artifacts?.length ?? 0}`,
        ''
      ]
    })
  const metadataRows = [
    `| Platform | ${PLATFORM_LABELS[run.metadata.platform]} |`,
    `| GitHub runner | \`${escapeMarkdown(run.metadata.runner)}\` |`,
    `| Test reference | \`${escapeMarkdown(run.metadata.ref)}\` |`,
    `| Commit SHA | \`${escapeMarkdown(run.metadata.commitSha)}\` |`,
    `| App version | \`${escapeMarkdown(run.metadata.appVersion)}\` |`,
    `| Run mode | ${MODE_LABELS[run.metadata.mode]} |`,
    `| Task selection | ${escapeMarkdown(taskLabel(run.metadata.task))} |`,
    `| Started at (UTC) | \`${run.startedAt}\` |`,
    ...(run.finishedAt ? [`| Finished at (UTC) | \`${run.finishedAt}\` |`] : []),
    `| Duration | ${formatDuration(run.startedAt, run.finishedAt)} |`,
    ...(run.metadata.artifactName ? [`| Installer | \`${escapeMarkdown(run.metadata.artifactName)}\` |`] : []),
    ...(run.metadata.artifactSha256 ? [`| Installer SHA-256 | \`${run.metadata.artifactSha256}\` |`] : [])
  ]
  const capabilities = Object.entries(run.capabilities)
  const availableCapabilities = capabilities.filter(([, result]) => result.available).length

  return [
    '# Cherry Studio End-to-End Regression Report',
    '',
    `> **Overall verdict: ${VERDICT_LABELS[verdict]}**`,
    '',
    '## Run information',
    '',
    '| Item | Value |',
    '| --- | --- |',
    ...metadataRows,
    '',
    '## Results overview',
    '',
    '| Applicable cases | Passed | Failed | Blocked | Incomplete |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${testCases.length} | ${statusCount(run, 'passed')} | ${statusCount(run, 'failed')} | ${statusCount(run, 'blocked')} | ${statusCount(run, 'pending') + statusCount(run, 'running')} |`,
    '',
    '## Phase execution',
    '',
    '| Phase | Status | Executor errors |',
    '| --- | --- | --- |',
    ...Object.entries(run.phases).map(
      ([id, phase]) => `| ${id} | ${STATUS_LABELS[phase.status]} | ${escapeMarkdown(phase.errors.join('; '))} |`
    ),
    '',
    '## Case details',
    '',
    '| ID | Test case | Result | Summary | Artifacts |',
    '| --- | --- | --- | --- | ---: |',
    ...rows,
    '',
    '## Failures and blockers',
    '',
    ...(blockingResults.length > 0 ? blockingResults : ['No failed or blocked cases.', '']),
    '<details>',
    `<summary>Capability checks (${availableCapabilities} / ${capabilities.length} available)</summary>`,
    '',
    '| Capability | Result | Details |',
    '| --- | --- | --- |',
    ...capabilities.map(
      ([name, result]) =>
        `| ${capabilityLabel(name)} | ${result.available ? '✅ Available' : '❌ Unavailable'} | ${escapeMarkdown(result.detail)} |`
    ),
    '',
    '</details>',
    ''
  ].join('\n')
}

export function renderJUnit(run: RegressionRun): string {
  const results = REGRESSION_CASES.map((testCase) => ({ testCase, result: run.cases[testCase.id] }))
  const phaseIssues = Object.entries(run.phases)
    .filter(([, phase]) => phase.status !== 'passed' || phase.errors.length > 0)
    .map(([id, phase]) => ({
      id,
      message: phase.errors.join('; ') || 'Phase did not complete successfully',
      failed: phase.status === 'failed' || (phase.errors.length > 0 && phase.status !== 'blocked')
    }))
  const failedPhases = phaseIssues.filter(({ failed }) => failed).length
  const failures = failedPhases + results.filter(({ result }) => result.status === 'failed').length
  const skipped =
    phaseIssues.length -
    failedPhases +
    results.filter(({ result }) => ['blocked', 'not_applicable', 'pending', 'running'].includes(result.status)).length
  const cases = results.map(({ testCase, result }) => {
    const name = `${testCase.id} ${testCase.title}`
    if (result.status === 'failed') {
      return `    <testcase classname="cherry-regression.${run.metadata.platform}" name="${escapeXml(name)}"><failure message="${escapeXml(result.summary)}" /></testcase>`
    }
    if (result.status !== 'passed') {
      return `    <testcase classname="cherry-regression.${run.metadata.platform}" name="${escapeXml(name)}"><skipped message="${escapeXml(result.summary)}" /></testcase>`
    }
    return `    <testcase classname="cherry-regression.${run.metadata.platform}" name="${escapeXml(name)}" />`
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${results.length + phaseIssues.length}" failures="${failures}" skipped="${skipped}">`,
    `  <testsuite name="cherry-regression-${run.metadata.platform}" tests="${results.length + phaseIssues.length}" failures="${failures}" skipped="${skipped}">`,
    ...cases,
    ...phaseIssues.map(
      ({ id, failed, message }) =>
        `    <testcase classname="cherry-regression.executor" name="${escapeXml(id)}"><${failed ? 'failure' : 'skipped'} message="${escapeXml(message)}" /></testcase>`
    ),
    '  </testsuite>',
    '</testsuites>',
    ''
  ].join('\n')
}

export function writeReports(run: RegressionRun, outputDirectory: string): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(join(outputDirectory, 'results.json'), `${JSON.stringify(run, null, 2)}\n`)
  writeFileSync(join(outputDirectory, 'report.md'), renderMarkdown(run))
  writeFileSync(join(outputDirectory, 'junit.xml'), renderJUnit(run))
}

function aggregateVerdict(runs: RegressionRun[], missingPlatforms: Platform[], expectedMode?: RunMode): RunVerdict {
  const mode = runs[0]?.metadata.mode ?? expectedMode ?? 'tag'
  const prefix = mode === 'tag' ? 'release' : 'development'
  const verdicts = runs.map(getRunVerdict)
  if (verdicts.some((verdict) => verdict.endsWith('_failed'))) return `${prefix}_failed`
  if (missingPlatforms.length > 0 || verdicts.some((verdict) => verdict.endsWith('_blocked'))) {
    return `${prefix}_blocked`
  }
  return `${prefix}_pass`
}

export function aggregateRuns(runs: RegressionRun[], expectedMode?: RunMode): AggregateReport {
  const presentPlatforms = new Set(runs.map(({ metadata }) => metadata.platform))
  const missingPlatforms = PLATFORMS.filter((platform) => !presentPlatforms.has(platform))
  return { runs, missingPlatforms, verdict: aggregateVerdict(runs, missingPlatforms, expectedMode) }
}

export function renderAggregateMarkdown(report: AggregateReport): string {
  const runs = [...report.runs].sort(
    (left, right) => PLATFORMS.indexOf(left.metadata.platform) - PLATFORMS.indexOf(right.metadata.platform)
  )
  const issues = runs.flatMap((run) => [
    ...Object.entries(run.phases)
      .filter(([, phase]) => phase.status !== 'passed' || phase.errors.length > 0)
      .map(
        ([id, phase]) =>
          `| ${PLATFORM_LABELS[run.metadata.platform]} | Phase ${id} | ${STATUS_LABELS[phase.status]} | ${escapeMarkdown(phase.errors.join('; ') || 'Phase did not complete successfully')} |`
      ),
    ...selectedCases(run)
      .filter(({ id }) => run.cases[id].status !== 'passed')
      .map(({ id }) => {
        const result = run.cases[id]
        return `| ${PLATFORM_LABELS[run.metadata.platform]} | ${id} | ${STATUS_LABELS[result.status]} | ${escapeMarkdown(result.summary || 'Task incomplete')} |`
      })
  ])
  return [
    '# Cherry Studio End-to-End Regression Summary',
    '',
    `> **Overall verdict: ${VERDICT_LABELS[report.verdict]}**`,
    '',
    '| Platform | Passed | Failed | Blocked | Incomplete | Duration | Verdict |',
    '| --- | ---: | ---: | ---: | ---: | --- | --- |',
    ...runs.map(
      (run) =>
        `| ${PLATFORM_LABELS[run.metadata.platform]} | ${statusCount(run, 'passed')} | ${statusCount(run, 'failed')} | ${statusCount(run, 'blocked')} | ${statusCount(run, 'pending') + statusCount(run, 'running')} | ${formatDuration(run.startedAt, run.finishedAt)} | ${VERDICT_LABELS[getRunVerdict(run)]} |`
    ),
    ...(report.missingPlatforms.length > 0
      ? [
          '',
          `> ⚠️ **Missing platform reports:** ${report.missingPlatforms.map((platform) => PLATFORM_LABELS[platform]).join(', ')}`
        ]
      : []),
    ...(issues.length > 0
      ? [
          '',
          '## Needs attention',
          '',
          '| Platform | Case / Phase | Status | Reason |',
          '| --- | --- | --- | --- |',
          ...issues
        ]
      : []),
    '',
    '## All cases',
    '',
    '| ID | Test case | macOS | Windows |',
    '| --- | --- | --- | --- |',
    ...REGRESSION_CASES.filter(({ id }) => runs.some((run) => run.cases[id].status !== 'not_applicable')).map(
      ({ id, title }) => {
        const statuses = PLATFORMS.map((platform) => {
          const run = runs.find((candidate) => candidate.metadata.platform === platform)
          return run ? STATUS_LABELS[run.cases[id].status] : '⛔ Missing report'
        })
        return `| ${id} | ${escapeMarkdown(title)} | ${statuses.join(' | ')} |`
      }
    ),
    '',
    '## Detailed report',
    '',
    'Download and extract the `test-report` artifact, then open `index.html` to view all platforms and phases. See `summary.md` for the summary and `evidence/macos` or `evidence/windows` for platform reports, logs, and generated files.',
    ''
  ].join('\n')
}

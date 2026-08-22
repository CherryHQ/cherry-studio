import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REGRESSION_CASES } from './cases'
import { getRunVerdict } from './state'
import {
  type AggregateReport,
  type Platform,
  PLATFORMS,
  type RegressionRun,
  type RunMode,
  type RunVerdict
} from './types'

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

export function renderMarkdown(run: RegressionRun): string {
  const verdict = getRunVerdict(run)
  const rows = REGRESSION_CASES.map((testCase) => {
    const result = run.cases[testCase.id]
    return `| ${testCase.id} | ${escapeMarkdown(testCase.title)} | ${result.status} | ${escapeMarkdown(result.summary)} | ${result.evidence.length}/${testCase.evidence.length} |`
  })
  const blockingResults = REGRESSION_CASES.filter(({ id }) => ['blocked', 'failed'].includes(run.cases[id].status)).map(
    ({ id, title }) => `- ${id} ${title} [${run.cases[id].status}]: ${run.cases[id].summary}`
  )

  return [
    '# Cherry Regression Test Report',
    '',
    `- Platform: ${run.metadata.platform}`,
    `- Runner: ${run.metadata.runner}`,
    `- Ref: ${run.metadata.ref}`,
    `- Commit: ${run.metadata.commitSha}`,
    `- Application version: ${run.metadata.appVersion}`,
    `- Mode: ${run.metadata.mode}`,
    `- Verdict: **${verdict}**`,
    run.metadata.artifactName ? `- Release artifact: ${run.metadata.artifactName}` : '',
    run.metadata.artifactSha256 ? `- Artifact SHA-256: ${run.metadata.artifactSha256}` : '',
    '',
    '## Results',
    '',
    '| ID | Path | Status | Actual result | Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    '## Capability Probe',
    '',
    ...Object.entries(run.capabilities).map(
      ([name, result]) => `- ${name}: ${result.available ? 'available' : 'unavailable'} — ${result.detail}`
    ),
    '',
    '## Failures and Blockers',
    '',
    ...(blockingResults.length > 0 ? blockingResults : ['None recorded.']),
    ''
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n')
}

export function renderJUnit(run: RegressionRun): string {
  const results = REGRESSION_CASES.map((testCase) => ({ testCase, result: run.cases[testCase.id] }))
  const failures = results.filter(({ result }) => result.status === 'failed').length
  const skipped = results.filter(({ result }) =>
    ['blocked', 'not_applicable', 'pending', 'running'].includes(result.status)
  ).length
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
    `<testsuites tests="${results.length}" failures="${failures}" skipped="${skipped}">`,
    `  <testsuite name="cherry-regression-${run.metadata.platform}" tests="${results.length}" failures="${failures}" skipped="${skipped}">`,
    ...cases,
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
  return [
    '# Cherry Regression Test — Combined Result',
    '',
    `**Verdict: ${report.verdict}**`,
    '',
    '| Platform | Mode | Ref | Commit | Verdict |',
    '| --- | --- | --- | --- | --- |',
    ...report.runs.map(
      (run) =>
        `| ${run.metadata.platform} | ${run.metadata.mode} | ${run.metadata.ref} | ${run.metadata.commitSha} | ${getRunVerdict(run)} |`
    ),
    ...(report.missingPlatforms.length > 0
      ? ['', `Missing platform reports: ${report.missingPlatforms.join(', ')}`]
      : []),
    ''
  ].join('\n')
}

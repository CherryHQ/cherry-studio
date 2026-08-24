import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { REGRESSION_CASES } from './cases'
import { getRunVerdict } from './state'
import {
  type AggregateReport,
  type CaseStatus,
  type Platform,
  PLATFORMS,
  type RegressionRun,
  type RunMode,
  type RunVerdict,
  type TaskSelection
} from './types'

const STATUS_LABELS: Record<CaseStatus, string> = {
  pending: '⏳ 等待执行',
  running: '🔄 执行中',
  passed: '✅ 通过',
  failed: '❌ 失败',
  blocked: '⛔ 阻塞',
  not_applicable: '— 不适用'
}

const VERDICT_LABELS: Record<RunVerdict, string> = {
  development_pass: '✅ 开发分支测试通过',
  development_failed: '❌ 开发分支测试未通过',
  development_blocked: '⛔ 开发分支测试受阻',
  release_pass: '✅ 发布验收通过',
  release_failed: '❌ 发布验收未通过',
  release_blocked: '⛔ 发布验收受阻'
}

const PLATFORM_LABELS: Record<Platform, string> = {
  macos: 'macOS',
  windows: 'Windows'
}

const MODE_LABELS: Record<RunMode, string> = {
  branch: '开发分支',
  tag: '发布版本'
}

const CAPABILITY_LABELS: Record<string, string> = {
  desktopAutomation: '桌面自动化',
  externalSelection: '跨应用划词',
  globalShortcut: '全局快捷键',
  directCdp: 'CDP 直连',
  npx: 'npx',
  screenCapture: '屏幕截图',
  systemFilePicker: '系统文件选择器'
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
  if (task === 'all') return '全部任务'
  const titles = REGRESSION_CASES.filter((testCase) => testCase.task === task).map(({ title }) => title)
  return titles.length > 0 ? titles.join('、') : task
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
  if (!finishedAt) return '仍在运行'
  const totalSeconds = Math.max(0, Math.floor((Date.parse(finishedAt) - Date.parse(startedAt)) / 1_000))
  if (!Number.isFinite(totalSeconds)) return '未知'
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? `${hours} 小时 ${minutes} 分 ${seconds} 秒` : `${minutes} 分 ${seconds} 秒`
}

export function renderMarkdown(run: RegressionRun): string {
  const verdict = getRunVerdict(run)
  const testCases = selectedCases(run)
  const rows = testCases.map((testCase) => {
    const result = run.cases[testCase.id]
    return `| ${testCase.id} | ${escapeMarkdown(testCase.title)} | ${STATUS_LABELS[result.status]} | ${escapeMarkdown(result.summary || '暂未记录结果')} | ${result.artifacts?.length ?? 0} |`
  })
  const blockingResults = testCases
    .filter(({ id }) => ['blocked', 'failed'].includes(run.cases[id].status))
    .flatMap((testCase) => {
      const result = run.cases[testCase.id]
      return [
        `### ${STATUS_LABELS[result.status]} · ${testCase.id} · ${escapeMarkdown(testCase.title)}`,
        '',
        `- **结果说明：**${escapeMarkdown(result.summary)}`,
        `- **自动化产物：**${result.artifacts?.length ?? 0} 个`,
        ''
      ]
    })
  const metadataRows = [
    `| 测试平台 | ${PLATFORM_LABELS[run.metadata.platform]} |`,
    `| GitHub 执行器 | \`${escapeMarkdown(run.metadata.runner)}\` |`,
    `| 测试对象 | \`${escapeMarkdown(run.metadata.ref)}\` |`,
    `| 提交哈希 | \`${escapeMarkdown(run.metadata.commitSha)}\` |`,
    `| 应用版本 | \`${escapeMarkdown(run.metadata.appVersion)}\` |`,
    `| 运行模式 | ${MODE_LABELS[run.metadata.mode]} |`,
    `| 任务范围 | ${escapeMarkdown(taskLabel(run.metadata.task))} |`,
    `| 开始时间（UTC） | \`${run.startedAt}\` |`,
    ...(run.finishedAt ? [`| 结束时间（UTC） | \`${run.finishedAt}\` |`] : []),
    `| 运行耗时 | ${formatDuration(run.startedAt, run.finishedAt)} |`,
    ...(run.metadata.artifactName ? [`| 安装包 | \`${escapeMarkdown(run.metadata.artifactName)}\` |`] : []),
    ...(run.metadata.artifactSha256 ? [`| 安装包 SHA-256 | \`${run.metadata.artifactSha256}\` |`] : [])
  ]
  const capabilities = Object.entries(run.capabilities)
  const availableCapabilities = capabilities.filter(([, result]) => result.available).length

  return [
    '# Cherry Studio 全链路回归测试报告',
    '',
    `> **总体结论：${VERDICT_LABELS[verdict]}**`,
    '',
    '## 运行信息',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    ...metadataRows,
    '',
    '## 结果概览',
    '',
    '| 适用测试项 | 通过 | 失败 | 阻塞 | 未完成 |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${testCases.length} | ${statusCount(run, 'passed')} | ${statusCount(run, 'failed')} | ${statusCount(run, 'blocked')} | ${statusCount(run, 'pending') + statusCount(run, 'running')} |`,
    '',
    '## 测试项明细',
    '',
    '| 编号 | 测试项 | 结果 | 结果说明 | 自动化产物 |',
    '| --- | --- | --- | --- | ---: |',
    ...rows,
    '',
    '## 异常详情',
    '',
    ...(blockingResults.length > 0 ? blockingResults : ['无失败或阻塞项。', '']),
    '<details>',
    `<summary>运行能力检查（${availableCapabilities} / ${capabilities.length} 可用）</summary>`,
    '',
    '| 能力 | 结果 | 说明 |',
    '| --- | --- | --- |',
    ...capabilities.map(
      ([name, result]) =>
        `| ${capabilityLabel(name)} | ${result.available ? '✅ 可用' : '❌ 不可用'} | ${escapeMarkdown(result.detail)} |`
    ),
    '',
    '</details>',
    ''
  ].join('\n')
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
  const runs = [...report.runs].sort(
    (left, right) => PLATFORMS.indexOf(left.metadata.platform) - PLATFORMS.indexOf(right.metadata.platform)
  )
  return [
    '# Cherry Studio 全链路回归测试汇总',
    '',
    `> **总体结论：${VERDICT_LABELS[report.verdict]}**`,
    '',
    '| 平台 | 模式 | 任务范围 | 测试对象 | 提交哈希 | 耗时 | 通过 | 失败 | 阻塞 | 平台结论 |',
    '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |',
    ...runs.map(
      (run) =>
        `| ${PLATFORM_LABELS[run.metadata.platform]} | ${MODE_LABELS[run.metadata.mode]} | ${escapeMarkdown(taskLabel(run.metadata.task))} | ${escapeMarkdown(run.metadata.ref)} | \`${run.metadata.commitSha.slice(0, 12)}\` | ${formatDuration(run.startedAt, run.finishedAt)} | ${statusCount(run, 'passed')} | ${statusCount(run, 'failed')} | ${statusCount(run, 'blocked')} | ${VERDICT_LABELS[getRunVerdict(run)]} |`
    ),
    ...(report.missingPlatforms.length > 0
      ? ['', `> ⚠️ **缺少平台报告：**${report.missingPlatforms.map((platform) => PLATFORM_LABELS[platform]).join('、')}`]
      : []),
    ''
  ].join('\n')
}

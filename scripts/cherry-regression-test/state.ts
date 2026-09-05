import { readFileSync, renameSync, writeFileSync } from 'node:fs'

import { REGRESSION_CASES } from './cases'
import type { CapabilityResult, CaseStatus, RegressionRun, RunMetadata, RunVerdict } from './types'

export function createRun(metadata: RunMetadata): RegressionRun {
  return {
    schemaVersion: 1,
    metadata,
    startedAt: new Date().toISOString(),
    capabilities: {},
    cases: Object.fromEntries(
      REGRESSION_CASES.map((testCase) => [
        testCase.id,
        {
          id: testCase.id,
          status:
            testCase.modes.includes(metadata.mode) && (metadata.task === 'all' || testCase.task === metadata.task)
              ? 'pending'
              : 'not_applicable',
          summary: !testCase.modes.includes(metadata.mode)
            ? `不适用于 ${metadata.mode} 模式`
            : metadata.task !== 'all' && testCase.task !== metadata.task
              ? `未被任务 ${metadata.task} 选中`
              : ''
        }
      ])
    )
  }
}

export function beginCase(run: RegressionRun, caseId: string): RegressionRun {
  const result = run.cases[caseId]
  if (!result) throw new Error(`未知的回归测试项：${caseId}`)
  if (result.status === 'not_applicable') throw new Error(`${caseId} 不适用于 ${run.metadata.mode} 模式`)
  return {
    ...run,
    cases: {
      ...run.cases,
      [caseId]: { ...result, status: 'running', startedAt: result.startedAt ?? new Date().toISOString() }
    }
  }
}

export function completeE2eCase(
  run: RegressionRun,
  caseId: string,
  status: Extract<CaseStatus, 'blocked' | 'failed' | 'passed'>,
  summary: string,
  artifacts: string[] = []
): RegressionRun {
  const result = run.cases[caseId]
  if (!result) throw new Error(`未知的回归测试项：${caseId}`)
  if (result.status === 'not_applicable') throw new Error(`${caseId} 不适用于 ${run.metadata.mode} 模式`)
  if (!summary.trim() || !/[\u3400-\u9fff]/.test(summary)) throw new Error(`${caseId} 的结果摘要必须使用简体中文`)

  return {
    ...run,
    cases: {
      ...run.cases,
      [caseId]: {
        ...result,
        artifacts,
        status,
        summary: summary.trim(),
        finishedAt: new Date().toISOString()
      }
    }
  }
}

export function finalizeRun(run: RegressionRun): RegressionRun {
  const cases = Object.fromEntries(
    Object.entries(run.cases).map(([caseId, result]) => {
      if (result.status !== 'pending' && result.status !== 'running') return [caseId, result]
      return [
        caseId,
        {
          ...result,
          status: 'blocked' as const,
          summary: '任务在生成最终报告前未完成',
          finishedAt: new Date().toISOString()
        }
      ]
    })
  )
  return { ...run, cases, finishedAt: new Date().toISOString() }
}

export function setCapabilities(run: RegressionRun, capabilities: Record<string, CapabilityResult>): RegressionRun {
  return { ...run, capabilities }
}

export function updateRunMetadata(run: RegressionRun, metadata: Partial<RunMetadata>): RegressionRun {
  return { ...run, metadata: { ...run.metadata, ...metadata } }
}

export function getRunVerdict(run: RegressionRun): RunVerdict {
  const applicable = Object.values(run.cases).filter(({ status }) => status !== 'not_applicable')
  const prefix = run.metadata.mode === 'tag' ? 'release' : 'development'
  if (applicable.some(({ status }) => status === 'failed')) return `${prefix}_failed`
  if (applicable.some(({ status }) => status !== 'passed')) return `${prefix}_blocked`
  return `${prefix}_pass`
}

export function readRun(filePath: string): RegressionRun {
  return JSON.parse(readFileSync(filePath, 'utf8')) as RegressionRun
}

export function writeRun(filePath: string, run: RegressionRun): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}`
  writeFileSync(temporaryPath, `${JSON.stringify(run, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporaryPath, filePath)
}

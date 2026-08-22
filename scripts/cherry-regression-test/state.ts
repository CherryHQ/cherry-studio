import { readFileSync, renameSync, writeFileSync } from 'node:fs'

import { getRegressionCase, REGRESSION_CASES } from './cases'
import type { CapabilityResult, CaseStatus, EvidenceRecord, RegressionRun, RunMetadata, RunVerdict } from './types'

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
          status: testCase.modes.includes(metadata.mode) ? 'pending' : 'not_applicable',
          summary: testCase.modes.includes(metadata.mode) ? '' : `Not applicable in ${metadata.mode} mode`,
          evidence: []
        }
      ])
    )
  }
}

export function beginCase(run: RegressionRun, caseId: string): RegressionRun {
  const result = run.cases[caseId]
  if (!result) throw new Error(`Unknown regression test case: ${caseId}`)
  if (result.status === 'not_applicable') throw new Error(`${caseId} is not applicable in ${run.metadata.mode} mode`)
  return {
    ...run,
    cases: {
      ...run.cases,
      [caseId]: { ...result, status: 'running', startedAt: result.startedAt ?? new Date().toISOString() }
    }
  }
}

export function addEvidence(run: RegressionRun, caseId: string, evidence: EvidenceRecord): RegressionRun {
  const result = run.cases[caseId]
  if (!result) throw new Error(`Unknown regression test case: ${caseId}`)
  const testCase = getRegressionCase(caseId)
  const expected = testCase.evidence.find(({ id }) => id === evidence.id)
  if (!expected) throw new Error(`${evidence.id} is not declared evidence for ${caseId}`)
  if (expected.kind !== evidence.kind) {
    throw new Error(`${caseId}/${evidence.id} requires ${expected.kind} evidence, received ${evidence.kind}`)
  }
  const existing = result.evidence.filter(({ id }) => id !== evidence.id)
  return {
    ...run,
    cases: {
      ...run.cases,
      [caseId]: { ...result, evidence: [...existing, evidence] }
    }
  }
}

export function completeCase(
  run: RegressionRun,
  caseId: string,
  status: Extract<CaseStatus, 'blocked' | 'failed' | 'passed'>,
  summary: string
): RegressionRun {
  const result = run.cases[caseId]
  if (!result) throw new Error(`Unknown regression test case: ${caseId}`)
  if (result.status === 'not_applicable') throw new Error(`${caseId} is not applicable in ${run.metadata.mode} mode`)
  if (!summary.trim()) throw new Error(`${caseId} requires a result summary`)

  if (status === 'passed') {
    const missingEvidence = getRegressionCase(caseId).evidence.filter(
      (required) =>
        !result.evidence.some((record) => record.id === required.id && record.passed && record.source === 'driver')
    )
    if (missingEvidence.length > 0) {
      throw new Error(
        `${caseId} cannot pass without machine evidence: ${missingEvidence.map(({ id }) => id).join(', ')}`
      )
    }
  }

  return {
    ...run,
    cases: {
      ...run.cases,
      [caseId]: { ...result, status, summary: summary.trim(), finishedAt: new Date().toISOString() }
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
          summary: 'Not executed before finalization',
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

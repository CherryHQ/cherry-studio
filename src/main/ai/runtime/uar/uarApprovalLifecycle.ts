import * as z from 'zod'

import type { UarApprovalLifecycleInspection } from '@shared/types/prometheusIntegration'

import type { UarHostAdmissionSnapshot } from './UarHostToolAdmission'

export const rawPendingApproval = z.object({
  version: z.literal(1),
  runId: z.string(),
  pending: z
    .object({
      version: z.literal(1),
      eventId: z.string(),
      cursor: z.number(),
      rootRunId: z.string(),
      approvalId: z.string(),
      admissionId: z.string().nullable().optional(),
      callIndex: z.number(),
      toolCallId: z.string(),
      name: z.string(),
      argumentsJson: z.string(),
      riskReason: z.string()
    })
    .nullable()
})

export const rawAdmissionEvidence = z.object({
  version: z.literal(1),
  runId: z.string(),
  records: z.array(
    z.object({
      schema_version: z.number(),
      evidence_id: z.string(),
      owner_id: z.string(),
      root_run_id: z.string(),
      run_id: z.string(),
      invocation_id: z.string(),
      admission_id: z.string().nullable().optional(),
      tool_name: z.string(),
      runtime_epoch: z.string(),
      host_epoch: z.string(),
      state: z.enum([
        'awaiting_approval',
        'claim_intent',
        'succeeded',
        'failed',
        'denied',
        'cancelled',
        'invalidated',
        'interrupted',
        'outcome_unknown'
      ]),
      occurred_at: z.union([z.string(), z.number()])
    })
  )
})

export function projectHostApproval(snapshot: UarHostAdmissionSnapshot): UarApprovalLifecycleInspection {
  const display = snapshot.actionDisplay
  return {
    admissionId: snapshot.admissionId,
    invocationId: snapshot.invocationId,
    rootRunId: snapshot.rootRunId,
    executingRunId: snapshot.executingRunId,
    ownerSessionId: snapshot.sessionId,
    workspace: snapshot.workspace,
    toolName: snapshot.toolName,
    state: snapshot.state,
    hostDisposition: snapshot.hostDisposition,
    action: {
      ...(typeof display.operation === 'string' ? { operation: display.operation } : {}),
      ...(typeof display.server === 'string' ? { server: display.server } : {}),
      ...(typeof display.target === 'string' ? { target: display.target } : {}),
      detailsAvailable: display.detailsAvailable === true
    },
    updatedAt: snapshot.updatedAt
  }
}

export function projectRuntimePending(
  pending: NonNullable<z.infer<typeof rawPendingApproval>['pending']>,
  ownerSessionId: string,
  runId: string
): UarApprovalLifecycleInspection {
  const action = parseActionDisplay(pending.argumentsJson)
  return {
    admissionId: pending.admissionId ?? pending.approvalId,
    invocationId: pending.admissionId ?? pending.approvalId,
    eventId: pending.eventId,
    cursor: pending.cursor,
    rootRunId: pending.rootRunId,
    executingRunId: runId,
    ownerSessionId,
    workspace: '',
    toolName: pending.name,
    state: 'awaiting-human',
    hostDisposition: 'ask',
    action: { ...action, riskReason: pending.riskReason },
    updatedAt: Date.now()
  }
}

export function projectRuntimeEvidence(
  record: z.infer<typeof rawAdmissionEvidence>['records'][number],
  ownerSessionId: string
): UarApprovalLifecycleInspection {
  const states: Record<typeof record.state, UarApprovalLifecycleInspection['state']> = {
    awaiting_approval: 'awaiting-human',
    claim_intent: 'claimed',
    succeeded: 'succeeded',
    failed: 'failed',
    denied: 'denied',
    cancelled: 'cancelled',
    invalidated: 'invalidated',
    interrupted: 'interrupted',
    outcome_unknown: 'outcome-unknown'
  }
  return {
    admissionId: record.admission_id ?? record.evidence_id,
    invocationId: record.invocation_id,
    rootRunId: record.root_run_id,
    executingRunId: record.run_id,
    ownerSessionId,
    workspace: '',
    toolName: record.tool_name,
    state: states[record.state],
    hostDisposition: 'ask',
    action: { operation: record.tool_name, detailsAvailable: false },
    updatedAt: timestamp(record.occurred_at)
  }
}

export function latestApprovals(records: UarApprovalLifecycleInspection[]): UarApprovalLifecycleInspection[] {
  const latest = new Map<string, UarApprovalLifecycleInspection>()
  for (const record of records) {
    const current = latest.get(record.admissionId)
    if (!current) {
      latest.set(record.admissionId, record)
      continue
    }
    if (current.state !== 'awaiting-human' && record.state === 'awaiting-human') continue
    if (current.state === 'awaiting-human' && record.state !== 'awaiting-human') {
      latest.set(record.admissionId, record)
      continue
    }
    if (record.updatedAt >= current.updatedAt) latest.set(record.admissionId, record)
  }
  return [...latest.values()].sort((left, right) => right.updatedAt - left.updatedAt)
}

function parseActionDisplay(value: string): UarApprovalLifecycleInspection['action'] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { detailsAvailable: false }
    const display = parsed as Record<string, unknown>
    return {
      ...(typeof display.operation === 'string' ? { operation: display.operation } : {}),
      ...(typeof display.server === 'string' ? { server: display.server } : {}),
      ...(typeof display.target === 'string' ? { target: display.target } : {}),
      detailsAvailable: display.detailsAvailable === true
    }
  } catch {
    return { detailsAvailable: false }
  }
}

function timestamp(value: string | number): number {
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1_000
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

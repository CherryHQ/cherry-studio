import { expect, it } from 'vitest'

import { agentFileSnapshotReason, agentFileSnapshotRequestSchemas } from '../agentFileSnapshot'

it('rejects caller-selected paths and unsafe snapshot identifiers', () => {
  const schema = agentFileSnapshotRequestSchemas['agent.file_snapshot.undo'].input
  const valid = { sessionId: 'session', replyId: 'reply', expectedRevision: '2' }
  expect(schema.safeParse(valid).success).toBe(true)
  expect(schema.safeParse({ ...valid, files: ['/project/a'] }).success).toBe(false)
  expect(schema.safeParse({ ...valid, sessionId: '../other' }).success).toBe(false)
  expect(schema.safeParse({ ...valid, replyId: '..' }).success).toBe(false)
})

it('accepts every known reason and rejects unknown reasons', () => {
  for (const reason of [
    'empty-write',
    'large-deletion',
    'undecidable',
    'snapshot-failed',
    'snapshot-conflict',
    'SNAPSHOT_ROOT_IN_WORKSPACE',
    'turn-active',
    'stale',
    'unverifiable',
    'conflict',
    'pending',
    'no-round',
    'empty',
    'failed',
    'unknown',
    'restored',
    'round-mismatch',
    'revision-mismatch',
    'partial',
    'approval-unavailable',
    'approval-denied',
    'invalid-path',
    'outside-workspace'
  ])
    expect(agentFileSnapshotReason.safeParse(reason).success).toBe(true)
  expect(agentFileSnapshotReason.safeParse('unexpected').success).toBe(false)
})

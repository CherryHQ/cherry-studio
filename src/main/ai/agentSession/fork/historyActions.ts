import type { RunEditResolution, RunHistoryBoundary } from '@data/services/agentSessionRunHistory'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor } from '@main/ai/runtime/fork'
import type { AgentSessionRuntimeDriver } from '@main/ai/runtime/types'
import type { AgentSessionHistoryActions } from '@shared/data/api/schemas/agentSessionMessages'

type CheckpointReader = Pick<AgentSessionRuntimeDriver, 'type'> &
  Required<Pick<AgentSessionRuntimeDriver, 'isForkCheckpoint'>>
type HistoryBoundary = Omit<RunHistoryBoundary, 'id'> & { id?: string }

export function resolveForkBoundary(
  driver: AgentSessionRuntimeDriver | undefined,
  boundary: HistoryBoundary
):
  | { reason: null; anchor: RuntimeForkAnchor; fork: NonNullable<AgentSessionRuntimeDriver['fork']> }
  | { reason: NonNullable<AgentSessionHistoryActions['fork']> } {
  if (!driver?.fork || !driver.isForkCheckpoint) return { reason: 'unsupported_checkpoint' }
  const result = inspectForkBoundary(
    { type: driver.type, isForkCheckpoint: driver.isForkCheckpoint.bind(driver) },
    boundary
  )
  return result.reason === null ? { ...result, fork: driver.fork.bind(driver) } : result
}

export function inspectForkBoundary(
  driver: CheckpointReader | undefined,
  boundary: HistoryBoundary
): { reason: null; anchor: RuntimeForkAnchor } | { reason: NonNullable<AgentSessionHistoryActions['fork']> } {
  if (!driver) return { reason: 'unsupported_checkpoint' }
  if (boundary.role !== 'assistant' || boundary.status !== 'success') return { reason: 'not_turn_boundary' }
  if (boundary.anchor == null) return { reason: 'legacy_history' }
  const anchor = RuntimeForkAnchorSchema.safeParse(boundary.anchor)
  if (
    !anchor.success ||
    anchor.data.checkpoint.runtime !== driver.type ||
    !driver.isForkCheckpoint(anchor.data.checkpoint)
  )
    return { reason: 'unsupported_checkpoint' }
  return { reason: null, anchor: anchor.data }
}

export function getEditFailure(
  driver: CheckpointReader | undefined,
  edit: RunEditResolution
): AgentSessionHistoryActions['edit'] {
  if (edit.kind === 'invalid') return 'invalid_target'
  if (edit.kind !== 'ready' || !driver || !edit.boundary) return 'checkpoint_unsupported'
  const boundary = edit.boundary
  return boundary.role === 'root' || inspectForkBoundary(driver, boundary).reason === null
    ? null
    : 'checkpoint_unsupported'
}

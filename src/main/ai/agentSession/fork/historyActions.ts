import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { RuntimeForkAnchorSchema, type RuntimeForkAnchor } from '@main/ai/runtime/fork'
import type { AgentSessionRuntimeDriver } from '@main/ai/runtime/types'
import type { AgentSessionHistoryActions } from '@shared/data/api/schemas/agentSessionMessages'

type HistoryBoundary = Pick<AgentSessionMessageRow, 'role' | 'status'> & { anchor: unknown }

export function resolveForkBoundary(
  driver: AgentSessionRuntimeDriver | undefined,
  boundary: HistoryBoundary
):
  | { reason: null; anchor: RuntimeForkAnchor; fork: NonNullable<AgentSessionRuntimeDriver['fork']> }
  | { reason: NonNullable<AgentSessionHistoryActions['fork']> } {
  if (!driver?.fork || !driver.isForkCheckpoint) return { reason: 'unsupported_checkpoint' }
  if (boundary.role !== 'assistant') return { reason: 'not_turn_boundary' }
  return resolveRestoreBoundary(driver, boundary)
}

export function resolveRestoreBoundary(
  driver: AgentSessionRuntimeDriver | undefined,
  boundary: HistoryBoundary
): ReturnType<typeof resolveForkBoundary> {
  if (!driver?.fork || !driver.isForkCheckpoint) return { reason: 'unsupported_checkpoint' }
  if (boundary.status !== 'success') return { reason: 'not_turn_boundary' }
  if (boundary.anchor == null) return { reason: 'legacy_history' }
  const anchor = RuntimeForkAnchorSchema.safeParse(boundary.anchor)
  if (
    !anchor.success ||
    anchor.data.checkpoint.runtime !== driver.type ||
    !driver.isForkCheckpoint(anchor.data.checkpoint)
  )
    return { reason: 'unsupported_checkpoint' }
  return { reason: null, anchor: anchor.data, fork: driver.fork.bind(driver) }
}

export function getEditFailure(
  driver: AgentSessionRuntimeDriver | undefined,
  target: Pick<AgentSessionMessageRow, 'role' | 'delivery'>,
  parent: HistoryBoundary | null
): AgentSessionHistoryActions['edit'] {
  if (target.role !== 'user' || target.delivery) return 'invalid_target'
  if (!driver?.fork || !driver.isForkCheckpoint || !parent) return 'checkpoint_unsupported'
  return parent.role === 'root' || resolveRestoreBoundary(driver, parent).reason === null
    ? null
    : 'checkpoint_unsupported'
}

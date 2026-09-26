import { application } from '@application'
import type { agentCheckpointRequestSchemas } from '@shared/ipc/schemas/agentCheckpoint'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapter for the O1 checkpoint routes: delegates to `CheckpointService`. */
export const agentCheckpointHandlers: IpcHandlersFor<typeof agentCheckpointRequestSchemas> = {
  'agent_checkpoint.get': async ({ sessionId }) => application.get('CheckpointService').status(sessionId),
  'agent_checkpoint.restore': ({ sessionId }) => application.get('CheckpointService').restore(sessionId)
}

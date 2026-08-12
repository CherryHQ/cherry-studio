import { application } from '@application'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import { v4 as uuidv4 } from 'uuid'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  const agentId = uuidv4()
  const sessionId = uuidv4()
  const agentsDataRoot = application.getPath('feature.agents.data')
  await createAgentDataDirectory(agentsDataRoot, agentId)

  try {
    // Every UI entry into an agent goes through one of its sessions, so an agent with none is
    // unreachable. The row and its first session commit together — a crash between two separate
    // writes would leave behind exactly the unreachable agent this seeds against.
    const agent = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          const created = agentService.createAgentWithIdTx(tx, agentId, request)
          agentSessionService.createTx(tx, sessionId, {
            agentId,
            name: '',
            workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
          })
          return created
        }),
      defaultHandlersFor('Agent', agentId)
    )
    agentService.emitAgentCreated(agent)
    agentSessionService.notifyReadModelChange([sessionId], 'membership')
    return agent
  } catch (error) {
    try {
      await removeAgentDataDirectory(agentsDataRoot, agentId)
    } catch (cleanupError) {
      logger.warn('Failed to roll back agent data directory after database create failure', {
        agentId,
        cleanupError
      })
    }
    throw error
  }
}

import type { DbType, ISeeder } from '@data/db/types'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

/**
 * The desktop's Cherry Assistant seed as a Pi agent, which the browser runtime serves. Like the
 * desktop seed it has one session, so it shows in the Agents sidebar, and no model until the user
 * picks one; a deleted assistant is not recreated.
 */
export class WebCherryAssistantSeeder implements ISeeder {
  readonly name = 'web-cherry-assistant'
  readonly description = 'Insert the built-in Cherry Assistant as a Pi agent'
  readonly version = '1'

  run(db: DbType): void {
    db.transaction((tx) => {
      if (agentService.findBuiltinAgentByRoleTx(tx, BUILTIN_AGENT_ROLE.ASSISTANT, { includeDeleted: true })) return
      const agentId = crypto.randomUUID()
      agentService.createAgentTx(tx, agentId, {
        id: agentId,
        type: 'pi',
        name: navigator.language.toLowerCase().startsWith('zh') ? 'Cherry 小助手' : 'Cherry Assistant',
        description: '',
        instructions: '',
        model: null,
        configuration: {
          avatar: '🍒',
          permission_mode: 'acceptEdits',
          bootstrap_completed: true,
          builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT,
          env_vars: {}
        }
      })
      agentSessionService.createTx(tx, crypto.randomUUID(), {
        agentId,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })
  }
}

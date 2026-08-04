import { loadBuiltinAssistantDefaults } from '@data/builtinAgentDefinition'
import { agentTable } from '@data/db/schemas/agent'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { sql } from 'drizzle-orm'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import type { DbOrTx, DbType, ISeeder } from '../../types'

export class CherryAssistantSeeder implements ISeeder {
  readonly name = 'cherryAssistant'
  readonly description = 'Insert the builtin Cherry Assistant in every agent library'
  readonly executionPolicy = 'run-on-change' as const
  // Version 1 journaled the old "empty library only" eligibility decision. Version 2
  // rolls the assistant out to existing libraries; the persisted builtin identity still
  // prevents recreating a user-deleted assistant or overwriting user choices.
  readonly version = '2'

  run(db: DbType): void {
    db.transaction((tx) => {
      const existing = this.findBuiltinAssistant(tx)
      if (existing) return

      const defaults = loadBuiltinAssistantDefaults(this.getPreferredSystemLanguage())
      const agentId = uuidv4()
      const row = agentService.createAgentTx(tx, agentId, {
        id: agentId,
        type: 'claude-code',
        name: defaults.name,
        description: '',
        instructions: '',
        // The managed CherryAI model cannot run the agent runtime. Onboarding
        // assigns the user's default model when they choose one.
        model: null,
        configuration: { ...defaults.configuration }
      })

      if (!row) {
        throw new Error('insert succeeded but select returned no builtin Cherry Assistant row')
      }

      // One seeded session makes the agent visible in the Agents sidebar. This does
      // not self-heal after user deletion: draft-session creation in the renderer is
      // the intentional path back from an agent-picker-only state.
      agentSessionService.createTx(tx, uuidv4(), {
        agentId,
        name: '',
        workspace: { type: AGENT_WORKSPACE_TYPE.SYSTEM }
      })
    })
  }

  private findBuiltinAssistant(tx: DbOrTx) {
    const [existing] = tx
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(sql`json_extract(${agentTable.configuration}, '$.builtin_role') = 'assistant'`)
      .limit(1)
      .all()
    return existing
  }

  private getPreferredSystemLanguage(): string {
    try {
      return app.getPreferredSystemLanguages()[0] ?? 'en-US'
    } catch {
      return 'en-US'
    }
  }
}

import { createHash } from 'node:crypto'

import { eq, isNull } from 'drizzle-orm'

import { agentTable } from '@data/db/schemas/agent'

import type { DbType, ISeeder } from '../../types'

// Match the exact shipped UTF-8 text from 3b7a1c5ca6^; even one-byte user edits must survive.
const LEGACY_INSTRUCTION_HASHES = new Set([
  'f23ecf9c6b7524a6b181ac7f5a1dd8611e0740fd3810ce890478a8d5e5ddc127',
  '96529463aa7f4a9a8043103fbd082d30c6e431208bfe21a1edd989a294f84e69'
])

export class CherryAssistantInstructionsUpgradeSeeder implements ISeeder {
  readonly name = 'cherryAssistantInstructionsUpgrade'
  readonly version = '1'
  readonly description = 'Restore bundled instructions for legacy stock Cherry Assistant prompts'
  readonly executionPolicy = 'run-on-change' as const

  run(db: DbType): void {
    db.transaction(
      (tx) => {
        const agents = tx.select().from(agentTable).where(isNull(agentTable.deletedAt)).all()
        for (const agent of agents) {
          if (agent.configuration.builtin_role !== 'assistant') continue
          const hash = createHash('sha256').update(agent.instructions, 'utf8').digest('hex')
          if (!LEGACY_INSTRUCTION_HASHES.has(hash)) continue

          tx.update(agentTable).set({ instructions: '' }).where(eq(agentTable.id, agent.id)).run()
        }
      },
      { behavior: 'immediate' }
    )
  }
}

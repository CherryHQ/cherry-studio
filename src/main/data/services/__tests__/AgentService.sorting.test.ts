import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentService } from '@data/services/AgentService'

describe('AgentService sort-key fallback', () => {
  const dbh = setupTestDatabase()

  it.each(['constructor', '__proto__', 'toString'])('uses the fallback column for unknown sort key %s', (sortBy) => {
    dbh.db
      .insert(agentTable)
      .values([
        {
          id: 'older',
          type: 'claude-code',
          name: 'Z older',
          instructions: '',
          orderKey: 'b',
          createdAt: 1000
        },
        {
          id: 'newer',
          type: 'claude-code',
          name: 'A newer',
          instructions: '',
          orderKey: 'a',
          createdAt: 2000
        }
      ])
      .run()

    // @ts-expect-error Exercise a malformed runtime sort key outside the public vocabulary.
    const { agents, total } = agentService.listAgents({ sortBy, sortOrder: 'desc' })

    expect(agents.map(({ id }) => id)).toEqual(['newer', 'older'])
    expect(total).toBe(2)
  })
})

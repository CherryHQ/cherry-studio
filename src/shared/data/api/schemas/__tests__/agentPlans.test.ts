import { describe, expect, it } from 'vitest'

import { AgentPlanHistoryQuerySchema, MAX_AGENT_PLAN_STEPS, ReplaceAgentPlanSchema } from '../agentPlans'

const id = '11111111-1111-4111-A111-111111111111'
const input = { objective: 'Plan', expectedRevision: 0, steps: [{ id, title: 'Work', dependencyIds: [] }] }

describe('host plan write contract', () => {
  it('canonicalizes UUIDs and trims content without adding progress or execution claims', () => {
    expect(
      ReplaceAgentPlanSchema.parse({ ...input, objective: ' Plan ', steps: [{ ...input.steps[0], title: ' Work ' }] })
    ).toEqual({
      ...input,
      steps: [{ id: id.toLowerCase(), title: 'Work', dependencyIds: [] }]
    })
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY, '0', null])(
    'rejects invalid expected revision %s',
    (revision) => {
      expect(ReplaceAgentPlanSchema.safeParse({ ...input, expectedRevision: revision }).success).toBe(false)
    }
  )

  it('bounds content, graph size, dependency fanout and history pages', () => {
    for (const dto of [
      { ...input, objective: ' ' },
      { ...input, objective: 'x'.repeat(8001) },
      { ...input, steps: [{ ...input.steps[0], title: '' }] },
      { ...input, steps: [{ ...input.steps[0], title: 'x'.repeat(1001) }] },
      { ...input, steps: Array.from({ length: MAX_AGENT_PLAN_STEPS + 1 }, () => input.steps[0]) },
      {
        ...input,
        steps: [{ ...input.steps[0], dependencyIds: Array.from({ length: MAX_AGENT_PLAN_STEPS + 1 }, () => id) }]
      },
      { ...input, steps: [{ ...input.steps[0], id: 'not-a-uuid' }] }
    ])
      expect(ReplaceAgentPlanSchema.safeParse(dto).success).toBe(false)
    expect(AgentPlanHistoryQuerySchema.parse({ limit: '25', cursor: '2:id' })).toEqual({
      limit: 25,
      cursor: '2:id'
    })
    expect(AgentPlanHistoryQuerySchema.safeParse({ limit: 26 }).success).toBe(false)
    expect(AgentPlanHistoryQuerySchema.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false)
  })

  it('rejects untrusted status, runtime source, delivery and unexpected fields', () => {
    for (const dto of [
      { ...input, steps: [{ ...input.steps[0], status: 'completed' }] },
      { ...input, steps: [{ ...input.steps[0], nativeToolCallId: 'other' }] },
      { ...input, revision: 7 },
      { ...input, delivery: 'delivered' },
      { ...input, origin: 'runtime' }
    ])
      expect(ReplaceAgentPlanSchema.safeParse(dto).success).toBe(false)
  })
})

import { and, eq, inArray, isNull } from 'drizzle-orm'

import { application } from '@application'
import {
  agentPlanHistoryTable as history,
  type AgentPlanRow,
  agentPlanStepIdentityTable as identities,
  agentPlanTable as plans
} from '@data/db/schemas/agentPlan'
import { agentSessionTable as sessions } from '@data/db/schemas/agentSession'
import type { DbOrTx } from '@data/db/types'
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from '@data/services/utils/keysetCursor'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  type AgentPlanEntity,
  type AgentPlanHistoryQuery,
  AgentPlanHistoryQuerySchema,
  type AgentPlanState,
  type ReplaceAgentPlanDto,
  ReplaceAgentPlanSchema
} from '@shared/data/api/schemas/agentPlans'

function invalid(message: string): never {
  throw DataApiErrorFactory.validation({ steps: [message] })
}

function rowToEntity(row: AgentPlanRow): AgentPlanEntity {
  return {
    ...row,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt),
    delivery: 'unsupported'
  }
}

function assertSession(tx: DbOrTx, sessionId: string): void {
  const session = tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.type, 'conversation'),
        isNull(sessions.ownerSessionId),
        isNull(sessions.deletedAt)
      )
    )
    .get()
  if (!session) throw DataApiErrorFactory.notFound('Root conversation', sessionId)
}

function validateGraph(state: AgentPlanState): void {
  const positions = new Map(state.steps.map((step, index) => [step.id, index]))
  if (positions.size !== state.steps.length) invalid('Step IDs must be unique')
  state.steps.forEach((step, index) => {
    if (new Set(step.dependencyIds).size !== step.dependencyIds.length) invalid('Dependencies must be unique')
    for (const id of step.dependencyIds) {
      const position = positions.get(id)
      if (position === undefined) invalid('Dependency does not belong to this plan')
      if (position >= index)
        invalid('Each prerequisite must precede its step; self-dependencies and cycles are invalid')
    }
  })
}

class AgentPlanService {
  get(sessionId: string): AgentPlanEntity | null {
    const db = application.get('DbService').getDb()
    assertSession(db, sessionId)
    const row = db.select().from(plans).where(eq(plans.sessionId, sessionId)).get()
    return row ? rowToEntity(row) : null
  }

  history(sessionId: string, query: AgentPlanHistoryQuery = {}) {
    const parsed = AgentPlanHistoryQuerySchema.parse(query)
    const plan = this.get(sessionId)
    if (!plan) return { items: [] }
    const limit = parsed.limit ?? 10
    const cursor = decodeListCursor(parsed.cursor, asNumericKey, 'agent-plan-history')
    const ordering = keysetOrdering(history.revision, history.id, { major: 'desc', tie: 'desc' })
    const rows = application
      .get('DbService')
      .getDb()
      .select()
      .from(history)
      .where(and(eq(history.planId, plan.id), cursor ? ordering.where(cursor) : undefined))
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()
    const items = rows.slice(0, limit).map((row) => ({ ...row, createdAt: timestampToISO(row.createdAt) }))
    return {
      items,
      ...(rows.length > limit
        ? { nextCursor: encodeCursor(items[items.length - 1].revision, items[items.length - 1].id) }
        : {})
    }
  }

  /** Called only inside the synchronous Main runtime idle-check transaction. */
  replaceTx(tx: DbOrTx, sessionId: string, input: ReplaceAgentPlanDto): { plan: AgentPlanEntity; changed: boolean } {
    const dto = ReplaceAgentPlanSchema.parse(input)
    assertSession(tx, sessionId)
    const current = tx.select().from(plans).where(eq(plans.sessionId, sessionId)).get()
    if ((current?.revision ?? 0) !== dto.expectedRevision) {
      throw DataApiErrorFactory.conflict('Plan changed. Reload before applying edits.', 'Agent plan')
    }
    const previous = new Map(current?.state.steps.map((step) => [step.id, step]))
    const state: AgentPlanState = {
      objective: dto.objective,
      steps: dto.steps.map((step) => ({ ...step, status: previous.get(step.id)?.status ?? 'pending' }))
    }
    validateGraph(state)
    const incoming = new Map(state.steps.map((step) => [step.id, step]))
    const protectedSteps = current?.state.steps.filter((step) => step.status !== 'pending') ?? []
    for (const step of protectedSteps) {
      const replacement = incoming.get(step.id)
      if (
        !replacement ||
        replacement.title !== step.title ||
        JSON.stringify(replacement.dependencyIds) !== JSON.stringify(step.dependencyIds)
      ) {
        invalid('Only pending steps can be changed or removed')
      }
    }
    const protectedIds = new Set(protectedSteps.map((step) => step.id))
    if (
      JSON.stringify(state.steps.filter((step) => protectedIds.has(step.id)).map((step) => step.id)) !==
      JSON.stringify(protectedSteps.map((step) => step.id))
    ) {
      invalid('Recorded work cannot be reordered')
    }
    const added = state.steps.filter((step) => !previous.has(step.id))
    if (
      current &&
      added.length &&
      tx
        .select({ id: identities.stepId })
        .from(identities)
        .where(
          and(
            eq(identities.planId, current.id),
            inArray(
              identities.stepId,
              added.map((step) => step.id)
            )
          )
        )
        .get()
    )
      invalid('Removed step identities cannot be reused')
    if (current && JSON.stringify(current.state) === JSON.stringify(state))
      return { plan: rowToEntity(current), changed: false }
    const revision = dto.expectedRevision + 1
    const row = current
      ? tx.update(plans).set({ revision, state }).where(eq(plans.id, current.id)).returning().get()!
      : tx.insert(plans).values({ sessionId, revision, state }).returning().get()!
    if (added.length)
      tx.insert(identities)
        .values(added.map((step) => ({ planId: row.id, stepId: step.id })))
        .run()
    tx.insert(history).values({ planId: row.id, revision, state, origin: 'user-edit' }).run()
    return { plan: rowToEntity(row), changed: true }
  }
}

export const agentPlanService = new AgentPlanService()

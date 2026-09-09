/**
 * Prompt Service - handles prompt CRUD and ordering
 *
 * Invariants maintained by this service:
 * - Visibility: global prompts are available to every target; restricted prompts
 *   are available only through an explicit binding.
 * - Ordering: the prompt row owns catalog/global order; each binding owns its
 *   target-specific order. Callers never touch `orderKey` directly.
 */

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable } from '@data/db/schemas/agent'
import { assistantTable } from '@data/db/schemas/assistant'
import { promptBindingTable, promptTable } from '@data/db/schemas/prompt'
import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { CreatePromptDto, ListPromptsQuery, UpdatePromptDto } from '@shared/data/api/schemas/prompts'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import type {
  Prompt,
  PromptBindingRelation,
  PromptBindingTarget,
  PromptBindingTargetType
} from '@shared/data/types/prompt'
import { PromptContentSchema, PromptTitleSchema } from '@shared/data/types/prompt'
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'

import { applyMoves, insertManyWithOrderKey, insertWithOrderKey } from './utils/orderKey'
import { nullsToUndefined, timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:PromptService')

function rowToPrompt(row: typeof promptTable.$inferSelect): Prompt {
  const clean = nullsToUndefined(row)
  return {
    ...clean,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

/**
 * Extract any `before`/`after` id referenced by a set of anchors. Reorder
 * callers feed these into the existence pre-check so that a missing anchor
 * surfaces as `NOT_FOUND` from the handler, not a 500 from `applyMoves`.
 */
function collectAnchorIds(anchors: OrderRequest[]): string[] {
  const ids: string[] = []
  for (const anchor of anchors) {
    if ('before' in anchor) ids.push(anchor.before)
    if ('after' in anchor) ids.push(anchor.after)
  }
  return ids
}

function bindingTargetCondition(target: PromptBindingTarget): SQL {
  return and(eq(promptBindingTable.targetType, target.type), eq(promptBindingTable.targetId, target.id))!
}

function bindingTargetKey(target: PromptBindingTarget): string {
  return `${target.type}:${target.id}`
}

function bindingMembershipEffects(promptIds?: readonly string[], includePromptList = true): DataApiDataChangeEffect[] {
  const effects: DataApiDataChangeEffect[] = [
    { endpoint: '/prompt-bindings', kind: 'membership', entityIds: promptIds },
    { endpoint: '/prompt-bindings/:targetType/:targetId', kind: 'membership', entityIds: promptIds },
    { endpoint: '/prompts/:id/bindings', kind: 'membership' }
  ]
  if (includePromptList) {
    effects.unshift({ endpoint: '/prompts', kind: 'membership', entityIds: promptIds })
  }
  return effects
}

export class PromptService {
  private get db() {
    return application.get('DbService').getDb()
  }

  list(query: ListPromptsQuery = {}): Prompt[] {
    // Canonical API order follows the persisted fractional order keys.
    const conditions: SQL[] = []
    if (query.search) {
      const pattern = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
      const titleMatch = sql`${promptTable.title} LIKE ${pattern} ESCAPE '\\'`
      const contentMatch = sql`${promptTable.content} LIKE ${pattern} ESCAPE '\\'`
      const searchClause = or(titleMatch, contentMatch)
      if (searchClause) conditions.push(searchClause)
    }
    if ('visibility' in query && query.visibility) {
      conditions.push(eq(promptTable.visibility, query.visibility))
    }

    if ('targetType' in query) {
      const target = { type: query.targetType, id: query.targetId } as PromptBindingTarget
      const boundPrompts = this.listBoundToTargetMatching(target, conditions)
      if (!query.includeGlobal) return boundPrompts

      const globalRows = this.db
        .select()
        .from(promptTable)
        .where(and(...conditions, eq(promptTable.visibility, 'global')))
        .orderBy(asc(promptTable.orderKey))
        .all()
      return [...boundPrompts, ...globalRows.map(rowToPrompt)]
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined
    const rows = this.db.select().from(promptTable).where(whereClause).orderBy(asc(promptTable.orderKey)).all()
    return rows.map(rowToPrompt)
  }

  listBindingRelations(): PromptBindingRelation[] {
    return this.db
      .select({
        promptId: promptBindingTable.promptId,
        targetType: promptBindingTable.targetType,
        targetId: promptBindingTable.targetId
      })
      .from(promptBindingTable)
      .orderBy(asc(promptBindingTable.targetType), asc(promptBindingTable.targetId), asc(promptBindingTable.promptId))
      .all()
  }

  listBoundToTarget(target: PromptBindingTarget): Prompt[] {
    return this.listBoundToTargetMatching(target, [])
  }

  private listBoundToTargetMatching(target: PromptBindingTarget, conditions: SQL[]): Prompt[] {
    const rows = this.db
      .select({ prompt: promptTable })
      .from(promptBindingTable)
      .innerJoin(promptTable, eq(promptBindingTable.promptId, promptTable.id))
      .where(and(...conditions, eq(promptTable.visibility, 'restricted'), bindingTargetCondition(target)))
      .orderBy(asc(promptBindingTable.orderKey))
      .all()
    return rows.map((row) => rowToPrompt(row.prompt))
  }

  listBindings(promptId: string): PromptBindingTarget[] {
    this.getById(promptId)
    return this.listBindingsTx(this.db, promptId)
  }

  private listBindingsTx(tx: Pick<DbType, 'select'>, promptId: string): PromptBindingTarget[] {
    const rows = tx
      .select({ type: promptBindingTable.targetType, id: promptBindingTable.targetId })
      .from(promptBindingTable)
      .where(eq(promptBindingTable.promptId, promptId))
      .orderBy(asc(promptBindingTable.targetType), asc(promptBindingTable.targetId))
      .all()
    return rows.map((row) =>
      row.type === 'assistant' ? { type: 'assistant', id: row.id } : { type: 'agent', id: row.id }
    )
  }

  createRestrictedForTargetTx(
    tx: Pick<DbType, 'insert' | 'select'>,
    target: PromptBindingTarget,
    phrases: ReadonlyArray<{ title: string; content: string }>
  ): string[] {
    if (phrases.length === 0) return []
    this.assertBindingTargetExistsTx(tx, target)

    const promptValues = phrases.map((phrase) => ({
      title: PromptTitleSchema.parse(phrase.title),
      content: PromptContentSchema.parse(phrase.content),
      visibility: 'restricted' as const
    }))
    const prompts = insertManyWithOrderKey(tx, promptTable, promptValues, { pkColumn: promptTable.id }) as Array<
      typeof promptTable.$inferSelect
    >
    insertManyWithOrderKey(
      tx,
      promptBindingTable,
      prompts.map((prompt) => ({ promptId: prompt.id, targetType: target.type, targetId: target.id })),
      { pkColumn: promptBindingTable.promptId, scope: bindingTargetCondition(target) }
    )
    return prompts.map((prompt) => prompt.id)
  }

  cloneBindingsForTargetTx(
    tx: Pick<DbType, 'insert' | 'select'>,
    source: PromptBindingTarget,
    target: PromptBindingTarget
  ): string[] {
    const bindings = tx
      .select({ promptId: promptBindingTable.promptId })
      .from(promptBindingTable)
      .where(bindingTargetCondition(source))
      .orderBy(asc(promptBindingTable.orderKey))
      .all()
    if (bindings.length === 0) return []

    this.assertBindingTargetExistsTx(tx, target)
    insertManyWithOrderKey(
      tx,
      promptBindingTable,
      bindings.map((binding) => ({
        promptId: binding.promptId,
        targetType: target.type,
        targetId: target.id
      })),
      { pkColumn: promptBindingTable.promptId, scope: bindingTargetCondition(target) }
    )
    return bindings.map((binding) => binding.promptId)
  }

  getById(id: string): Prompt {
    const [row] = this.db.select().from(promptTable).where(eq(promptTable.id, id)).limit(1).all()
    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    return rowToPrompt(row)
  }

  create(dto: CreatePromptDto): Prompt {
    const prompt = application.get('DbService').withWriteTx((tx) => {
      if (dto.bindingTarget) {
        if (dto.visibility !== 'restricted') {
          throw DataApiErrorFactory.invalidOperation(
            'create prompt binding',
            'global prompts are already available to every target'
          )
        }
        this.assertBindingTargetExistsTx(tx, dto.bindingTarget)
      }

      const inserted = insertWithOrderKey(
        tx,
        promptTable,
        {
          title: dto.title,
          content: dto.content,
          visibility: dto.visibility
        },
        { pkColumn: promptTable.id }
      )
      const row = inserted as typeof promptTable.$inferSelect

      if (dto.bindingTarget) {
        insertWithOrderKey(
          tx,
          promptBindingTable,
          {
            promptId: row.id,
            targetType: dto.bindingTarget.type,
            targetId: dto.bindingTarget.id
          },
          {
            pkColumn: promptBindingTable.promptId,
            scope: bindingTargetCondition(dto.bindingTarget)
          }
        )
      }

      logger.info('Created prompt', { id: row.id, bindingTarget: dto.bindingTarget })
      return rowToPrompt(row)
    })
    const effects: DataApiDataChangeEffect[] = [
      { endpoint: '/prompts', kind: 'membership', entityIds: [prompt.id] },
      { endpoint: '/prompts/:id', entityIds: [prompt.id] }
    ]
    if (dto.bindingTarget) effects.push(...bindingMembershipEffects([prompt.id], false))
    notifyDataApiDataChange(effects)
    return prompt
  }

  bindToTarget(promptId: string, target: PromptBindingTarget): void {
    const changed = application.get('DbService').withWriteTx((tx) => {
      this.assertPromptIsRestrictedTx(tx, promptId, 'bind prompt')
      this.assertBindingTargetExistsTx(tx, target)
      const targetScope = bindingTargetCondition(target)
      const existing = tx
        .select({ promptId: promptBindingTable.promptId })
        .from(promptBindingTable)
        .where(and(eq(promptBindingTable.promptId, promptId), targetScope))
        .limit(1)
        .get()
      if (existing) return false

      insertWithOrderKey(
        tx,
        promptBindingTable,
        { promptId, targetType: target.type, targetId: target.id },
        { pkColumn: promptBindingTable.promptId, scope: targetScope }
      )
      return true
    })
    if (!changed) return
    logger.info('Bound prompt to target', { promptId, target })
    notifyDataApiDataChange(bindingMembershipEffects([promptId]))
  }

  unbindFromTarget(promptId: string, target: PromptBindingTarget): void {
    const changed = application.get('DbService').withWriteTx((tx) => {
      this.assertPromptIsRestrictedTx(tx, promptId, 'unbind prompt')
      const result = tx
        .delete(promptBindingTable)
        .where(
          and(
            eq(promptBindingTable.promptId, promptId),
            eq(promptBindingTable.targetType, target.type),
            eq(promptBindingTable.targetId, target.id)
          )
        )
        .run()
      return result.changes > 0
    })
    if (!changed) return
    logger.info('Unbound prompt from target', { promptId, target })
    notifyDataApiDataChange(bindingMembershipEffects([promptId]))
  }

  purgeForTargetTx(tx: Pick<DbType, 'delete'>, targetType: PromptBindingTargetType, targetId: string): void {
    tx.delete(promptBindingTable)
      .where(and(eq(promptBindingTable.targetType, targetType), eq(promptBindingTable.targetId, targetId)))
      .run()
    logger.info('Purged prompt bindings for target', { targetType, targetId })
  }

  /** Bulk form for retention purges — bindings are polymorphic, so no FK reclaims them. */
  purgeForTargetsTx(tx: Pick<DbType, 'delete'>, targetType: PromptBindingTargetType, targetIds: string[]): void {
    if (targetIds.length === 0) return
    tx.delete(promptBindingTable)
      .where(and(eq(promptBindingTable.targetType, targetType), inArray(promptBindingTable.targetId, targetIds)))
      .run()
    logger.info('Purged prompt bindings for targets', { targetType, count: targetIds.length })
  }

  update(id: string, dto: UpdatePromptDto): Prompt {
    const { prompt, clearedBindings } = application.get('DbService').withWriteTx((tx) => {
      const existing = tx
        .select({ id: promptTable.id, visibility: promptTable.visibility })
        .from(promptTable)
        .where(eq(promptTable.id, id))
        .limit(1)
        .get()
      if (!existing) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      const isMakingGlobal = existing.visibility === 'restricted' && dto.visibility === 'global'
      if (isMakingGlobal) {
        const actualBindings = this.listBindingsTx(tx, id)
        const expectedKeys = dto.expectedBindings?.map(bindingTargetKey).sort()
        const actualKeys = actualBindings.map(bindingTargetKey).sort()
        const hasExactSnapshot =
          expectedKeys !== undefined &&
          expectedKeys.length === actualKeys.length &&
          expectedKeys.every((key, index) => key === actualKeys[index])

        if (
          (actualKeys.length > 0 && expectedKeys === undefined) ||
          (expectedKeys !== undefined && !hasExactSnapshot)
        ) {
          throw DataApiErrorFactory.concurrentModification('Prompt bindings', id)
        }
      }

      const updates: Partial<typeof promptTable.$inferInsert> = {}
      if (dto.title !== undefined) updates.title = dto.title
      if (dto.content !== undefined) updates.content = dto.content
      if (dto.visibility !== undefined) updates.visibility = dto.visibility

      tx.update(promptTable).set(updates).where(eq(promptTable.id, id)).run()
      let clearedBindings = false
      if (isMakingGlobal) {
        clearedBindings = tx.delete(promptBindingTable).where(eq(promptBindingTable.promptId, id)).run().changes > 0
      }

      const [row] = tx.select().from(promptTable).where(eq(promptTable.id, id)).limit(1).all()
      if (!row) {
        throw DataApiErrorFactory.notFound('Prompt', id)
      }

      logger.info('Updated prompt', { id, changes: Object.keys(dto) })
      return { prompt: rowToPrompt(row), clearedBindings }
    })
    const effects: DataApiDataChangeEffect[] = [
      { endpoint: '/prompts', kind: 'projection', entityIds: [id] },
      { endpoint: '/prompts', kind: 'membership', entityIds: [id] },
      { endpoint: '/prompts/:id', entityIds: [id] },
      { endpoint: '/prompt-bindings/:targetType/:targetId', kind: 'projection', entityIds: [id] }
    ]
    if (clearedBindings) effects.push(...bindingMembershipEffects([id], false))
    notifyDataApiDataChange(effects)
    return prompt
  }

  /** Move a single prompt relative to an anchor. */
  reorder(id: string, anchor: OrderRequest): void {
    application.get('DbService').withWriteTx((tx) => {
      this.assertPromptsExistTx(tx, [id, ...collectAnchorIds([anchor])])
      applyMoves(tx, promptTable, [{ id, anchor }], { pkColumn: promptTable.id })
    })
    notifyDataApiDataChange([{ endpoint: '/prompts', kind: 'order', dimension: 'orderKey', entityIds: [id] }])
  }

  /** Apply a batch of moves atomically. */
  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    application.get('DbService').withWriteTx((tx) => {
      this.assertPromptsExistTx(tx, [...moves.map((m) => m.id), ...collectAnchorIds(moves.map((m) => m.anchor))])
      applyMoves(tx, promptTable, moves, { pkColumn: promptTable.id })
    })
    notifyDataApiDataChange([
      { endpoint: '/prompts', kind: 'order', dimension: 'orderKey', entityIds: moves.map((move) => move.id) }
    ])
  }

  reorderBinding(target: PromptBindingTarget, promptId: string, anchor: OrderRequest): void {
    application.get('DbService').withWriteTx((tx) => {
      this.assertBindingTargetExistsTx(tx, target)
      applyMoves(tx, promptBindingTable, [{ id: promptId, anchor }], {
        pkColumn: promptBindingTable.promptId,
        scope: bindingTargetCondition(target)
      })
    })
    notifyDataApiDataChange([
      { endpoint: '/prompts', kind: 'order', dimension: 'orderKey', entityIds: [promptId] },
      {
        endpoint: '/prompt-bindings/:targetType/:targetId',
        kind: 'order',
        dimension: 'orderKey',
        entityIds: [promptId]
      }
    ])
  }

  reorderBindings(target: PromptBindingTarget, moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    application.get('DbService').withWriteTx((tx) => {
      this.assertBindingTargetExistsTx(tx, target)
      applyMoves(tx, promptBindingTable, moves, {
        pkColumn: promptBindingTable.promptId,
        scope: bindingTargetCondition(target)
      })
    })
    const promptIds = moves.map((move) => move.id)
    notifyDataApiDataChange([
      { endpoint: '/prompts', kind: 'order', dimension: 'orderKey', entityIds: promptIds },
      {
        endpoint: '/prompt-bindings/:targetType/:targetId',
        kind: 'order',
        dimension: 'orderKey',
        entityIds: promptIds
      }
    ])
  }

  notifyTargetBindingsChanged(): void {
    notifyDataApiDataChange(bindingMembershipEffects())
  }

  /** Pre-check that every id in a reorder exists; convert to NOT_FOUND otherwise. */
  private assertPromptsExistTx(tx: Pick<DbType, 'select'>, ids: string[]): void {
    const uniqueIds = Array.from(new Set(ids))
    const rows = tx
      .select({ id: promptTable.id })
      .from(promptTable)
      .where(inArray(promptTable.id, uniqueIds))
      .all() as Array<{ id: string }>
    if (rows.length === uniqueIds.length) return
    const found = new Set(rows.map((r) => r.id))
    const missing = uniqueIds.find((id) => !found.has(id)) ?? uniqueIds[0]
    throw DataApiErrorFactory.notFound('Prompt', missing)
  }

  private assertPromptIsRestrictedTx(tx: Pick<DbType, 'select'>, id: string, operation: string): void {
    const row = tx
      .select({ id: promptTable.id, visibility: promptTable.visibility })
      .from(promptTable)
      .where(eq(promptTable.id, id))
      .limit(1)
      .get()
    if (!row) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    if (row.visibility !== 'restricted') {
      throw DataApiErrorFactory.invalidOperation(operation, 'global prompts are already available to every target')
    }
  }

  private assertBindingTargetExistsTx(tx: Pick<DbType, 'select'>, target: PromptBindingTarget): void {
    const row =
      target.type === 'assistant'
        ? tx
            .select({ id: assistantTable.id })
            .from(assistantTable)
            .where(and(eq(assistantTable.id, target.id), isNull(assistantTable.deletedAt)))
            .limit(1)
            .get()
        : tx
            .select({ id: agentTable.id })
            .from(agentTable)
            .where(and(eq(agentTable.id, target.id), isNull(agentTable.deletedAt)))
            .limit(1)
            .get()
    if (!row) {
      throw DataApiErrorFactory.notFound(target.type === 'assistant' ? 'Assistant' : 'Agent', target.id)
    }
  }

  delete(id: string): void {
    const result = this.db.delete(promptTable).where(eq(promptTable.id, id)).run()
    if (result.changes === 0) {
      throw DataApiErrorFactory.notFound('Prompt', id)
    }
    logger.info('Deleted prompt', { id })
    notifyDataApiDataChange([
      { endpoint: '/prompts', kind: 'membership', entityIds: [id] },
      { endpoint: '/prompts/:id', entityIds: [id] },
      { endpoint: '/prompt-bindings', kind: 'membership', entityIds: [id] },
      { endpoint: '/prompt-bindings/:targetType/:targetId', kind: 'membership', entityIds: [id] },
      { endpoint: '/prompts/:id/bindings', kind: 'membership' }
    ])
  }
}

export const promptService = new PromptService()

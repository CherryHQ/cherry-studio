import { userModelTable } from '@data/db/schemas/userModel'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { eq, or, sql } from 'drizzle-orm'

const logger = loggerService.withContext('resolveUserModelId')

/**
 * Resolve a model identifier into the matching `user_model.id` (UniqueModelId,
 * `providerId::modelId`). Accepts both the canonical form and the legacy
 * `providerId:modelId` shape used by the OpenAI-compatible `/v1/models`
 * endpoint and by `apiServer/utils.transformModelToOpenAI`.
 *
 * Returns `null` for null/undefined/empty input or when no `user_model` row
 * matches — which is the value the FK (`ON DELETE SET NULL`) accepts.
 *
 * The same lookup shape is used by `AgentsDbMappings.buildUserModelLookupExpr`
 * for v1 → v2 import, so legacy → FK normalization has exactly one form.
 */
export async function resolveUserModelId(db: DbOrTx, value: string | null | undefined): Promise<string | null> {
  if (!value) return null

  const [row] = await db
    .select({ id: userModelTable.id })
    .from(userModelTable)
    .where(
      or(eq(userModelTable.id, value), eq(sql`${userModelTable.providerId} || ':' || ${userModelTable.modelId}`, value))
    )
    .limit(1)

  if (!row) {
    logger.warn('Model value does not resolve to a user_model row; storing NULL', { value })
    return null
  }
  return row.id
}

/** Resolve the `model` / `planModel` / `smallModel` triple in parallel. */
export async function resolveAgentModelIds(
  db: DbOrTx,
  models: { model?: string | null; planModel?: string | null; smallModel?: string | null }
): Promise<{ model: string | null; planModel: string | null; smallModel: string | null }> {
  const [model, planModel, smallModel] = await Promise.all([
    resolveUserModelId(db, models.model),
    resolveUserModelId(db, models.planModel),
    resolveUserModelId(db, models.smallModel)
  ])
  return { model, planModel, smallModel }
}

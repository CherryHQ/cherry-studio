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

/** Fields on agent / agent_session whose values are FK-constrained to `user_model.id`. */
const AGENT_MODEL_FK_FIELDS = ['model', 'planModel', 'smallModel'] as const

/**
 * Single normalization boundary used by every agent / session write path
 * (`AgentService.createAgent` / `updateAgent`, `AgentSessionService.createSession`
 * / `updateSession`). Mutates `target` in place: any FK-constrained model field
 * present on the object is rewritten through `resolveUserModelId` so the FK
 * holds. Fields not present on `target` are left untouched, so partial-update
 * payloads (which only carry the fields the caller is changing) do not
 * accidentally null out untouched columns.
 *
 * The parameter is typed as `object` (not a generic) on purpose: a generic
 * `T extends Record<string, unknown>` would widen the caller's variable type
 * after the await — every field would become `unknown` — which is the wrong
 * trade for a side-effecting helper. Returning `void` keeps the caller's
 * narrow type intact.
 */
export async function resolveAgentModelFieldsInPlace(db: DbOrTx, target: object): Promise<void> {
  const record = target as Record<string, unknown>
  await Promise.all(
    AGENT_MODEL_FK_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(record, field)).map(async (field) => {
      const raw = record[field] as string | null | undefined
      record[field] = await resolveUserModelId(db, raw)
    })
  )
}

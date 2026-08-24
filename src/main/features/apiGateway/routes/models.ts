import { Elysia } from 'elysia'
import * as z from 'zod'

import { DOC_DESCRIPTIONS, DOC_TAGS } from '../openapiDocs'
import { getModels } from '../utils/models'

/** Query filter for `/v1/models`. Coerces string query params to numbers. */
const ApiModelsFilterSchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).optional()
})

/**
 * `GET /v1/models`. `getModels` never throws (returns an empty
 * list on failure), so unexpected errors fall through to the global `onError`.
 *
 * `detail.tags`/`summary` stay in English; only `description` is localized — see chat.ts.
 */
export const modelsRoutes = new Elysia({ prefix: '/models' }).get('/', ({ query }) => getModels(query), {
  query: ApiModelsFilterSchema,
  detail: { tags: [DOC_TAGS.openai], summary: 'Models', description: DOC_DESCRIPTIONS.list_models }
})

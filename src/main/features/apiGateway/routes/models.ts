import { Elysia } from 'elysia'
import * as z from 'zod'

import { getModels } from '../utils/models'

/** Query filter for `/v1/models`. Coerces string query params to numbers. */
const ApiModelsFilterSchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).optional()
})

/**
 * `GET /v1/models`. `getModels` never throws (returns an empty
 * list on failure), so unexpected errors fall through to the global `onError`.
 */
export const modelsRoutes = new Elysia({ prefix: '/models' }).get('/', ({ query }) => getModels(query), {
  query: ApiModelsFilterSchema,
  detail: { tags: ['Models'], summary: 'List available models' }
})

/**
 * Cross-resource endpoint building blocks.
 *
 * Home for shared constructs that compose into `ApiSchemas` entries — both the
 * runtime Zod schemas that handlers validate against and the type-level
 * helpers that inject whole endpoint definitions (path + method + params +
 * body + response) into a resource's schema map. Consumed by resource schema
 * files (e.g. `topics.ts`, `miniapps.ts`), main-side handlers, and renderer
 * hooks.
 *
 * The leading underscore mirrors `src/main/data/db/schemas/_columnHelpers.ts`
 * and signals "not a resource — a shared building block". The filename is
 * intentionally wide-scope so future cross-resource constructs (pagination,
 * filtering, batch wrappers, reset variants) can live here without spawning
 * new `_xxxHelpers.ts` files.
 *
 * Future extension point:
 * Resources supporting group-scoped ordering (e.g. future topic) may extend
 * OrderRequestSchema in their own schema file by adding an optional
 * `groupId: string`. See `docs/references/data/data-ordering-guide.md` for
 * the grouping extension story.
 */

import * as z from 'zod'

// ============================================================================
// Zod schemas — runtime validation
// ============================================================================

/**
 * Anchor describing where to place an item relative to siblings.
 * Exactly one of `before` / `after` / `position` must be provided.
 */
export const OrderRequestSchema = z.union([
  z.object({ before: z.string().min(1) }).strict(),
  z.object({ after: z.string().min(1) }).strict(),
  z.object({ position: z.enum(['first', 'last']) }).strict()
])
export type OrderRequest = z.infer<typeof OrderRequestSchema>

/**
 * Body shape for batch reorder endpoints.
 * Each move pairs a target item id with an `OrderRequest` anchor.
 */
export const OrderBatchRequestSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.string().min(1),
        anchor: OrderRequestSchema
      })
    )
    .min(1)
})
export type OrderBatchRequest = z.infer<typeof OrderBatchRequestSchema>

// Reset-endpoint body shapes are NOT factored into a shared factory.
// Each resource expands the shape inline in its own schema file:
//   z.object({ preset: z.enum(['alphabetical', 'default']) }).strict()
// Rationale: keeps resource-specific preset vocabularies greppable and self-contained.

// ============================================================================
// Endpoint composition — type-level
// ============================================================================

/**
 * Compose the two canonical order endpoints for a collection resource in one
 * shot. Intersect this with the resource's schema type to inject:
 *
 *   `${TRes}/:id/order`        PATCH { params:{id}; body: OrderRequest;       response: void }
 *   `${TRes}/order:batch`      PATCH { body: OrderBatchRequest;                response: void }
 *
 * Usage in a resource schema file:
 *
 *   export type MiniappSchemas = {
 *     '/mini-apps': { GET: {...}, POST: {...} }
 *     '/mini-apps/:id': { ... }
 *   } & OrderEndpoints<'/mini-apps'>
 *
 * Why a type-only helper (no runtime factory):
 * - ApiSchemas is a pure compile-time map whose literal keys (e.g.
 *   `/mini-apps/:id/order`) drive `TemplateApiPaths` / `ConcreteApiPaths`.
 *   A runtime factory would not change what TypeScript sees, but a mapped type
 *   does — one import, one intersection, and the two endpoints become callable
 *   with full type safety via `useQuery` / `useMutation` / `useReorder`.
 * - Runtime validation for each endpoint body still lives in the Zod schemas
 *   above; handlers call `OrderRequestSchema.parse(body)` or
 *   `OrderBatchRequestSchema.parse(body)` exactly as before.
 */
export type OrderEndpoints<TRes extends string> = {
  [P in `${TRes}/:id/order`]: {
    PATCH: {
      params: { id: string }
      body: OrderRequest
      response: void
    }
  }
} & {
  [P in `${TRes}/order:batch`]: {
    PATCH: {
      body: OrderBatchRequest
      response: void
    }
  }
}

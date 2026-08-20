/**
 * Type-safety regression test matrix for `HandlersFor<Schemas>`.
 *
 * This file has NO runtime tests. It exists solely to be typechecked by tsgo
 * (covered by tsconfig.node.json / `pnpm typecheck:node`). Vitest ignores it
 * because the filename does not contain `.test.` or `.spec.`.
 *
 * Every `@ts-expect-error` directive is a compile-time assertion: if the
 * expected error does not occur, tsgo produces "Unused '@ts-expect-error'
 * directive" and typecheck fails. So running `pnpm typecheck:node` with
 * zero diagnostics in this file proves the entire matrix holds.
 */

import type { TopicSchemas } from '@shared/data/api/schemas/topics'
import type { HandlersFor } from '@shared/data/api/types'

// Response shapes are complex zod-inferred types; the matrix tests
// path/method/param invariants, not response types, so short-circuit via cast.
const ok = async (): Promise<any> => ({}) as any
const assistantTopicsDeleteHandler = {
  '/assistants/:assistantId/topics': { DELETE: ok }
} satisfies Pick<HandlersFor<TopicSchemas>, '/assistants/:assistantId/topics'>
const topicMoveHandler = {
  '/topics/:id/move': { POST: ok }
} satisfies Pick<HandlersFor<TopicSchemas>, '/topics/:id/move'>

// ============================================================================
// P1 — POSITIVE: a fully-covered, correctly-typed handler compiles. This
// anchors the matrix: every negative case below removes or warps one dimension.
// ============================================================================

const _p1: HandlersFor<TopicSchemas> = {
  '/topics': { GET: ok, POST: ok, DELETE: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler
}

// ============================================================================
// N1 — NEGATIVE: missing entire path(s). Exhaustiveness must reject this.
// ============================================================================

// @ts-expect-error - all '/topics/:id*' paths missing
const _n1: HandlersFor<TopicSchemas> = {
  '/topics': { GET: ok, POST: ok, DELETE: ok }
}

// ============================================================================
// N2 — NEGATIVE: missing one method on a present path. Intra-path method
// exhaustiveness must reject this.
// ============================================================================

const _n2: HandlersFor<TopicSchemas> = {
  '/topics': { GET: ok, POST: ok, DELETE: ok },
  // @ts-expect-error - DELETE missing on '/topics/:id'
  '/topics/:id': { GET: ok, PATCH: ok },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler
}

// ============================================================================
// N3 — NEGATIVE: extra path not in this module's schema (e.g. typo). Excess
// property check must reject this.
// ============================================================================

const _n3: HandlersFor<TopicSchemas> = {
  '/topics': { GET: ok, POST: ok, DELETE: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler,
  // @ts-expect-error - '/tpoic' is a typo; not in TopicSchemas
  '/tpoic': { GET: ok }
}

// ============================================================================
// N4 — NEGATIVE: cross-module path leak. `/messages/:id` exists in ApiSchemas
// (via MessageSchemas) but not in TopicSchemas; a path narrowing that only
// looked at ApiPaths would incorrectly accept it.
// ============================================================================

const _n4: HandlersFor<TopicSchemas> = {
  '/topics': { GET: ok, POST: ok, DELETE: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler,
  // @ts-expect-error - '/messages/:id' belongs to MessageSchemas, not TopicSchemas
  '/messages/:id': { GET: ok }
}

// ============================================================================
// N5 — NEGATIVE: extra method on an otherwise-valid path (method not declared
// in schema). TopicSchemas['/topics'] declares GET + POST + DELETE; PUT must be
// rejected even though it is a valid HTTP method elsewhere.
// ============================================================================

const _n5: HandlersFor<TopicSchemas> = {
  '/topics': {
    GET: ok,
    POST: ok,
    DELETE: ok,
    // @ts-expect-error - PUT not declared on '/topics' in TopicSchemas
    PUT: ok
  },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler
}

// ============================================================================
// N6 — NEGATIVE: wrong param name. Schema declares `params: { id: string }`
// for `/topics/:id`; accessing `params.wrongKey` must be rejected.
// ============================================================================

const _n6: HandlersFor<TopicSchemas> = {
  '/topics': { GET: ok, POST: ok, DELETE: ok },
  '/topics/:id': {
    GET: async ({ params }) => {
      // @ts-expect-error - 'wrongKey' does not exist on params (only 'id' does)
      void params.wrongKey
      return {} as any
    },
    PATCH: ok,
    DELETE: async () => undefined
  },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler
}

// ============================================================================
// N7 — NEGATIVE: wrong body field. POST /topics has body: CreateTopicDto
// (fields: name/assistantId, both optional). Accessing a field that is not in
// the DTO must be rejected.
// ============================================================================

const _n7: HandlersFor<TopicSchemas> = {
  '/topics': {
    GET: ok,
    DELETE: ok,
    POST: async ({ body }) => {
      // @ts-expect-error - 'nonExistentField' is not part of CreateTopicDto
      void body?.nonExistentField
      return {} as any
    }
  },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/latest': { GET: ok },
  '/topics/reusable-placeholder': { POST: ok },
  '/topics/stats': { GET: ok },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/duplicate': { POST: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined },
  ...assistantTopicsDeleteHandler,
  ...topicMoveHandler
}

// Prevent "declared but never used" diagnostics — these are type-level probes.
void _p1
void _n1
void _n2
void _n3
void _n4
void _n5
void _n6
void _n7

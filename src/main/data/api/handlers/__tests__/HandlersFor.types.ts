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
 *
 * The matrix is run twice per case: once against the new `HandlersFor<>`
 * helper, once against the old hand-rolled mapped type (kept here as the
 * control). Any future divergence in safety guarantees is caught
 * automatically.
 */

import type { ApiHandler, ApiMethods, HandlersFor } from '@shared/data/api/apiTypes'
import type { TopicSchemas } from '@shared/data/api/schemas/topics'

// ----------------------------------------------------------------------------
// Control: the pre-refactor hand-rolled mapped type, verbatim from how each
// handler file used to express its shape. Kept here as an equivalence anchor.
// ----------------------------------------------------------------------------

type OldTopicHandler<Path extends keyof TopicSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>
type OldTopicHandlers = {
  [Path in keyof TopicSchemas]: {
    [Method in keyof TopicSchemas[Path]]: OldTopicHandler<Path, Method & ApiMethods<Path>>
  }
}

// Response shapes are complex zod-inferred types; the matrix tests
// path/method/param invariants, not response types, so short-circuit via cast.
const ok = async (): Promise<any> => ({}) as any

// ============================================================================
// P1 — POSITIVE: a fully-covered, correctly-typed handler compiles under both
// patterns. This anchors the matrix: every negative case below removes or
// warps exactly one dimension from this shape.
// ============================================================================

const _p1_new: HandlersFor<TopicSchemas> = {
  '/topics': { POST: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok }
}

const _p1_old: OldTopicHandlers = {
  '/topics': { POST: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok }
}

// ============================================================================
// N1 — NEGATIVE: missing entire path(s). Exhaustiveness must reject this.
// ============================================================================

// @ts-expect-error - '/topics/:id' and '/topics/:id/active-node' missing
const _n1_new: HandlersFor<TopicSchemas> = {
  '/topics': { POST: ok }
}

// @ts-expect-error - '/topics/:id' and '/topics/:id/active-node' missing
const _n1_old: OldTopicHandlers = {
  '/topics': { POST: ok }
}

// ============================================================================
// N2 — NEGATIVE: missing one method on a present path. Intra-path method
// exhaustiveness must reject this.
// ============================================================================

const _n2_new: HandlersFor<TopicSchemas> = {
  '/topics': { POST: ok },
  // @ts-expect-error - DELETE missing on '/topics/:id'
  '/topics/:id': { GET: ok, PATCH: ok },
  '/topics/:id/active-node': { PUT: ok }
}

const _n2_old: OldTopicHandlers = {
  '/topics': { POST: ok },
  // @ts-expect-error - DELETE missing on '/topics/:id'
  '/topics/:id': { GET: ok, PATCH: ok },
  '/topics/:id/active-node': { PUT: ok }
}

// ============================================================================
// N3 — NEGATIVE: extra path not in this module's schema (e.g. typo). Excess
// property check must reject this.
// ============================================================================

const _n3_new: HandlersFor<TopicSchemas> = {
  '/topics': { POST: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok },
  // @ts-expect-error - '/tpoic' is a typo; not in TopicSchemas
  '/tpoic': { GET: ok }
}

const _n3_old: OldTopicHandlers = {
  '/topics': { POST: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok },
  // @ts-expect-error - '/tpoic' is a typo; not in TopicSchemas
  '/tpoic': { GET: ok }
}

// ============================================================================
// N4 — NEGATIVE: cross-module path leak. `/messages/:id` exists in ApiSchemas
// (via MessageSchemas) but not in TopicSchemas; a path narrowing that only
// looked at ApiPaths would incorrectly accept it.
// ============================================================================

const _n4_new: HandlersFor<TopicSchemas> = {
  '/topics': { POST: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok },
  // @ts-expect-error - '/messages/:id' belongs to MessageSchemas, not TopicSchemas
  '/messages/:id': { GET: ok }
}

const _n4_old: OldTopicHandlers = {
  '/topics': { POST: ok },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok },
  // @ts-expect-error - '/messages/:id' belongs to MessageSchemas, not TopicSchemas
  '/messages/:id': { GET: ok }
}

// ============================================================================
// N5 — NEGATIVE: extra method on an otherwise-valid path (method not declared
// in schema). TopicSchemas['/topics'] only declares POST.
// ============================================================================

const _n5_new: HandlersFor<TopicSchemas> = {
  '/topics': {
    POST: ok,
    // @ts-expect-error - GET not declared on '/topics' in TopicSchemas
    GET: ok
  },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined }
}

const _n5_old: OldTopicHandlers = {
  '/topics': {
    POST: ok,
    // @ts-expect-error - GET not declared on '/topics' in TopicSchemas
    GET: ok
  },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok },
  '/topics/:id/order': { PATCH: async () => undefined },
  '/topics/order:batch': { PATCH: async () => undefined }
}

// ============================================================================
// N6 — NEGATIVE: wrong param name. Schema declares `params: { id: string }`
// for `/topics/:id`; accessing `params.wrongKey` must be rejected.
// ============================================================================

const _n6_new: HandlersFor<TopicSchemas> = {
  '/topics': { POST: ok },
  '/topics/:id': {
    GET: async ({ params }) => {
      // @ts-expect-error - 'wrongKey' does not exist on params (only 'id' does)
      void params.wrongKey
      return {} as any
    },
    PATCH: ok,
    DELETE: async () => undefined
  },
  '/topics/:id/active-node': { PUT: ok }
}

const _n6_old: OldTopicHandlers = {
  '/topics': { POST: ok },
  '/topics/:id': {
    GET: async ({ params }) => {
      // @ts-expect-error - 'wrongKey' does not exist on params (only 'id' does)
      void params.wrongKey
      return {} as any
    },
    PATCH: ok,
    DELETE: async () => undefined
  },
  '/topics/:id/active-node': { PUT: ok }
}

// ============================================================================
// N7 — NEGATIVE: wrong body field. POST /topics has body: CreateTopicDto
// (fields: name/assistantId/groupId/sourceNodeId, all optional). Accessing
// a field that is not in the DTO must be rejected.
// ============================================================================

const _n7_new: HandlersFor<TopicSchemas> = {
  '/topics': {
    POST: async ({ body }) => {
      // @ts-expect-error - 'nonExistentField' is not part of CreateTopicDto
      void body?.nonExistentField
      return {} as any
    }
  },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok }
}

const _n7_old: OldTopicHandlers = {
  '/topics': {
    POST: async ({ body }) => {
      // @ts-expect-error - 'nonExistentField' is not part of CreateTopicDto
      void body?.nonExistentField
      return {} as any
    }
  },
  '/topics/:id': { GET: ok, PATCH: ok, DELETE: async () => undefined },
  '/topics/:id/active-node': { PUT: ok }
}

// Prevent "declared but never used" diagnostics — these are type-level probes.
void _p1_new
void _p1_old
void _n1_new
void _n1_old
void _n2_new
void _n2_old
void _n3_new
void _n3_old
void _n4_new
void _n4_old
void _n5_new
void _n5_old
void _n6_new
void _n6_old
void _n7_new
void _n7_old

/**
 * Classification snapshot for `CollectionGetPaths` (issue #17144, section 4).
 *
 * `CollectionGetPaths` is DERIVED from each GET endpoint's response shape (array
 * or pagination response = collection, everything else = scalar); that
 * derivation is the single source of truth. This snapshot is a TRIPWIRE: the
 * explicitly listed union below must equal the derived type, so any schema
 * change that flips a path's classification (e.g. a `/foo` response gaining or
 * losing a pagination shape) turns this red and surfaces in review.
 *
 * This is intentionally NOT an `Exclude`-based "everything is classified"
 * assertion — `ScalarGetPaths = Exclude<GetTemplateApiPaths, CollectionGetPaths>`
 * makes total classification trivially (vacuously) true, so it cannot detect a
 * misclassification. Only an explicit enumeration can.
 */
import { describe, expectTypeOf, it } from 'vitest'

import type { CollectionGetPaths } from '../types'

/**
 * Every GET endpoint whose response is an array or a pagination response
 * (`CursorPaginationResponse` / `OffsetPaginationResponse`, including interfaces
 * that extend them, e.g. `BranchMessagesResponse`, `FileEntryListResponse`).
 * Wrapper-object responses (`/topics/latest`, `/files/entries/stats`,
 * `/providers/:providerId/api-keys`, `/search/*`, ...) are scalar and absent.
 */
type ExpectedCollectionGetPaths =
  | '/topics'
  | '/topics/:topicId/messages'
  | '/topics/:topicId/path'
  | '/temporary/topics/:topicId/messages'
  | '/models'
  | '/providers/:providerId/models:resolve'
  | '/providers'
  | '/paintings'
  | '/translate/histories'
  | '/translate/languages'
  | '/files/entries'
  | '/files/entries/ref-counts'
  | '/files/entries/:id/refs'
  | '/files/refs'
  | '/mcp-servers'
  | '/knowledge-bases'
  | '/knowledge-bases/:id/items'
  | '/notes'
  | '/assistants'
  | '/tags'
  | '/tags/entities/:entityType/:entityId'
  | '/prompts'
  | '/groups'
  | '/pins'
  | '/agents'
  | '/agents/:agentId/tasks'
  | '/agents/:agentId/tasks/:taskId/logs'
  | '/skills'
  | '/agent-sessions'
  | '/agent-sessions/:sessionId/messages'
  | '/agent-workspaces'
  | '/agent-channels'
  | '/jobs'
  | '/mini-apps'

describe('CollectionGetPaths classification snapshot', () => {
  it('matches the explicitly enumerated collection endpoint union', () => {
    expectTypeOf<CollectionGetPaths>().toEqualTypeOf<ExpectedCollectionGetPaths>()
  })
})

/**
 * Shared two-section keyset cursor for the "pinned-first, then manual order"
 * list contract used by both `TopicService` and `AgentSessionService`.
 *
 * A page is two concatenated sections:
 * - `pin`   — pinned entities via the shared `pin` table, ordered by `pin.orderKey ASC, id ASC`.
 * - `entity`— the remaining (unpinned) entities, ordered by `entity.orderKey ASC, id ASC`.
 *
 * A partially-filled pin section spills into the entity section within the same
 * page, so the boundary needs an explicit `entity:` section-start sentinel.
 *
 * This cannot be expressed as a single `(key, id)` tuple, so it deliberately
 * lives outside `keysetCursor.ts` (see its scope note) — but the two services
 * now share the identical contract, so the drift-prone codec lives here once
 * instead of being hand-rolled per service.
 *
 * Wire format: `pin:<pinOrderKey>` (empty `pinOrderKey` = pin section start) /
 *              `entity:<entityOrderKey>:<id>` / `entity:` (pin exhausted, entity section start).
 *
 * Stale/legacy cursors fall back to the first page (warn) instead of throwing —
 * cursors are opaque server-issued tokens, and a 422 here would lock out renderers.
 */

import { loggerService } from '@logger'

const logger = loggerService.withContext('pinnedListCursor')

export type PinnedListCursor =
  | { section: 'pin'; orderKey: string }
  | { section: 'entity'; orderKey: string; id: string }
  | { section: 'entity'; orderKey: null; id: null }

const FIRST_PAGE_CURSOR: PinnedListCursor = { section: 'pin', orderKey: '' }

/**
 * Decode a wire cursor. `undefined` (no cursor) means "first page"; a malformed
 * cursor warns once and falls back to the first page. `context` is a short
 * caller tag (e.g. `'topic'`) carried in the warn payload.
 */
export function decodePinnedListCursor(raw: string | undefined, context: string): PinnedListCursor {
  if (!raw) return FIRST_PAGE_CURSOR

  const firstColon = raw.indexOf(':')
  if (firstColon < 0) return warnAndFallback(raw, context, 'no section separator')
  const section = raw.slice(0, firstColon)
  const rest = raw.slice(firstColon + 1)

  if (section === 'pin') {
    return { section: 'pin', orderKey: rest }
  }
  if (section === 'entity') {
    if (rest === '') return { section: 'entity', orderKey: null, id: null }
    const sep = rest.indexOf(':')
    if (sep < 0) return warnAndFallback(raw, context, 'malformed entity cursor (missing id separator)')
    const orderKey = rest.slice(0, sep)
    const id = rest.slice(sep + 1)
    if (!orderKey || !id) return warnAndFallback(raw, context, 'malformed entity cursor (empty orderKey or id)')
    return { section: 'entity', orderKey, id }
  }
  return warnAndFallback(raw, context, `unknown cursor section "${section}"`)
}

function warnAndFallback(raw: string, context: string, reason: string): PinnedListCursor {
  logger.warn('decodePinnedListCursor: cursor unparseable, falling back to first page', {
    cursor: raw,
    context,
    reason
  })
  return FIRST_PAGE_CURSOR
}

export function encodePinCursor(orderKey: string): string {
  return `pin:${orderKey}`
}

export function encodeEntityCursor(orderKey: string, id: string): string {
  return `entity:${orderKey}:${id}`
}

export function encodeEntitySectionStart(): string {
  return 'entity:'
}

import { createHash } from 'node:crypto'

/** Content identity is independent of ranking, retrieval calls, and chunk offsets. */
export function knowledgeCitationId(baseId: string, conceptId: string, content: string): string {
  return `kb-${createHash('sha256')
    .update(JSON.stringify([baseId, conceptId, content]))
    .digest('hex')
    .slice(0, 24)}`
}

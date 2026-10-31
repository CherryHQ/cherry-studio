import path from 'node:path'

/** Claude Code's per-string cap on hook additionalContext, measured in UTF-16 code units. */
export const CLAUDE_HOOK_CONTEXT_MAX_UNITS = 10_000
/** Body budget per part: leaves room for the part wrapper inside the cap. */
export const CLAUDE_IDENTITY_CHUNK_UNITS = 9_600
/** Fixed number of hook slots registered per event. */
export const CLAUDE_IDENTITY_HOOK_SLOTS = 16
/** Nominal full-delivery capacity; surrogate-safe cuts can reduce it slightly. */
export const CLAUDE_IDENTITY_NOMINAL_CAPACITY_UNITS = CLAUDE_IDENTITY_HOOK_SLOTS * CLAUDE_IDENTITY_CHUNK_UNITS

function safeEnd(text: string, end: number): number {
  const before = text.charCodeAt(end - 1)
  const after = text.charCodeAt(end)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff ? end - 1 : end
}

/** Lossless, surrogate-safe slicing, preferring a nearby line boundary. No wrapping or I/O. */
export function splitIdentitySnapshot(snapshot: string, budget = CLAUDE_IDENTITY_CHUNK_UNITS): string[] {
  if (!Number.isInteger(budget) || budget < 2) throw new RangeError('Identity chunk budget must be an integer >= 2')
  const chunks: string[] = []
  for (let start = 0; start < snapshot.length;) {
    let end = safeEnd(snapshot, Math.min(start + budget, snapshot.length))
    if (end < snapshot.length) {
      const newline = snapshot.lastIndexOf('\n', end - 1) + 1
      if (newline > start) end = newline
    }
    chunks.push(snapshot.slice(start, end))
    start = end
  }
  return chunks
}

export type IdentityDelivery =
  | { kind: 'ready'; contexts: string[]; deliveredUnits: number; omittedUnits: number; truncated: boolean }
  | { kind: 'unrepresentable'; reason: 'overflow-notice-too-large' }

const instruction =
  'Parts of this batch may arrive in any order. Concatenate the bodies by part number without\n' +
  'adding or removing characters. Together they replace every earlier identity snapshot; a single\n' +
  'part is not a complete snapshot.\n'

function wrap(body: string, batchId: string, part: number, total: number, truncated: boolean, notice = ''): string {
  return (
    `<agent_identity_part batch="${batchId}" part="${part}/${total}" units="${body.length}" truncated="${truncated}">\n` +
    instruction +
    body +
    notice +
    '\n</agent_identity_part>'
  )
}

/** Builds capped contexts, preserving a prefix and an explicit notice if all slices do not fit. */
export function buildIdentityDelivery(snapshot: string, agentDataPath: string, batchId: string): IdentityDelivery {
  const slices = splitIdentitySnapshot(snapshot)
  const truncated = slices.length > CLAUDE_IDENTITY_HOOK_SLOTS
  const bodies = slices.slice(0, CLAUDE_IDENTITY_HOOK_SLOTS)
  let notice = ''
  if (truncated) {
    const prefixUnits = bodies.slice(0, -1).reduce((sum, body) => sum + body.length, 0)
    const remaining = snapshot.slice(prefixUnits)
    let bodyUnits = bodies.at(-1)!.length
    for (;;) {
      const deliveredUnits = prefixUnits + bodyUnits
      notice =
        `\n<identity_overflow snapshotUnits="${snapshot.length}" deliveredUnits="${deliveredUnits}" omittedUnits="${snapshot.length - deliveredUnits}">\n` +
        'Omitted content is unknown. Do not fill it from any earlier snapshot. Read the source files if needed:\n' +
        ['SOUL.md', 'USER.md', 'memory/FACT.md']
          .map((file) => JSON.stringify(path.join(agentDataPath, file)))
          .join('\n') +
        '\n</identity_overflow>'
      if (
        wrap('', batchId, CLAUDE_IDENTITY_HOOK_SLOTS, CLAUDE_IDENTITY_HOOK_SLOTS, true, notice).length >
        CLAUDE_HOOK_CONTEXT_MAX_UNITS
      ) {
        return { kind: 'unrepresentable', reason: 'overflow-notice-too-large' }
      }
      const excess = Math.max(
        bodyUnits + notice.length - CLAUDE_IDENTITY_CHUNK_UNITS,
        wrap(
          remaining.slice(0, bodyUnits),
          batchId,
          CLAUDE_IDENTITY_HOOK_SLOTS,
          CLAUDE_IDENTITY_HOOK_SLOTS,
          true,
          notice
        ).length - CLAUDE_HOOK_CONTEXT_MAX_UNITS
      )
      if (excess <= 0 || bodyUnits === 0) break
      bodyUnits = safeEnd(remaining, Math.max(0, bodyUnits - excess))
    }
    bodies[bodies.length - 1] = remaining.slice(0, bodyUnits)
  }
  const deliveredUnits = bodies.reduce((sum, body) => sum + body.length, 0)
  return {
    kind: 'ready',
    contexts: bodies.map((body, i) =>
      wrap(body, batchId, i + 1, bodies.length, truncated, i === bodies.length - 1 ? notice : '')
    ),
    deliveredUnits,
    omittedUnits: snapshot.length - deliveredUnits,
    truncated
  }
}

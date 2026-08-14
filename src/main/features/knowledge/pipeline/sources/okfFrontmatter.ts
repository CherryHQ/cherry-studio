/**
 * OKF (Open Knowledge Format) YAML frontmatter for app-written knowledge
 * snapshots (url + note). Flat, top-level keys — no app-private namespace — so
 * the file is a standard, portable OKF document: human-readable, agent-parseable
 * (see https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).
 *
 * The block makes the file self-describing independently of any database row.
 * Serialize and strip must stay exact inverses: indexing reads the snapshot and
 * strips this block to recover the canonical `content.text`, so any drift would
 * make every snapshot hash as "modified". Because we always write the snapshot
 * with this block first, `strip` removes the single leading frontmatter block
 * unconditionally — the body (even one that itself begins with `---`) is kept
 * intact. Only snapshot readers call `strip`; user-uploaded files never do.
 */

export interface OkfFrontmatter {
  /** OKF-required: the kind of concept (e.g. 'URL', 'Note'). */
  type: string
  /** Human-readable display name (the page/note title). */
  title?: string
  /** URI uniquely identifying the underlying asset (the source URL). */
  resource?: string
  /** ISO 8601 datetime of the last meaningful change (the capture/write time). */
  timestamp?: string
}

/**
 * Render the OKF frontmatter block, closing-delimiter newline included, so
 * `serialize(fields) + body` is the exact file text. Keys are emitted in OKF
 * priority order: type, title, resource, timestamp. Values are JSON-quoted (valid
 * YAML double-quoted scalars), which keeps a value containing `---` or `#` from
 * ever forming a delimiter or comment line.
 */
export function serializeOkfFrontmatter(fields: OkfFrontmatter): string {
  const lines = ['---', `type: ${JSON.stringify(fields.type)}`]
  if (fields.title !== undefined) {
    lines.push(`title: ${JSON.stringify(fields.title)}`)
  }
  if (fields.resource !== undefined) {
    lines.push(`resource: ${JSON.stringify(fields.resource)}`)
  }
  if (fields.timestamp !== undefined) {
    lines.push(`timestamp: ${JSON.stringify(fields.timestamp)}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * Remove the single leading frontmatter block (`---` … `---`) — the block this
 * module wrote — and return the body. Text that does not start with a complete
 * frontmatter block passes through byte-for-byte.
 */
export function stripOkfFrontmatter(text: string): string {
  if (!text.startsWith('---\n')) {
    return text
  }
  const closeStart = text.indexOf('\n---\n', 3)
  if (closeStart === -1) {
    return text
  }
  return text.slice(closeStart + 5)
}

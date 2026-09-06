import type { SnapshotRevision } from './serializeSnapshot'

export function diffSnapshot(
  previous: SnapshotRevision | undefined,
  current: SnapshotRevision,
  maxChars: number
): string {
  if (!previous || previous.documentId !== current.documentId) return current.text
  const changed = [...current.lines].filter(([id, line]) => previous.lines.get(id) !== line)
  const removed = [...previous.lines.keys()].filter((id) => !current.lines.has(id))
  if ((changed.length + removed.length) / Math.max(previous.lines.size, current.lines.size, 1) > 0.6)
    return current.text
  if (!changed.length && !removed.length && previous.header === current.header && previous.footer === current.footer)
    return '(no change)'
  const text = [
    current.header,
    ...changed.map(([id, line]) => `${previous.lines.has(id) ? '' : '* '}${line}`),
    removed.length ? `- ${removed.length} nodes removed` : '',
    current.footer
  ]
    .filter(Boolean)
    .join('\n')
  return text.length <= maxChars ? text : current.text
}

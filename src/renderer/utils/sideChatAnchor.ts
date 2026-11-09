import type { SideChatSnapshot } from '@shared/data/types/sideChat'

export function locateSideChatSource(current: string, snapshot: SideChatSnapshot): number | null {
  const { selection, prefix, suffix } = snapshot
  if (!selection) return null
  const start = current.indexOf(selection)
  if (start < 0 || current.indexOf(selection, start + 1) >= 0) return null
  if (!prefix && !suffix) return current === snapshot.answer && selection === snapshot.answer ? 0 : null
  if (!current.slice(0, start).endsWith(prefix) || !current.slice(start + selection.length).startsWith(suffix))
    return null
  return start
}

import { normalizePathValue } from '@renderer/services/NotesTreeService'

export function shouldBlockAutosave(targetPath: string, pendingDelete: string | null): boolean {
  if (!pendingDelete) return false
  const normalizedTarget = normalizePathValue(targetPath)
  return normalizedTarget === pendingDelete || normalizedTarget.startsWith(`${pendingDelete}/`)
}

export function isPendingDeleteForPath(normalizedTarget: string, pendingSet: Set<string>): boolean {
  for (const pending of pendingSet) {
    if (normalizedTarget === pending || normalizedTarget.startsWith(`${pending}/`)) {
      return true
    }
  }
  return false
}

export function getEffectiveGeneration(
  normalizedTarget: string,
  generations: Map<string, number>
): number {
  let max = generations.get(normalizedTarget) ?? 0
  for (const [key, gen] of generations.entries()) {
    if ((normalizedTarget === key || normalizedTarget.startsWith(`${key}/`)) && gen > max) {
      max = gen
    }
  }
  return max
}

export function isActiveRelated(
  activeFilePath: string | undefined,
  deletePath: string,
  deleteType: 'file' | 'folder'
): boolean {
  const normalizedActive = activeFilePath ? normalizePathValue(activeFilePath) : undefined
  const normalizedDelete = normalizePathValue(deletePath)
  if (normalizedActive === normalizedDelete) return true
  if (deleteType === 'folder' && normalizedActive?.startsWith(`${normalizedDelete}/`)) return true
  return false
}

export function shouldRearmSnapshot(
  snapPath: string | undefined,
  deletePath: string,
  deleteType: 'file' | 'folder'
): boolean {
  if (!snapPath) return false
  const snapNorm = normalizePathValue(snapPath)
  const delNorm = normalizePathValue(deletePath)
  if (snapNorm === delNorm) return true
  if (deleteType === 'folder' && snapNorm.startsWith(`${delNorm}/`)) return true
  return false
}

import { realpathSync } from 'node:fs'
import path from 'node:path'

export type PathNameBehavior = { caseSensitive: boolean; unicodeSensitive: boolean }

/** Preserve claims beneath missing directories or a parent that was replaced by a file. */
export function nearestExistingRealPathSync(value: string): string {
  let current = path.resolve(value)
  const missing: string[] = []
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...missing)
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      missing.unshift(path.basename(current))
      current = parent
    }
  }
}

export function createPathOverlapCheck(
  paths: readonly string[],
  behaviors: ReadonlyMap<string, PathNameBehavior>
): (candidate: string) => boolean {
  const targets = paths.flatMap((value) => [path.resolve(value), nearestExistingRealPathSync(value)])
  const overlaps = (left: string, right: string) => {
    const a = left.split(path.sep)
    const b = right.split(path.sep)
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const parent = a.slice(0, i).join(path.sep) || path.parse(left).root
      const behavior = behaviors.get(parent)
      const key = (segment: string) => {
        if (behavior?.unicodeSensitive === false) segment = segment.normalize('NFC')
        return behavior?.caseSensitive === false ? segment.toLowerCase() : segment
      }
      if (key(a[i]) !== key(b[i])) return false
    }
    return true
  }
  return (candidate) => {
    const candidates = [path.resolve(candidate), nearestExistingRealPathSync(candidate)]
    return targets.some((target) => candidates.some((value) => overlaps(target, value)))
  }
}

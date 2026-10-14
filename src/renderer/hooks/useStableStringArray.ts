import { useRef } from 'react'

function stringArraysEqual(previous: readonly string[], next: readonly string[]): boolean {
  if (previous === next) return true
  if (previous.length !== next.length) return false
  return previous.every((value, index) => value === next[index])
}

/** Returns the previous array reference while the contents stay element-wise equal. */
export function useStableStringArray(values: readonly string[]): readonly string[] {
  const stableRef = useRef<readonly string[]>(values)
  if (!stringArraysEqual(stableRef.current, values)) {
    stableRef.current = values
  }
  return stableRef.current
}

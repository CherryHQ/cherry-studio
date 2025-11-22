/**
 * Data Refactor, notes by fullex
 * //TODO @deprecated this file will be removed
 */
import { useAppSelector } from '@renderer/store'

export function useRuntime() {
  return useAppSelector((state) => state.runtime)
}

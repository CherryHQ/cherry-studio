import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Returns a ref that always holds the latest `value`.
 *
 * Note: we avoid writing to the ref during render because the React Compiler
 * disallows accessing refs during render for optimization. Instead we update
 * the ref from a (isomorphic) layout effect so consumers reading the ref from
 * callbacks/effects observe the most recent value while keeping render-phase
 * code free of ref mutations.
 */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef<T>(value)
  useIsomorphicLayoutEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

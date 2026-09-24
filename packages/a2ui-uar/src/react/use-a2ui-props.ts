import { GenericBinder, type ComponentContext } from '@prometheus-ags/a2ui-core/v0_9'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type * as z from 'zod'

/**
 * React adapter over `web_core`'s framework-agnostic `GenericBinder`.
 *
 * `GenericBinder` does the actual work: it scrapes a component's Zod
 * schema to find `DYNAMIC` (data-bound), `ACTION`, `STRUCTURAL`
 * (ChildList) and `CHECKABLE` fields, subscribes to the surface's
 * `DataContext` for the dynamic ones, and exposes a plain
 * subscribe/snapshot interface. This hook is the only React-specific
 * glue required: it creates one binder per `(context, schema)` identity,
 * disposes it on teardown, and bridges it into React via
 * `useSyncExternalStore` so components re-render exactly when the bound
 * data actually changes (not on every parent render).
 *
 * `context` must be a referentially stable `ComponentContext` for the
 * binder's subscriptions to stay valid across renders — callers should
 * memoize it (see `UarDeferredChild` in `UarSurface.tsx`, the only
 * caller in this package).
 */
export function useA2uiProps<T>(context: ComponentContext, schema: z.ZodTypeAny): T {
  const binder = useMemo(() => new GenericBinder<T>(context, schema), [context, schema])

  useEffect(() => {
    return () => binder.dispose()
  }, [binder])

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const subscription = binder.subscribe(() => onStoreChange())
      return () => subscription.unsubscribe()
    },
    [binder]
  )

  const getSnapshot = useCallback(() => binder.snapshot as T, [binder])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

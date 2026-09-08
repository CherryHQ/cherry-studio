import { useEffect, useRef } from 'react'

import { dataApiService } from '@data/DataApiService'
import type { DataApiDataChangeEffect, GetMethodApiPaths } from '@shared/data/api/types'

export interface UseDataChangeOptions {
  /** Concrete parameters for a template endpoint. Effects without a route claim still match. */
  routeParams?: Readonly<Record<string, string>>
}

/** Subscribe to typed DataApi read-model changes for the component lifetime. */
export function useDataChange(
  endpoints: GetMethodApiPaths | GetMethodApiPaths[],
  listener: (effects: DataApiDataChangeEffect[]) => void,
  options: UseDataChangeOptions = {}
): void {
  const listenerRef = useRef(listener)
  const routeParamsRef = useRef(options.routeParams)
  useEffect(() => {
    listenerRef.current = listener
    routeParamsRef.current = options.routeParams
  })

  const endpointsKey = Array.isArray(endpoints) ? endpoints.join('\0') : endpoints
  useEffect(() => {
    if (endpointsKey === '') return
    const endpointList = endpointsKey.split('\0') as GetMethodApiPaths[]
    return dataApiService.onDataChanged?.(endpointList, (effects) => {
      const routeParams = routeParamsRef.current
      const matchingEffects = routeParams
        ? effects.filter(
            (effect) =>
              !effect.routeParams ||
              Object.entries(routeParams).every(([key, value]) => effect.routeParams?.[key] === value)
          )
        : effects
      if (matchingEffects.length > 0) listenerRef.current(matchingEffects)
    })
  }, [endpointsKey])
}

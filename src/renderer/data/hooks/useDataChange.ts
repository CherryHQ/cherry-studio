import { dataApiService } from '@data/DataApiService'
import type { ParamsForPath } from '@shared/data/api/paths'
import type { DataApiDataChangeEffect, GetMethodApiPaths } from '@shared/data/api/types'
import { useEffect, useRef } from 'react'

export type UseDataChangeOptions<Path extends GetMethodApiPaths> = [Path] extends [`${string}:${string}`]
  ? {
      /** Concrete parameters for a template endpoint. All-routes effects still match. */
      routeParams?: Readonly<ParamsForPath<Path, 'GET'>>
    }
  : {
      routeParams?: never
    }

export function useDataChange<Path extends GetMethodApiPaths>(
  endpoints: Path,
  listener: (effects: DataApiDataChangeEffect[]) => void,
  options?: UseDataChangeOptions<Path>
): void
export function useDataChange<Path extends GetMethodApiPaths>(
  endpoints: Path | readonly Path[],
  listener: (effects: DataApiDataChangeEffect[]) => void
): void
export function useDataChange(
  endpoints: GetMethodApiPaths | readonly GetMethodApiPaths[],
  listener: (effects: DataApiDataChangeEffect[]) => void,
  options: { routeParams?: Readonly<Record<string, unknown>> } = {}
): void {
  const listenerRef = useRef(listener)
  const routeParamsRef = useRef(options.routeParams)
  useEffect(() => {
    listenerRef.current = listener
    routeParamsRef.current = options.routeParams
  })

  const endpointsKey = typeof endpoints === 'string' ? endpoints : endpoints.join('\0')
  useEffect(() => {
    if (endpointsKey === '') return
    const endpointList = endpointsKey.split('\0') as GetMethodApiPaths[]
    return dataApiService.onDataChanged?.(endpointList, (effects) => {
      const routeParams = routeParamsRef.current
      const matchingEffects = routeParams
        ? effects.filter((effect) => {
            const effectRouteParams = effect.routeParams as Readonly<Record<string, string>> | undefined
            return (
              !effectRouteParams ||
              Object.entries(routeParams).every(([key, value]) => effectRouteParams[key] === value)
            )
          })
        : effects
      if (matchingEffects.length > 0) listenerRef.current(matchingEffects)
    })
  }, [endpointsKey])
}

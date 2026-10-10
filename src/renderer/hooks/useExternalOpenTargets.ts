import { useCallback, useMemo } from 'react'
import useSWRImmutable from 'swr/immutable'

import { usePersistCache } from '@data/hooks/useCache'
import {
  type ExternalOpenTargetPathKind,
  externalOpenTargetService,
  getExternalOpenTargetScope
} from '@renderer/services/externalOpenTargetService'
import type { ExternalOpenTarget } from '@shared/types/externalApp'

export function useExternalOpenTargets(
  targetPath: string,
  pathKind: ExternalOpenTargetPathKind,
  options?: { enabled?: boolean }
) {
  const queryScope = getExternalOpenTargetScope(targetPath, pathKind)
  const query = useSWRImmutable(
    options?.enabled === false ? null : ['external-open-targets', queryScope],
    () => externalOpenTargetService.list(targetPath, pathKind),
    { shouldRetryOnError: false }
  )
  const resolvedPathKind = query.data?.pathKind ?? pathKind

  const openTarget = useCallback(
    (target: ExternalOpenTarget) => externalOpenTargetService.open(targetPath, resolvedPathKind, target.id),
    [resolvedPathKind, targetPath]
  )

  return {
    ...query,
    targets: query.data?.targets ?? [],
    openTarget
  }
}

export function usePreferredExternalOpenTarget(targetPath: string, pathKind: ExternalOpenTargetPathKind) {
  const query = useExternalOpenTargets(targetPath, pathKind)
  const [preferences] = usePersistCache('external_app.target.preferences')
  const resolvedPathKind = query.data?.pathKind ?? pathKind
  const preferenceScope = getExternalOpenTargetScope(targetPath, resolvedPathKind)
  const selectedTarget = useMemo(() => {
    const preferredTargetId = preferences[preferenceScope]
    return (
      query.targets.find((target) => target.id === preferredTargetId) ??
      query.targets.find((target) => target.id === query.data?.recommendedTargetId) ??
      query.targets[0]
    )
  }, [preferenceScope, preferences, query.data?.recommendedTargetId, query.targets])

  return { ...query, selectedTarget }
}

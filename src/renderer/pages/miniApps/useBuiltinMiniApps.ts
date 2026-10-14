import { useMemo } from 'react'

import { useCache } from '@data/hooks/useCache'
import { joinPath } from '@renderer/utils/path'
import { BUILTIN_MINI_APPS } from '@shared/data/presets/miniApps'
import type { MiniApp } from '@shared/data/types/miniApp'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { resolveLocalizedText } from '@shared/types/miniAppManifest'
import { toFileUrl } from '@shared/utils/file'

export interface BuiltinMiniAppEntry {
  appId: string
  name: string
  /** `file://` — an uninstalled builtin has no `cherry-miniapp://` origin yet (§10.4). */
  iconUrl: string
}

/**
 * The not-yet-installed half of the launcher list.
 *
 * A filter, not a fetch: `BUILTIN_MINI_APPS` is a compile-time `@shared` constant, so
 * there is no list route and no main-side copy. Only the ICON needs the host — nothing
 * under `resources/` has a renderer-reachable URL until an absolute path is joined onto
 * it, which is the same shape `buildPrivacyPolicyUrl` and the painting-template catalog
 * already use.
 *
 * Matching is on `presetMiniAppId`, the one predicate that answers "is this official?"
 * for sites and apps alike (§3.2). It is NULL for everything the user installed
 * themselves, so no package a user can produce suppresses an official offer.
 *
 * Callers hand it EVERY row (`allApps`): the visible list omits `disabled`, and a
 * disabled official app is still installed — offering it again can only fail.
 */
export function useBuiltinMiniApps(
  installed: readonly Pick<MiniApp, 'presetMiniAppId'>[],
  language: string
): BuiltinMiniAppEntry[] {
  const [resourcesPath] = useCache('app.path.resources')
  return useMemo(() => {
    if (!resourcesPath) return []
    const taken = new Set(installed.map((app) => app.presetMiniAppId))
    return BUILTIN_MINI_APPS.filter((e) => !taken.has(e.appId)).map((e) => ({
      appId: e.appId,
      name: resolveLocalizedText(e.name, language),
      iconUrl: toFileUrl(
        AbsoluteFilePathSchema.parse(joinPath(resourcesPath, `builtin-mini-apps/${e.appId}/${e.icon}`))
      )
    }))
  }, [installed, language, resourcesPath])
}

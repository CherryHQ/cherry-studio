import { useEffect, useState } from 'react'

import { getLoadedIcon, loadIcon } from './loader'
import type { IconRef } from './registry'
import type { CompoundIcon } from './types'

interface LoadedIconState {
  refKey: string
  icon: CompoundIcon
}

/**
 * Resolve an IconRef to its (async-loaded) CompoundIcon.
 *
 * Returns the icon synchronously when its catalog chunk is already loaded;
 * otherwise returns undefined while loading — callers keep their existing
 * miss fallback (initials / placeholder) for that brief window. A load
 * failure just leaves the fallback in place.
 */
export function useIcon(iconRef: IconRef | undefined): CompoundIcon | undefined {
  const refKey = iconRef ? `${iconRef.kind}:${iconRef.key}` : undefined
  const [loaded, setLoaded] = useState<LoadedIconState | undefined>(undefined)
  // Queried once per render: the return path shows it directly, and the effect
  // closure (which corresponds to the mount/key-switch render via [refKey])
  // uses it to tell "already visible" apart from "landed after render".
  const cachedAtRender = iconRef ? getLoadedIcon(iconRef) : undefined

  useEffect(() => {
    if (!iconRef || cachedAtRender) return
    const key = `${iconRef.kind}:${iconRef.key}`
    const cached = getLoadedIcon(iconRef)
    if (cached) {
      // The catalog finished loading between render and this effect (another
      // consumer's load resolving in a microtask). The render missed it, so
      // commit state — otherwise the fallback would stick until an unrelated
      // update. The render-hit case returns above without this extra render.
      setLoaded((prev) => (prev && prev.refKey === key && prev.icon === cached ? prev : { refKey: key, icon: cached }))
      return
    }
    let cancelled = false
    loadIcon(iconRef).then(
      (icon) => {
        if (!cancelled) setLoaded({ refKey: key, icon })
      },
      () => {
        // Chunk load failure: keep the caller's fallback rendering.
      }
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refKey captures the ref's identity
  }, [refKey])

  if (!iconRef) return undefined
  // Guarding on refKey drops stale results from a previous ref after rapid switches.
  return cachedAtRender ?? (loaded && loaded.refKey === refKey ? loaded.icon : undefined)
}

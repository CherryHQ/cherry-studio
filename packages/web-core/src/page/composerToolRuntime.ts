import { useMemo } from 'react'

// Wraps the desktop composer tool runtime: the agent composer registers its skills launcher itself,
// and the Web edition has no skills, so registrations under that key are dropped.
import { useComposerToolDispatch as useDesktopComposerToolDispatch } from '@renderer/components/composer/ComposerToolRuntime'

export * from '@renderer/components/composer/ComposerToolRuntime'

const hiddenLaunchers = new Set(['agent-skills'])

export function useComposerToolDispatch(): ReturnType<typeof useDesktopComposerToolDispatch> {
  const dispatch = useDesktopComposerToolDispatch()
  return useMemo(
    () => ({
      ...dispatch,
      toolsRegistry: {
        ...dispatch.toolsRegistry,
        registerLaunchers: (key, ...rest) =>
          hiddenLaunchers.has(key) ? () => undefined : dispatch.toolsRegistry.registerLaunchers(key, ...rest)
      }
    }),
    [dispatch]
  )
}

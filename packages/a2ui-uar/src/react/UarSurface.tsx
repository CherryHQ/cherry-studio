import { ComponentContext, type ComponentApi, type SurfaceModel } from '@prometheus-ags/a2ui-core/v0_9'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useMemo, useSyncExternalStore, type FC } from 'react'

import { UarI18nProvider, useUarI18n, type UarDirection, type UarLocale } from '../i18n'
import { SurfaceErrorBoundary } from './SurfaceErrorBoundary'
import type { BuildChild, UarComponentImplementation } from './types'

import '../styles.css'

export type UarTheme = 'light' | 'dark' | 'high-contrast'

/**
 * The A2UI concept & renderer-development docs establish `"root"` as the
 * conventional id for a surface's entry-point component (see
 * `docs/protocols/a2ui-profile.md` and https://a2ui.org/concepts/overview/,
 * https://a2ui.org/guides/renderer-development/). `web_core`'s
 * `ComponentModel`/`SurfaceComponentsModel` do not carry an explicit "this
 * is the root" flag, so a renderer has to apply that convention itself.
 * We fall back to the first component the surface has if `"root"` is
 * absent, so a malformed/legacy payload still renders something instead of
 * a blank surface.
 */
export function getRootComponentId(surface: SurfaceModel<UarComponentImplementation>): string | undefined {
  if (surface.componentsModel.get('root')) {
    return 'root'
  }
  const first = surface.componentsModel.entries.next()
  return first.done ? undefined : first.value[0]
}

/** Thrown when a surface references a component type not present in its catalog. Fails closed per the A2UI security boundary (docs/protocols/a2ui-profile.md). */
export class UnknownUarComponentError extends Error {
  constructor(componentType: string, componentId: string) {
    super(
      `Unknown A2UI component type "${componentType}" (component id "${componentId}"). ` +
        'Refusing to render: only pre-approved catalog components resolve to native widgets.'
    )
    this.name = 'UnknownUarComponentError'
  }
}

/**
 * Renders one component (and, recursively, its children) from a surface's
 * live `SurfaceComponentsModel`. This is the UAR renderer's equivalent of
 * `@a2ui/react`'s `DeferredChild` / `A2uiSurface`, built directly on
 * `web_core`'s `ComponentContext` + `SurfaceModel` rather than any
 * `@a2ui/react` internals.
 */
export const UarDeferredChild: FC<{
  surface: SurfaceModel<UarComponentImplementation<ComponentApi>>
  id: string
  basePath?: string
}> = ({ surface, id, basePath = '/' }) => {
  // Re-render this subtree when the component is (re)created, removed, or
  // its type changes — `useA2uiProps`/`GenericBinder` (inside each
  // component's own `render`) handles prop-level reactivity, this handles
  // structural reactivity (component identity/type).
  const version = useSyncExternalStore(
    (onStoreChange) => {
      const created = surface.componentsModel.onCreated.subscribe(() => onStoreChange())
      const deleted = surface.componentsModel.onDeleted.subscribe(() => onStoreChange())
      return () => {
        created.unsubscribe()
        deleted.unsubscribe()
      }
    },
    () => surface.componentsModel.get(id)?.type ?? null,
    () => surface.componentsModel.get(id)?.type ?? null
  )

  const context = useMemo(
    () => new ComponentContext(surface, id, basePath),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, id, basePath, version]
  )

  const buildChild: BuildChild = useMemo(
    () => (childId, childBasePath) => (
      <UarDeferredChild surface={surface} id={childId} basePath={childBasePath ?? basePath} />
    ),
    [surface, basePath]
  )

  const componentModel = surface.componentsModel.get(id)
  if (!componentModel) {
    return null
  }

  const implementation = surface.catalog.components.get(componentModel.type)
  if (!implementation) {
    throw new UnknownUarComponentError(componentModel.type, id)
  }

  const Render = implementation.render
  return <Render context={context} buildChild={buildChild} />
}

/**
 * Renders a full A2UI surface (the UAR renderer's top-level entry point).
 * Pass the `SurfaceModel` produced by `web_core`'s `MessageProcessor` after
 * it has processed a `createSurface`/`updateComponents` message pair.
 */
interface UarSurfaceContentProps {
  surface: SurfaceModel<UarComponentImplementation<ComponentApi>>
  theme: UarTheme
  onRetry?: () => void
  resetKey?: string | number
  transitionKey?: string | number
}

const UarSurfaceContent: FC<UarSurfaceContentProps> = ({ surface, theme, onRetry, resetKey, transitionKey }) => {
  const { dir, locale, t } = useUarI18n()
  const rootId = useSyncExternalStore(
    (onStoreChange) => {
      const created = surface.componentsModel.onCreated.subscribe(() => onStoreChange())
      const deleted = surface.componentsModel.onDeleted.subscribe(() => onStoreChange())
      return () => {
        created.unsubscribe()
        deleted.unsubscribe()
      }
    },
    () => getRootComponentId(surface),
    () => getRootComponentId(surface)
  )

  if (!rootId) {
    return (
      <div
        className="uar-a2ui-surface rounded-md border border-border bg-background p-4 text-sm text-muted-foreground"
        data-a2ui-theme={theme}
        data-a2ui-surface-state="empty"
        dir={dir}
        lang={locale}
        role="status">
        {t('empty')}
      </div>
    )
  }

  return (
    <div
      className="uar-a2ui-surface min-w-0"
      data-a2ui-theme={theme}
      data-a2ui-surface-state="ready"
      dir={dir}
      lang={locale}>
      <SurfaceErrorBoundary
        resetKey={resetKey}
        onRetry={onRetry}
        title={t('errorTitle')}
        body={t('errorBody')}
        retryLabel={t('retry')}>
        <MotionConfig reducedMotion="user" transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={transitionKey ?? rootId}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}>
              <UarDeferredChild surface={surface} id={rootId} basePath="/" />
            </motion.div>
          </AnimatePresence>
        </MotionConfig>
      </SurfaceErrorBoundary>
    </div>
  )
}

export interface UarSurfaceProps {
  surface: SurfaceModel<UarComponentImplementation<ComponentApi>>
  theme?: UarTheme
  locale?: UarLocale
  direction?: UarDirection
  onRetry?: () => void
  resetKey?: string | number
  transitionKey?: string | number
}

export const UarSurface: FC<UarSurfaceProps> = ({
  surface,
  theme = 'light',
  locale = 'en',
  direction = 'auto',
  ...props
}) => (
  <UarI18nProvider locale={locale} direction={direction}>
    <UarSurfaceContent surface={surface} theme={theme} {...props} />
  </UarI18nProvider>
)

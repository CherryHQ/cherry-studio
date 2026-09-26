/**
 * `@prometheus-ags/a2ui-uar` — the UAR-owned A2UI renderer, built directly
 * on `@prometheus-ags/a2ui-core` (`@a2ui/web_core`). This is the renderer
 * UAR product code should import; `@prometheus-ags/a2ui-react` (Google's
 * reference React renderer) is vendored only as a cross-testing reference
 * — see that package's `README.md`.
 *
 * See `README.md` in this directory for the architecture this package is
 * built against, what's implemented vs. deferred, and the performance
 * measurement harness.
 */

// React adapter over web_core's GenericBinder — the reusable primitives
// any future UAR component (including the remaining Entity* components)
// is built from.
export { useA2uiProps } from './react/use-a2ui-props'
export { createUarComponentImplementation, createBinderlessUarComponentImplementation } from './react/create-component'
export type { BuildChild, UarComponentImplementation, UarComponentProps, UarRenderProps } from './react/types'

// The surface renderer.
export { UarSurface, UarDeferredChild, getRootComponentId, UnknownUarComponentError } from './react/UarSurface'
export type { UarSurfaceProps, UarTheme } from './react/UarSurface'
export { SurfaceErrorBoundary } from './react/SurfaceErrorBoundary'
export { UarI18nProvider, useUarI18n, uarI18nResources } from './i18n'
export type { UarLocale, UarDirection, UarMessageKey } from './i18n'

// Catalogs.
export { uarBasicCatalog, uarBasicCatalogComponents, UAR_A2UI_CATALOG_ID } from './catalog/uar-basic-catalog'
export { uarEntityCatalog, uarEntityCatalogComponents, UAR_A2UI_ENTITY_CATALOG_ID } from './catalog/uar-entity-catalog'

// The 9 uar.a2ui/1 protocol-standard components.
export * from './components'

// UAR-specific Entity* component schemas and renderers.
export * from './entities'

// Performance-measurement harness (see README's "Performance budget" section).
export { measure, measureMany, percentile } from './perf/measure'
export type { MeasureResult } from './perf/measure'

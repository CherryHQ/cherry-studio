import type {
  ComponentApi,
  ComponentContext,
  InferredComponentApiSchemaType,
  ResolveA2uiProps
} from '@prometheus-ags/a2ui-core/v0_9'
import type { ReactNode, FC } from 'react'

/**
 * Recursively renders a child component by id, optionally re-scoping the
 * data context to `basePath`. Passed down through every UAR component's
 * `render` function so structural props (Row/Column `children`, Card
 * `child`, Button `child`, ...) can be turned into React nodes without
 * each component needing to know how to walk the surface tree itself.
 */
export type BuildChild = (id: string, basePath?: string) => ReactNode

/** Props passed to every UAR component's `render` function. */
export interface UarRenderProps<T> {
  props: T
  buildChild: BuildChild
  context: ComponentContext
}

/**
 * A single entry in the UAR component catalog: the `web_core` `ComponentApi`
 * (name + Zod schema, used for both wire validation and prop-shape
 * inference) plus a React render function that receives fully bound,
 * reactive props via `GenericBinder`.
 *
 * This mirrors `@a2ui/react`'s `ReactComponentImplementation` shape so the
 * two renderers stay structurally cross-testable (see Change 17's
 * cross-testing requirement), without depending on `@a2ui/react` at
 * runtime.
 */
export interface UarComponentImplementation<Api extends ComponentApi = ComponentApi> {
  name: string
  schema: Api['schema']
  render: FC<{ context: ComponentContext; buildChild: BuildChild }>
}

/** Fully-resolved, reactive props for a given component API, as produced by `GenericBinder`. */
export type UarComponentProps<Api extends ComponentApi> = ResolveA2uiProps<InferredComponentApiSchemaType<Api>>

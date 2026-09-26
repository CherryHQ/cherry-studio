import type { ComponentApi, ComponentContext } from '@prometheus-ags/a2ui-core/v0_9'
import type { FC } from 'react'

import type { BuildChild, UarComponentImplementation, UarComponentProps } from './types'
import { useA2uiProps } from './use-a2ui-props'

/**
 * Builds a {@link UarComponentImplementation} from a `web_core` `ComponentApi`
 * (name + Zod schema) and a plain render function. The returned `render`
 * wraps the caller's component with `useA2uiProps`, so `RenderComponent`
 * always receives fully resolved props: data bindings are subscribed and
 * unwrapped to primitives, `Action` fields become `() => void` callables,
 * and `ChildList` fields become `{ id, basePath }[]` ready to pass to
 * `buildChild`.
 *
 * This is the UAR-owned equivalent of `@a2ui/react`'s
 * `createComponentImplementation` (that package is vendored only as a
 * cross-testing reference — see `frontend/packages/a2ui-react/`). Both
 * adapters sit on the same `web_core` `GenericBinder`, so a component built
 * with this factory and one built with `@a2ui/react`'s factory resolve the
 * same wire payload into the same prop shape.
 */
export function createUarComponentImplementation<Api extends ComponentApi>(
  api: Api,
  RenderComponent: FC<{
    props: UarComponentProps<Api>
    buildChild: BuildChild
    context: ComponentContext
  }>
): UarComponentImplementation<Api> {
  const Render: FC<{
    context: ComponentContext
    buildChild: BuildChild
  }> = ({ context, buildChild }) => {
    const props = useA2uiProps<UarComponentProps<Api>>(context, api.schema)
    return <RenderComponent props={props} buildChild={buildChild} context={context} />
  }
  Render.displayName = `A2uiUar(${api.name})`

  return { name: api.name, schema: api.schema, render: Render }
}

/**
 * Builds a {@link UarComponentImplementation} that manages its own context
 * bindings instead of going through `GenericBinder` — for components (like
 * a future `EntityStream`) that need raw access to `context.dataContext`
 * for imperative subscriptions the generic binder's declarative model
 * doesn't cover.
 */
export function createBinderlessUarComponentImplementation<Api extends ComponentApi>(
  api: Api,
  RenderComponent: FC<{
    context: ComponentContext
    buildChild: BuildChild
  }>
): UarComponentImplementation<Api> {
  return { name: api.name, schema: api.schema, render: RenderComponent }
}

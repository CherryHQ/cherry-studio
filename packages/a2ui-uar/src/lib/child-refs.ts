/**
 * `web_core`'s `GenericBinder` resolves a `ChildList` (`Row`/`Column`/`List`'s
 * `children` field) differently depending on the wire shape:
 *   - a static id array (`["a", "b"]`) is passed through unchanged — plain
 *     strings, no `basePath` wrapping;
 *   - a templated list (`{ componentId, path }`, used to repeat one child
 *     per item in a data-model array) is expanded into
 *     `{ id, basePath }[]`, one entry per item, each `basePath` scoped to
 *     that item's index.
 * (See `generic-binder.js`'s `STRUCTURAL` case.) Layout components need to
 * handle both shapes uniformly.
 */
export interface ChildRef {
  id: string
  basePath?: string
}

export function resolveChildRefs(children: unknown): ChildRef[] {
  if (!Array.isArray(children)) return []
  return children.map((child) => (typeof child === 'string' ? { id: child } : (child as ChildRef)))
}

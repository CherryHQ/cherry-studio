/**
 * `web_core`'s `ResolveA2uiProps<T>` (see `@a2ui/web_core/v0_9`'s
 * `generic-binder.d.ts`) only maps *top-level* schema fields from their
 * raw `DynamicString | DataBinding | FunctionCall` union down to a plain
 * `string`. Nested object/array fields (e.g. `accessibility.label`,
 * `ChoicePicker`'s `options[].label`) are `OBJECT`/`ARRAY` `BehaviorNode`s
 * that `GenericBinder` *does* walk and resolve reactively at runtime — the
 * type utility just doesn't model that recursion, so TypeScript still
 * sees the raw union for those fields even though the runtime value is
 * always a plain string once bound.
 *
 * This helper documents and localizes that one-line runtime/type gap so
 * call sites reading nested dynamic-string fields don't have to sprinkle
 * unexplained `as string` casts. If a future `web_core` release recurses
 * `ResolveA2uiProps` fully, this helper becomes a no-op passthrough and
 * can be deleted.
 */
export function resolvedText(value: unknown): string | undefined {
  return value as string | undefined
}

/**
 * Same rationale as {@link resolvedText}, for nested `Action` fields (e.g.
 * `EntityCard.actions[].action`): `GenericBinder` resolves any `ACTION`
 * `BehaviorNode` anywhere in the tree into a `() => void` at runtime, but
 * `ResolveA2uiProps<T>`'s `Action -> () => void` mapping is only applied
 * one level deep by the type utility.
 */
export function resolvedAction(value: unknown): () => void {
  return value as () => void
}

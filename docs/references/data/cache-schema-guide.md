# Cache Schema Guide

How to add fixed and template keys. Aligned with [Preference Schema Guide](./preference-schema-guide.md) and [Boot Config Schema Guide](./boot-config-schema-guide.md).

## Schemas

| Schema                          | Tier    | File                                                | Default map                 |
| ------------------------------- | ------- | --------------------------------------------------- | --------------------------- |
| `UseCacheSchema`                | Memory  | `packages/shared/data/cache/cacheSchemas.ts`        | `DefaultUseCache`           |
| `SharedCacheSchema`             | Shared  | `packages/shared/data/cache/cacheSchemas.ts`        | `DefaultSharedCache`        |
| `RendererPersistCacheSchema`    | Persist | `packages/shared/data/cache/cacheSchemas.ts`        | `DefaultRendererPersistCache` |

Complex value types go in `packages/shared/data/cache/cacheValueTypes.ts` and are imported via `CacheValueTypes.*`.

## Naming Convention

Enforced by ESLint rule `data-schema-key/valid-key`. Pattern: `/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/`.

| Valid                                 | Invalid                          | Why                         |
| ------------------------------------- | -------------------------------- | --------------------------- |
| `app.user.avatar`                     | `userAvatar`                     | No dot separator            |
| `chat.multi_select_mode`              | `chat.multiSelectMode`           | No camelCase                |
| `scroll.position.${topicId}`          | `scroll.position:${id}`          | Colon not allowed           |
| `entity.cache.${type}_${id}`          | `App.user`                       | No uppercase                |

Template placeholders `${xxx}` are treated as literal segments for the naming check. At runtime, the placeholder **name** is ignored — `${providerId}` and `${foo}` produce identical regex; each placeholder expands to `[\w\-]+` (no dots, no colons, no non-ASCII).

## Choosing Fixed / Template / Casual

|                           | Fixed key           | Template key        | Casual (Memory only) |
| ------------------------- | ------------------- | ------------------- | -------------------- |
| Type inference            | Automatic           | Automatic           | Manual generic       |
| Compile-time validation   | Yes                 | Yes                 | No                   |
| Dynamic segments          | No                  | Yes                 | Yes                  |
| Shared tier               | Yes                 | Yes                 | **Not supported**    |
| Persist tier              | Yes                 | **Not supported**   | **Not supported**    |
| Default value             | Per key             | Shared across instances | None             |

Prefer Fixed > Template > Casual. Cross-window dynamic keys must be Template — there is no `getSharedCasual`.

## Adding a Fixed Key

### 1. Add the entry

```typescript
// packages/shared/data/cache/cacheSchemas.ts
export type UseCacheSchema = {
  // ...existing entries
  'feature.my_feature.data': MyDataType
}

export const DefaultUseCache: UseCacheSchema = {
  // ...existing defaults
  'feature.my_feature.data': { items: [], lastUpdated: 0 }
}
```

### 2. Define complex value type (if needed)

```typescript
// packages/shared/data/cache/cacheValueTypes.ts
export interface MyDataType {
  items: string[]
  lastUpdated: number
}
```

### 3. Use it

```typescript
const [data, setData] = useCache('feature.my_feature.data')
// data is MyDataType
```

## Adding a Template Key

```typescript
// cacheSchemas.ts
export type UseCacheSchema = {
  'scroll.position.${topicId}': number
}

export const DefaultUseCache: UseCacheSchema = {
  'scroll.position.${topicId}': 0  // shared by every concrete instance
}
```

Use with any string in the dynamic segment:

```typescript
const [pos, setPos] = useCache(`scroll.position.${topicId}`)
// pos is number; default 0 for every topicId that hasn't been written yet
```

The placeholder name is documentation-only. `${topicId}` and `${id}` compile to the same runtime matcher. Pick a name that matches the concept (not convention).

## Shared and Persist Variants

- Shared: add to `SharedCacheSchema` / `DefaultSharedCache`. Fixed and template both supported.
- Persist: add to `RendererPersistCacheSchema` / `DefaultRendererPersistCache`. **Fixed keys only.** Persist values survive restart via localStorage — keep them small and typed.

## Validation

| Check                        | Command / location                                     |
| ---------------------------- | ------------------------------------------------------ |
| ESLint naming rule           | `pnpm lint` (rule: `data-schema-key/valid-key`)        |
| Template matching unit tests | `packages/shared/data/cache/__tests__/templateKey.test.ts` |
| Schema exhaustiveness        | TypeScript compiler — default map must satisfy the schema type |

## See Also

- [Cache Overview](./cache-overview.md) — design invariants, tier semantics
- [Cache Usage](./cache-usage.md) — hooks, direct API, patterns

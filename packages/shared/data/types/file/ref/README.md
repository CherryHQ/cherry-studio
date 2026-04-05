# FileRef — Adding a New Business Integration

Each business domain that references files (e.g. chat messages, knowledge items, paintings) gets its own **ref variant** — a dedicated schema file in this directory.

## Architecture

```
ref/
├── essential.ts     # Common fields (id, nodeId, timestamps) + createRefSchema factory
├── tempSession.ts   # Temp session variant (tracks temp files in use)
├── index.ts         # Aggregates all variants into FileRefSchema (discriminatedUnion)
└── README.md
```

`FileRefSchema` is a **discriminated union on `sourceType`**. Each variant defines:

- `sourceType` — a string literal identifying the business domain
- `sourceId` — the owning business entity's ID
- `role` — a per-domain enum of how the file is used (e.g. `attachment`, `source`)

Common fields (`id`, `nodeId`, `createdAt`, `updatedAt`) are auto-inherited via `createRefSchema()`.

## Step-by-Step: Adding a New Variant

Use `tempSession.ts` as your template. Suppose you're adding `chat_message`:

### 1. Create the variant file

```typescript
// ref/chatMessage.ts
import * as z from 'zod'

import { createRefSchema } from './essential'

export const chatMessageSourceType = 'chat_message' as const

export const chatMessageRoles = ['attachment', 'inline_image'] as const

export const chatMessageFileRefSchema = createRefSchema({
  sourceType: z.literal(chatMessageSourceType),
  sourceId: z.uuidv4(),
  role: z.enum(chatMessageRoles)
})
```

### 2. Register in `index.ts`

```diff
+ import { chatMessageFileRefSchema, chatMessageRoles, chatMessageSourceType } from './chatMessage'

- const allSourceTypes = [tempSessionSourceType] as const
+ const allSourceTypes = [tempSessionSourceType, chatMessageSourceType] as const

- const allRoles = [...tempSessionRoles] as const
+ const allRoles = [...tempSessionRoles, ...chatMessageRoles] as const

  export const FileRefSchema = z.discriminatedUnion('sourceType', [
    tempSessionFileRefSchema,
+   chatMessageFileRefSchema,
  ])
```

Three things to update:

1. **`allSourceTypes`** — spread the new `sourceType` constant
2. **`allRoles`** — spread the new roles array
3. **`FileRefSchema`** — add the new schema to the discriminated union array

### 3. Done

The new variant is now part of `FileRefSchema`. Consumers parsing `FileRef` will automatically dispatch to the correct variant based on `sourceType`.

## Naming Conventions

| Export | Pattern | Example |
|--------|---------|---------|
| Source type constant | `{domain}SourceType` | `chatMessageSourceType` |
| Roles array | `{domain}Roles` | `chatMessageRoles` |
| Schema | `{domain}FileRefSchema` | `chatMessageFileRefSchema` |
| File name | `{domain}.ts` (camelCase) | `chatMessage.ts` |

## Design Notes

- **`sourceType` must be a string literal** (`z.literal(...)`) — required for the discriminated union to dispatch correctly.
- **`role` is scoped per sourceType** — different domains define different valid roles. The standalone `FileRefRoleSchema` is the flat union of all roles across all domains; prefer validating through `FileRefSchema` when possible.
- **`sourceId` format is domain-dependent** — each variant decides its own schema (e.g. `z.uuidv7()`, `z.uuidv4()`, `z.string().min(1)`) based on the business entity's ID format.
- **Common fields are frozen** — `refCommonFields` is `Object.freeze()`-d to prevent accidental mutation.

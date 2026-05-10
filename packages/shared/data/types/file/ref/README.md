# FileRef — Adding a New Business Integration

Each business domain that references files (e.g. chat messages, knowledge items, paintings) gets its own **ref variant** — a dedicated schema file in this directory.

## Architecture

```
ref/
├── essential.ts     # Common fields (id, fileEntryId, timestamps) + createRefSchema factory
├── tempSession.ts   # Temp session variant (tracks temp files in use)
├── index.ts         # Aggregates all variants into FileRefSchema (discriminatedUnion)
└── README.md
```

`FileRefSchema` is a **discriminated union on `sourceType`**. Each variant defines:

- `sourceType` — a string literal identifying the business domain
- `sourceId` — the owning business entity's ID
- `role` — a per-domain enum of how the file is used (e.g. `attachment`, `source`)

Common fields (`id`, `fileEntryId`, `createdAt`, `updatedAt`) are auto-inherited via `createRefSchema()`.

## Step-by-Step: Adding a New Variant

Use `tempSession.ts` as your template. Suppose you're adding `chat_message`:

### 1. Create the variant file

```typescript
// ref/chatMessage.ts
import * as z from 'zod'

import { createRefSchema } from './essential'

export const chatMessageSourceType = 'chat_message' as const

export const chatMessageRoles = ['attachment', 'inline_image'] as const

/** Business fields only — passed into `createRefSchema(...)` to attach common fields */
export const chatMessageRefFields = {
  sourceType: z.literal(chatMessageSourceType),
  sourceId: z.uuidv7(),
  role: z.enum(chatMessageRoles)
}

export const chatMessageFileRefSchema = createRefSchema(chatMessageRefFields)
```

### 2. Register in `index.ts`

```diff
+ import { chatMessageFileRefSchema, chatMessageSourceType } from './chatMessage'

  export const allSourceTypes = [
    tempSessionSourceType,
    'chat_message',  // already listed today as a tuple-only entry; no change
    'knowledge_item',
    'painting',
    'note'
  ] as const

  export const FileRefSchema = z.discriminatedUnion('sourceType', [
    tempSessionFileRefSchema,
+   chatMessageFileRefSchema,
  ])
```

### 3. Register a real `SourceTypeChecker`

In `src/main/data/services/orphan/FileRefCheckerRegistry.ts`, replace the
conservative no-op stub for the new variant with a real DB-backed checker
(see `knowledgeItemChecker` as a template). The
`Record<FileRefSourceType, SourceTypeChecker<...>>` mapped type makes this a
compile-time gate: missing the checker is a build error.

### 4. Done

The new variant is now part of `FileRefSchema`. Consumers parsing `FileRef`
will automatically dispatch to the correct variant based on `sourceType`,
and OrphanRefScanner stops treating its refs as orphans.

## Naming Conventions

| Export | Pattern | Example |
|--------|---------|---------|
| Source type constant | `{domain}SourceType` | `chatMessageSourceType` |
| Roles array | `{domain}Roles` | `chatMessageRoles` |
| Business fields | `{domain}RefFields` | `chatMessageRefFields` |
| Schema | `{domain}FileRefSchema` | `chatMessageFileRefSchema` |
| File name | `{domain}.ts` (camelCase) | `chatMessage.ts` |

## Design Notes

- **`sourceType` must be a string literal** (`z.literal(...)`) — required for the discriminated union to dispatch correctly.
- **`role` is scoped per sourceType** — different domains define different valid roles. There is intentionally no global `allRoles` aggregator; each variant's `role` is validated locally by its own `z.enum(variantRoles)` inside `createRefSchema`. Prefer validating through `FileRefSchema` for any cross-variant work.
- **`sourceId` format is domain-dependent** — each variant decides its own schema (e.g. `z.uuidv7()`, `z.uuidv4()`, `z.string().min(1)`) based on the business entity's ID format.
- **Common fields are frozen** — `refCommonFields` is `Object.freeze()`-d to prevent accidental mutation.
- **`*RefFields`** is passed to `createRefSchema(...)` which composes the common fields onto the variant's business fields — consumers always validate through the resulting `*FileRefSchema`, never against the bare fields object.
